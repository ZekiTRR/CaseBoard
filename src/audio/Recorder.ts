import { AUDIO_PEAK_COUNT } from "../core/types";
import { clamp } from "../util/math";

const MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg;codecs=opus",
];

export interface RecordingTake {
  blob: Blob;
  /** Seconds, measured from the recorder clock. */
  duration: number;
  /** Extension without the dot, matching the codec that was actually used. */
  extension: string;
}

export type LevelListener = (level: number) => void;

type AudioContextCtor = new () => AudioContext;

function audioContextCtor(): AudioContextCtor | null {
  if (typeof AudioContext !== "undefined") return AudioContext;
  const legacy = (window as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext;
  return legacy ?? null;
}

/**
 * Records from the microphone and reports a 0..1 level while it runs.
 * Everything stays inside Obsidian's webview: no network, no temp files on disk.
 */
export class Recorder {
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private context: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private chunks: Blob[] = [];
  private frame: number | null = null;
  private startedAt = 0;
  private failing = false;

  static supported(): boolean {
    return (
      typeof MediaRecorder !== "undefined" &&
      typeof navigator.mediaDevices !== "undefined" &&
      typeof navigator.mediaDevices.getUserMedia === "function"
    );
  }

  get mimeType(): string {
    return this.recorder?.mimeType || "audio/webm";
  }

  get extension(): string {
    const mime = this.mimeType;
    if (mime.includes("mp4") || mime.includes("aac")) return "m4a";
    if (mime.includes("ogg")) return "ogg";
    return "webm";
  }

  async start(onLevel?: LevelListener): Promise<void> {
    if (this.recorder) return;
    if (!Recorder.supported()) throw new Error("MediaRecorder is not available");

    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.chunks = [];

    const ctor = audioContextCtor();
    if (ctor) {
      try {
        this.context = new ctor();
        this.source = this.context.createMediaStreamSource(this.stream);
        this.analyser = this.context.createAnalyser();
        this.analyser.fftSize = 1024;
        this.analyser.smoothingTimeConstant = 0.6;
        this.source.connect(this.analyser);
      } catch {
        this.context = null;
        this.analyser = null;
      }
    }

    const mimeType = MIME_CANDIDATES.find((candidate) => MediaRecorder.isTypeSupported(candidate));
    this.recorder = mimeType ? new MediaRecorder(this.stream, { mimeType }) : new MediaRecorder(this.stream);
    this.recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) this.chunks.push(event.data);
    };
    this.recorder.onerror = () => {
      this.failing = true;
    };
    this.startedAt = Date.now();
    // 1 s slices keep memory flat during a long take without losing the tail.
    this.recorder.start(1000);
    if (this.analyser && onLevel) this.pumpLevels(onLevel);
  }

  private pumpLevels(onLevel: LevelListener): void {
    const analyser = this.analyser;
    if (!analyser) return;
    const buffer = new Float32Array(analyser.fftSize);
    const step = (): void => {
      if (!this.analyser) return;
      this.analyser.getFloatTimeDomainData(buffer);
      let sum = 0;
      for (let index = 0; index < buffer.length; index++) sum += buffer[index] * buffer[index];
      onLevel(clamp(Math.sqrt(sum / buffer.length) * 3.2, 0, 1));
      this.frame = window.requestAnimationFrame(step);
    };
    this.frame = window.requestAnimationFrame(step);
  }

  async stop(): Promise<RecordingTake> {
    const recorder = this.recorder;
    if (!recorder) throw new Error("No recording in progress");
    const blob = await new Promise<Blob>((resolve) => {
      recorder.onstop = () => resolve(new Blob(this.chunks, { type: recorder.mimeType }));
      if (recorder.state !== "inactive") recorder.stop();
      else resolve(new Blob(this.chunks, { type: recorder.mimeType }));
    });
    const duration = Math.max(0.2, (Date.now() - this.startedAt) / 1000);
    this.teardownRecorder();
    if (this.failing && blob.size === 0) throw new Error("The recorder failed");
    return { blob, duration, extension: this.extension };
  }

  cancel(): void {
    if (this.recorder && this.recorder.state !== "inactive") this.recorder.stop();
    this.teardownRecorder();
    this.dispose();
  }

  /** Releases the microphone immediately; the audio graph is kept until peaks are decoded. */
  private teardownRecorder(): void {
    if (this.frame !== null) {
      window.cancelAnimationFrame(this.frame);
      this.frame = null;
    }
    this.source?.disconnect();
    this.source = null;
    this.analyser = null;
    this.recorder = null;
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.stream = null;
    this.failing = false;
  }

  dispose(): void {
    if (this.context && this.context.state !== "closed") void this.context.close().catch(() => undefined);
    this.context = null;
  }

  /**
   * Waveform columns for the card. Returns null when the browser cannot decode the
   * take, in which case the caller keeps a placeholder trace.
   */
  async peaks(take: RecordingTake, count = AUDIO_PEAK_COUNT): Promise<number[] | null> {
    const buffer = await this.decode(take.blob);
    if (!buffer) return null;
    const channel = buffer.getChannelData(0);
    const step = Math.max(1, Math.floor(channel.length / count));
    const peaks: number[] = [];
    for (let index = 0; index < count; index++) {
      const start = index * step;
      let loudest = 0;
      for (let i = start; i < Math.min(start + step, channel.length); i++) {
        loudest = Math.max(loudest, Math.abs(channel[i] ?? 0));
      }
      peaks.push(clamp(loudest * 1.6, 0.05, 1));
    }
    return peaks;
  }

  /** Duration measured from the decoded media, more exact than the recorder clock. */
  async durationOf(take: RecordingTake): Promise<number | null> {
    const buffer = await this.decode(take.blob);
    return buffer ? buffer.duration : null;
  }

  private async decode(blob: Blob): Promise<AudioBuffer | null> {
    if (blob.size === 0) return null;
    let context = this.context;
    let owned = false;
    if (!context) {
      const ctor = audioContextCtor();
      if (!ctor) return null;
      context = new ctor();
      owned = true;
    }
    try {
      const data = await blob.arrayBuffer();
      return await context.decodeAudioData(data);
    } catch {
      return null;
    } finally {
      if (owned && context.state !== "closed") void context.close().catch(() => undefined);
    }
  }
}

