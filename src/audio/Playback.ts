export interface PlaybackCallbacks {
  /** Fires whenever the visible position changes. */
  onProgress(nodeId: string, ratio: number): void;
  /** Fires when a track stops for any reason: finished, replaced or released. */
  onStopped(nodeId: string | null): void;
  onError(nodeId: string): void;
}

/**
 * One audio element for the whole view: starting another recording stops the previous
 * one, so the board never plays two voices at a time.
 */
export class AudioPlayback {
  private readonly el: HTMLAudioElement;
  private nodeId: string | null = null;
  /** Length stored on the card; used until the element reports its own metadata. */
  private fallbackDuration = 0;

  constructor(private readonly callbacks: PlaybackCallbacks) {
    this.el = createEl("audio", { cls: "cb-audio-engine", attr: { preload: "metadata" } });
    this.el.hidden = true;
    this.el.addEventListener("timeupdate", () => this.report());
    this.el.addEventListener("seeked", () => this.report());
    this.el.addEventListener("ended", () => this.finish());
    this.el.addEventListener("error", () => {
      const id = this.nodeId;
      this.release();
      if (id) this.callbacks.onError(id);
    });
  }

  get playingNode(): string | null {
    return this.el.paused ? null : this.nodeId;
  }

  get activeNode(): string | null {
    return this.nodeId;
  }

  get ratio(): number {
    return Math.min(1, this.el.currentTime / this.total());
  }

  /** Loads a recording and starts it, optionally from an offset (0..1). */
  play(nodeId: string, src: string, startRatio = 0, knownDuration = 0): void {
    if (this.nodeId !== nodeId) {
      const previous = this.nodeId;
      this.nodeId = nodeId;
      this.el.src = src;
      this.fallbackDuration = knownDuration;
      if (previous) this.callbacks.onStopped(previous);
    }
    const total = this.total();
    if (startRatio > 0 && total > 0) {
      this.el.currentTime = total * startRatio;
    } else if (this.el.ended || (total > 0 && this.el.currentTime >= total)) {
      this.el.currentTime = 0;
    }
    void this.el.play().catch(() => {
      const id = this.nodeId;
      this.release();
      if (id) this.callbacks.onError(id);
    });
  }

  pause(): void {
    this.el.pause();
    this.report();
  }

  stop(): void {
    const id = this.nodeId;
    this.el.pause();
    this.el.currentTime = 0;
    this.el.removeAttribute("src");
    this.el.load();
    this.nodeId = null;
    this.fallbackDuration = 0;
    if (id) {
      this.callbacks.onProgress(id, 0);
      this.callbacks.onStopped(id);
    }
  }

  seek(ratio: number): void {
    if (!this.nodeId) return;
    const value = Math.max(0, Math.min(1, ratio));
    this.el.currentTime = this.total() * value;
    // A pending seek keeps the old currentTime, so paint the requested position right away.
    this.callbacks.onProgress(this.nodeId, value);
  }

  destroy(): void {
    this.pause();
    this.el.removeAttribute("src");
    this.el.load();
    this.nodeId = null;
    this.fallbackDuration = 0;
  }

  /** Element metadata first, the length stored on the card when a stream reports none. */
  private total(): number {
    const fromElement = this.el.duration;
    if (Number.isFinite(fromElement) && fromElement > 0) return fromElement;
    return this.fallbackDuration > 0 ? this.fallbackDuration : 1;
  }

  private finish(): void {
    const id = this.nodeId;
    this.el.currentTime = 0;
    if (id) this.callbacks.onProgress(id, 0);
    this.nodeId = null;
    if (id) this.callbacks.onStopped(id);
  }

  private release(): void {
    const id = this.nodeId;
    this.el.pause();
    this.el.currentTime = 0;
    this.nodeId = null;
    if (id) this.callbacks.onStopped(id);
  }

  private report(): void {
    if (this.nodeId) this.callbacks.onProgress(this.nodeId, this.ratio);
  }
}
