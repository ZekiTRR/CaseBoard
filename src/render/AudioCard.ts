import { setIcon, setTooltip } from "obsidian";
import type { AudioBoardNode } from "../core/types";
import { clamp } from "../util/math";

export interface AudioCardHost {
  onAudioToggle(nodeId: string): void;
  onAudioSeek(nodeId: string, ratio: number): void;
}

/** Pixels each waveform column owns, bar included. */
const BAR_PITCH = 5;
const CARD_PADDING = 15;
const DIAL_WIDTH = 32;
const DIAL_GAP = 11;
const MIN_BARS = 12;
const MAX_BARS = 84;

const DIAL_OUTER =
  "M16.7 4.6C22.9 5.2 27.5 10.3 27.2 16.4 26.9 22.6 21.9 27.5 15.8 27.2 9.9 26.9 5.2 22 4.9 16 4.6 10.3 9.3 5.1 15.4 4.7c1.3-.1 2.3-.2 3.3.1";
const DIAL_INNER =
  "M15.2 5.5C21.1 4.9 26.5 9.7 26.6 15.8 26.7 21.9 22.1 26.9 16 26.8 10.2 26.7 5.5 22 5.4 16.3";
const DIAL_TRIANGLE =
  "M13.2 11.3 21.5 15.8c.5.3.5 1 0 1.3l-8.3 4.5c-.6.3-1.2-.1-1.2-.8l.1-8.7c0-.7.6-1.1 1.1-.8Z";

/**
 * The voice-note card: an over-traced ink circle for play, a waveform built from the
 * file's own peaks, and the caption line the case file would carry.
 */
export class AudioCard {
  readonly el: HTMLElement;
  private readonly stampEl: HTMLElement;
  private readonly eqEl: HTMLElement;
  private readonly playEl: HTMLElement;
  private readonly progressArc: SVGPathElement;
  private readonly waveEl: HTMLElement;
  private readonly cueEl: HTMLElement;
  private readonly currentEl: HTMLElement;
  private readonly totalEl: HTMLElement;
  private readonly noteEl: HTMLElement;
  private readonly fileEl: HTMLElement;
  private readonly missingEl: HTMLElement;
  private bars: HTMLElement[] = [];
  private barCount = 0;
  private node: AudioBoardNode;

  constructor(node: AudioBoardNode, private readonly host: AudioCardHost) {
    this.node = node;
    this.el = createDiv({ cls: "cb-audio" });

    const head = this.el.createDiv({ cls: "cb-audio-head" });
    const icon = head.createSpan({ cls: "cb-audio-icon" });
    setIcon(icon, "mic");
    head.createSpan({ cls: "cb-audio-kind", text: "Recording" });
    this.eqEl = head.createSpan({ cls: "cb-audio-eq" });
    for (let index = 0; index < 3; index++) this.eqEl.createSpan();
    this.eqEl.hidden = true;
    this.stampEl = head.createSpan({ cls: "cb-audio-stamp" });

    const main = this.el.createDiv({ cls: "cb-audio-main" });
    this.playEl = main.createEl("button", {
      cls: "cb-audio-play",
      attr: { type: "button", "data-audio-control": "play" },
    });
    setTooltip(this.playEl, "Play / pause");
    const dial = this.buildDial();
    this.progressArc = dial.arc;
    this.playEl.appendChild(dial.svg);

    const box = main.createDiv({ cls: "cb-audio-box" });
    this.waveEl = box.createDiv({ cls: "cb-audio-wave", attr: { "data-audio-control": "wave" } });
    this.cueEl = this.waveEl.createDiv({ cls: "cb-audio-cue" });
    this.cueEl.hidden = true;
    const times = box.createDiv({ cls: "cb-audio-times" });
    this.currentEl = times.createSpan({ cls: "cb-audio-current", text: "0:00" });
    times.createSpan({ cls: "cb-audio-slash", text: "/" });
    this.totalEl = times.createSpan({ cls: "cb-audio-total", text: "0:00" });

    this.noteEl = this.el.createDiv({ cls: "cb-audio-note" });
    this.fileEl = this.el.createDiv({ cls: "cb-audio-file" });
    this.missingEl = this.el.createDiv({ cls: "cb-audio-missing" });
    setIcon(this.missingEl.createSpan({ cls: "cb-inline-icon" }), "file-warning");
    this.missingEl.createSpan({ text: "Recording not found in the vault" });
    this.missingEl.hidden = true;
    this.el.dataset.state = "idle";
    this.playEl.dataset.state = "idle";

    this.bindWaveEvents();
    this.playEl.addEventListener("click", (event) => {
      event.stopPropagation();
      this.host.onAudioToggle(this.node.id);
    });
  }