/** Decodes any audio file that landed in the vault, so dropped recordings get a real trace. */
export async function peaksFromFile(
  data: ArrayBuffer,
  count = AUDIO_PEAK_COUNT,
): Promise<{ peaks: number[]; duration: number } | null> {
  const ctor = audioContextCtor();
  if (!ctor) return null;
  const context = new ctor();
  try {
    const buffer = await context.decodeAudioData(data);
    const channel = buffer.getChannelData(0);
    const step = Math.max(1, Math.floor(channel.length / count));
    const peaks: number[] = [];
    for (let index = 0; index < count; index++) {
      const start = index * step;
      let loudest = 0;
      for (let i = start; i < Math.min(start + step, channel.length); i++) {
        loudest = Math.max(loudest, Math.abs(channel[i] ?? 0));
      }
      peaks.push(clamp(loudest * 1.6, 0.05, 1));
    }
    return { peaks, duration: buffer.duration };
  } catch {
    return null;
  } finally {
    if (context.state !== "closed") void context.close().catch(() => undefined);
  }
}

export const AUDIO_FILE_EXTENSIONS = ["mp3", "m4a", "aac", "wav", "ogg", "webm", "flac", "opus"];

export function isAudioFileName(name: string): boolean {
  const dot = name.lastIndexOf(".");
  if (dot < 0) return false;
  return AUDIO_FILE_EXTENSIONS.includes(name.slice(dot + 1).toLowerCase());
}
