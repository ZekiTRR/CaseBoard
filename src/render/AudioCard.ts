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

/**
 * The circle is drawn as three overlapping passes with broken dashes, so the crayon
 * runs out of ink in places and overshoots where the stroke meets its own start.
 */
const RING_MAIN =
  "M16.9 4.7C23 5.4 27.6 10.5 27.3 16.6 27 22.7 21.9 27.6 15.8 27.2 9.9 26.8 5.1 21.8 4.8 15.9 4.5 10.2 9.4 5 15.5 4.6c1.4-.1 2.5-.1 3.5.2";
const RING_PASS_ONE =
  "M14.6 5.9C20.4 5 26.2 9.4 26.7 15.4 27.2 21.4 22.6 26.9 16.6 27.1 10.7 27.3 5.6 22.8 5.1 17 4.6 11.5 8.7 6.7 14 5.9";
const RING_PASS_TWO =
  "M18.6 4.1C24.4 5.5 28.4 10.8 27.8 16.8 27.2 22.7 21.9 27.3 15.9 26.9 10.1 26.5 5.2 21.7 4.6 15.9 4.1 10.7 8.1 5.7 13.6 4.4";
const TRIANGLE =
  "M12.7 10.9 21.6 15.9c.6.3.6 1.2 0 1.5l-8.9 4.9c-.7.4-1.5-.1-1.5-.9l.1-9.6c0-.8.8-1.2 1.4-.8Z";
const TRIANGLE_ECHO = "M13.9 12.5 20.2 16.1 13.7 19.7 13.8 12.7";
const PAUSE_ONE = "M13.3 11.5 12.9 20.7";
const PAUSE_TWO = "M19.3 11.3 18.9 20.5";
/** Short strokes radiating from the circle, like the pencil was lifted with a flourish. */
const SPARKS = [
  "M6.5 6.5 4.7 4.7",
  "M3.9 10.3 2.4 9.7",
  "M10.3 3.9 9.4 1.9",
  "M25.5 25.5 27.5 27.5",
  "M28.2 21.7 29.6 22.3",
  "M21.7 28.2 22.7 30.3",
];

/**
 * The voice-note card: a play button drawn in crayon and graphite on the paper,
 * a waveform built from the file's own peaks, and the caption line the case file carries.
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
    const hatch = `cb-audio-hatch-${this.node.id}`;
    const svg = createSvg("svg", { attr: { viewBox: "0 0 32 32", "aria-hidden": "true" } });

    const defs = createSvg("defs");
    const pattern = createSvg("pattern", {
      attr: {
        id: hatch,
        width: 1.6,
        height: 1.6,
        patternUnits: "userSpaceOnUse",
        patternTransform: "rotate(-38)",
      },
    });
    pattern.appendChild(createSvg("path", { attr: { d: "M0 0 V1.6", class: "cb-audio-hatch-line" } }));
    defs.appendChild(pattern);
    svg.appendChild(defs);

    svg.appendChild(
      createSvg("path", { attr: { d: RING_PASS_TWO, class: "cb-audio-dial-ghost" } }),
    );
    svg.appendChild(
      createSvg("path", { attr: { d: RING_PASS_ONE, class: "cb-audio-dial-back" } }),
    );
    svg.appendChild(
      createSvg("path", { attr: { d: RING_MAIN, class: "cb-audio-dial-ring", pathLength: 100 } }),
    );
    const arc = createSvg("path", {
      attr: {
        d: RING_MAIN,
        class: "cb-audio-dial-progress",
        pathLength: 100,
        "stroke-dasharray": "0 100",
      },
    });
    svg.appendChild(arc);

    const sparks = createSvg("g", { attr: { class: "cb-audio-sparks" } });
    for (const d of SPARKS) sparks.appendChild(createSvg("path", { attr: { d } }));
    svg.appendChild(sparks);

    const glyph = createSvg("g", { attr: { class: "cb-audio-glyph" } });
    glyph.append(
      createSvg("path", { attr: { d: TRIANGLE, fill: `url(#${hatch})`, class: "cb-audio-hatch" } }),
      createSvg("path", { attr: { d: TRIANGLE, class: "cb-audio-triangle" } }),
      createSvg("path", { attr: { d: TRIANGLE_ECHO, class: "cb-audio-triangle-echo" } }),
    );
    svg.appendChild(glyph);

    const pause = createSvg("g", { attr: { class: "cb-audio-pause" } });
    pause.append(
      createSvg("path", { attr: { d: PAUSE_ONE } }),
      createSvg("path", { attr: { d: PAUSE_TWO } }),
    );
    svg.appendChild(pause);

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