  private buildDial(): { svg: SVGSVGElement; arc: SVGPathElement } {
    const svg = createSvg("svg", { attr: { viewBox: "0 0 32 32", "aria-hidden": "true" } });
    const inner = createSvg("path", {
      attr: { d: DIAL_INNER, class: "cb-audio-dial-back" },
    });
    const outer = createSvg("path", {
      attr: { d: DIAL_OUTER, class: "cb-audio-dial-ring", pathLength: 100 },
    });
    const arc = createSvg("path", {
      attr: { d: DIAL_OUTER, class: "cb-audio-dial-progress", pathLength: 100, "stroke-dasharray": "0 100" },
    });
    const glyph = createSvg("g", { attr: { class: "cb-audio-glyph" } });
    glyph.appendChild(createSvg("path", { attr: { d: DIAL_TRIANGLE, class: "cb-audio-triangle" } }));
    const pause = createSvg("g", { attr: { class: "cb-audio-pause" } });
    pause.append(
      createSvg("path", { attr: { d: "M13 11.7v8.8" } }),
      createSvg("path", { attr: { d: "M19.3 11.7v8.8" } }),
    );
    svg.append(inner, outer, arc, glyph, pause);
    return { svg, arc };
  }

  private bindWaveEvents(): void {
    this.waveEl.addEventListener("pointerdown", (event) => event.stopPropagation());
    this.waveEl.addEventListener("pointermove", (event) => {
      const ratio = this.ratioFromEvent(event.clientX);
      this.cueEl.setCssProps({ "--cb-audio-cue": `${(ratio * 100).toFixed(2)}%` });
      this.cueEl.dataset.time = formatTime(ratio * this.node.duration);
      this.cueEl.hidden = false;
    });
    this.waveEl.addEventListener("pointerleave", () => {
      this.cueEl.hidden = true;
    });
    this.waveEl.addEventListener("click", (event) => {
      event.stopPropagation();
      this.host.onAudioSeek(this.node.id, this.ratioFromEvent(event.clientX));
    });
  }

  private ratioFromEvent(clientX: number): number {
    const rect = this.waveEl.getBoundingClientRect();
    if (rect.width <= 0) return 0;
    return clamp((clientX - rect.left) / rect.width, 0, 1);
  }

  update(node: AudioBoardNode): void {
    this.node = node;
    this.stampEl.textContent = formatClock(node.createdAt);
    this.fileEl.textContent = node.file;
    this.fileEl.title = node.file;
    this.totalEl.textContent = formatTime(node.duration);
    this.noteEl.textContent = node.caption;
    this.noteEl.hidden = node.caption.trim().length === 0;
    this.layoutBars(node);
  }

  /** Rebuilds the columns whenever the card width or waveform changes. */
  private layoutBars(node: AudioBoardNode): void {
    const usable = node.width - CARD_PADDING * 2 - DIAL_WIDTH - DIAL_GAP;
    const wanted = clamp(Math.floor(usable / BAR_PITCH), MIN_BARS, MAX_BARS);
    if (wanted === this.barCount && this.bars.length > 0) {
      this.paintBars(node, wanted);
      return;
    }
    this.barCount = wanted;
    for (const bar of this.bars) bar.remove();
    this.bars = [];
    for (let index = 0; index < wanted; index++) {
      this.bars.push(this.waveEl.createSpan({ cls: "cb-audio-bar" }));
    }
    this.paintBars(node, wanted);
  }

  private paintBars(node: AudioBoardNode, count: number): void {
    const peaks = resample(node.peaks, count);
    for (let index = 0; index < this.bars.length; index++) {
      this.bars[index].setCssProps({ "--cb-audio-peak": (peaks[index] * 100).toFixed(1) });
    }
  }

  setProgress(ratio: number): void {
    const played = Math.round(clamp(ratio, 0, 1) * this.bars.length);
    for (let index = 0; index < this.bars.length; index++) {
      this.bars[index].classList.toggle("is-played", index < played);
    }
    this.progressArc.setAttribute("stroke-dasharray", `${Math.round(ratio * 100)} 100`);
    this.currentEl.textContent = formatTime(ratio * this.node.duration);
  }

  setState(state: "idle" | "playing" | "paused"): void {
    this.el.dataset.state = state;
    this.playEl.dataset.state = state;
    this.playEl.setAttribute("aria-label", state === "playing" ? "Pause recording" : "Play recording");
    this.eqEl.hidden = state !== "playing";
  }

  setMissing(missing: boolean): void {
    this.el.classList.toggle("is-missing", missing);
    this.missingEl.toggleAttribute("hidden", !missing);
  }
}

/** Peak decimation that keeps transients: each output column takes the loudest sample. */
function resample(peaks: number[], count: number): number[] {
  if (peaks.length === 0) return Array.from<number>({ length: count }).fill(0.06);
  if (peaks.length === count) return peaks.slice();
  const out: number[] = [];
  for (let index = 0; index < count; index++) {
    const start = Math.floor((index * peaks.length) / count);
    const end = Math.max(start + 1, Math.floor(((index + 1) * peaks.length) / count));
    let best = 0;
    for (let i = start; i < end && i < peaks.length; i++) best = Math.max(best, peaks[i]);
    out.push(best);
  }
  return out;
}

export function formatTime(seconds: number): string {
  const value = Math.max(0, Math.round(seconds));
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const secs = value % 60;
  const tail = `${String(minutes).padStart(hours > 0 ? 2 : 1, "0")}:${String(secs).padStart(2, "0")}`;
  return hours > 0 ? `${hours}:${tail}` : tail;
}

function formatClock(timestamp: number): string {
  const date = new Date(timestamp);
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${day}.${month} · ${hours}:${minutes}`;
}
