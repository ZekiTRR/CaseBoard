import { setIcon, setTooltip } from "obsidian";
import type { AudioBoardNode } from "../core/types";
import { clamp } from "../util/math";

export interface AudioCardHost {
  onAudioToggle(nodeId: string): void;
  onAudioSeek(nodeId: string, ratio: number): void;
  /** Dragging the timestamp resizes it; `commit` closes the history entry. */
  onAudioStamp(nodeId: string, scale: number, commit: boolean): void;
}

/** Pixels each waveform column owns, bar included. */
const BAR_PITCH = 5;
const CARD_PADDING = 15;
const DIAL_WIDTH = 32;
const DIAL_GAP = 11;
const MIN_BARS = 12;
const MAX_BARS = 84;

/**
 * The mark is drawn, not typed: one firm crayon pass around the outside, a lighter
 * retracing pass beside it, and a triangle shaded with diagonal strokes so the paper
 * reads through. A per-card chalk filter breaks the edges and punches the grain.
 */
const RING_MAIN =
  "M15.4 4.4c6.5-.4 12.1 4.7 12.2 11.1.1 6.5-5.2 11.9-11.7 11.9C9.5 27.4 4 22.1 4 15.7 4 9.6 8.9 4.7 15 4.4c1.2 0 2.1.1 3 .4";
const RING_RETRACE =
  "M13.8 5.6c6.1-1.3 12.6 2.9 13.3 9.1.7 6.2-4.4 12.2-10.6 12.7-6.3.5-12.1-4.4-12.4-10.7C3.8 9.9 8.4 5.4 13.8 5.6";
const TRIANGLE =
  "M12.4 10.4 21.9 15.7c.8.4.8 1.6 0 2l-9.5 5.3c-.9.5-2-.2-2-1.2V11.6c0-1 1.1-1.6 2-1.2Z";
const TRIANGLE_ECHO = "M13.6 12.5 20.1 16.2 13.5 19.9Z";
const PAUSE_ONE = "M13 11.2 12.6 20.8";
const PAUSE_TWO = "M19.6 11.2 19.2 20.8";
/** Short flicks outside the circle, the way a crayon is lifted off the paper. */
const SPARKS = [
  "M7.4 6.8 5.1 4.5",
  "M4.4 10.1 1.9 9.2",
  "M10.4 4.1 9.6 1.6",
  "M24.6 25.2 26.9 27.5",
  "M27.6 21.9 30.1 22.8",
  "M21.6 27.9 22.4 30.4",
];

/**
 * The voice-note card: a play button drawn in crayon and graphite on the paper,
 * a waveform built from the file's own peaks, and the caption line the case file carries.
 */
export class AudioCard {
  readonly el: HTMLElement;
  private readonly headEl: HTMLElement;
  private readonly stampEl: HTMLElement;
  private readonly eqEl: HTMLElement;
  private readonly playEl: HTMLElement;
  private readonly progressArc: SVGPathElement;
  private readonly waveEl: HTMLElement;
  private readonly cueEl: HTMLElement;
  private readonly currentEl: HTMLElement;
  private readonly totalEl: HTMLElement;
  private readonly noteEl: HTMLElement;
  private readonly missingEl: HTMLElement;
  private bars: HTMLElement[] = [];
  private barCount = 0;
  private node: AudioBoardNode;

  constructor(node: AudioBoardNode, private readonly host: AudioCardHost) {
    this.node = node;
    this.el = createDiv({ cls: "cb-audio" });

    this.headEl = this.el.createDiv({ cls: "cb-audio-head" });
    this.eqEl = this.headEl.createSpan({ cls: "cb-audio-eq" });
    for (let index = 0; index < 3; index++) this.eqEl.createSpan();
    this.eqEl.hidden = true;
    this.stampEl = this.headEl.createSpan({
      cls: "cb-audio-stamp",
      attr: { "data-audio-control": "stamp" },
    });
    setTooltip(this.stampEl, "Drag up or down to resize the date");
    this.bindStampDrag();

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
    const uid = this.node.id;
    const hatch = `cb-audio-hatch-${uid}`;
    const chalk = `cb-audio-chalk-${uid}`;
    const svg = createSvg("svg", { attr: { viewBox: "0 0 32 32", "aria-hidden": "true" } });

    const defs = createSvg("defs");
    const filter = createSvg("filter", {
      attr: {
        id: chalk,
        x: "-20%",
        y: "-20%",
        width: "140%",
        height: "140%",
        "color-interpolation-filters": "sRGB",
      },
    });
    const transfer = createSvg("feComponentTransfer", {
      attr: { in: "grain", result: "grainAlpha" },
    });
    transfer.appendChild(
      createSvg("feFuncA", { attr: { type: "table", tableValues: "0 0.3 0.86 1 1 1" } }),
    );
    filter.append(
      createSvg("feTurbulence", {
        attr: {
          type: "fractalNoise",
          baseFrequency: "0.028",
          numOctaves: "3",
          seed: "7",
          result: "warp",
        },
      }),
      createSvg("feDisplacementMap", {
        attr: {
          in: "SourceGraphic",
          in2: "warp",
          scale: "1.15",
          xChannelSelector: "R",
          yChannelSelector: "G",
          result: "wobbled",
        },
      }),
      createSvg("feTurbulence", {
        attr: {
          type: "fractalNoise",
          baseFrequency: "0.21",
          numOctaves: "3",
          seed: "19",
          result: "grain",
        },
      }),
      transfer,
      createSvg("feComposite", {
        attr: { in: "wobbled", in2: "grainAlpha", operator: "in" },
      }),
    );
    const pattern = createSvg("pattern", {
      attr: {
        id: hatch,
        width: 2.3,
        height: 2.3,
        patternUnits: "userSpaceOnUse",
        patternTransform: "rotate(-38)",
      },
    });
    pattern.appendChild(createSvg("path", { attr: { d: "M0 0 V2.3", class: "cb-audio-hatch-line" } }));
    defs.append(filter, pattern);
    svg.appendChild(defs);

    const mark = createSvg("g", { attr: { class: "cb-audio-mark", filter: `url(#${chalk})` } });
    mark.appendChild(createSvg("path", { attr: { d: RING_RETRACE, class: "cb-audio-dial-back" } }));
    mark.appendChild(
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
    mark.appendChild(arc);

    const sparks = createSvg("g", { attr: { class: "cb-audio-sparks" } });
    for (const d of SPARKS) sparks.appendChild(createSvg("path", { attr: { d } }));
    mark.appendChild(sparks);

    const glyph = createSvg("g", { attr: { class: "cb-audio-glyph" } });
    glyph.append(
      createSvg("path", { attr: { d: TRIANGLE, fill: `url(#${hatch})`, class: "cb-audio-hatch" } }),
      createSvg("path", { attr: { d: TRIANGLE, class: "cb-audio-triangle" } }),
      createSvg("path", { attr: { d: TRIANGLE_ECHO, class: "cb-audio-triangle-echo" } }),
    );
    mark.appendChild(glyph);

    const pause = createSvg("g", { attr: { class: "cb-audio-pause" } });
    pause.append(
      createSvg("path", { attr: { d: PAUSE_ONE } }),
      createSvg("path", { attr: { d: PAUSE_TWO } }),
    );
    mark.appendChild(pause);

    svg.appendChild(mark);
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

  private bindStampDrag(): void {
    let startY = 0;
    let startScale = 1;
    let dragging = false;

    this.stampEl.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.stopPropagation();
      dragging = true;
      startY = event.clientY;
      startScale = this.node.stampScale;
      this.stampEl.classList.add("is-dragging");
      this.stampEl.setPointerCapture(event.pointerId);
    });

    this.stampEl.addEventListener("pointermove", (event) => {
      if (!dragging) return;
      const next = clamp(startScale + (startY - event.clientY) / 120, 0.7, 3);
      if (Math.abs(next - this.node.stampScale) < 0.002) return;
      this.host.onAudioStamp(this.node.id, next, false);
    });

    const finish = (event: PointerEvent): void => {
      if (!dragging) return;
      dragging = false;
      this.stampEl.classList.remove("is-dragging");
      if (this.stampEl.hasPointerCapture(event.pointerId)) {
        this.stampEl.releasePointerCapture(event.pointerId);
      }
      this.host.onAudioStamp(this.node.id, this.node.stampScale, true);
    };
    this.stampEl.addEventListener("pointerup", finish);
    this.stampEl.addEventListener("pointercancel", finish);
  }

  update(node: AudioBoardNode): void {
    this.node = node;
    this.stampEl.textContent = formatClock(node.createdAt);
    this.totalEl.textContent = formatTime(node.duration);
    this.noteEl.textContent = node.caption;
    this.noteEl.hidden = node.caption.trim().length === 0;
    this.el.setCssProps({
      "--cb-audio-scale": String(node.scale),
      "--cb-audio-stamp-scale": String(node.stampScale),
    });
    this.layoutBars(node);
  }

  /** Rebuilds the columns whenever the card width or waveform changes. */
  private layoutBars(node: AudioBoardNode): void {
    const dial = DIAL_WIDTH * node.scale;
    const usable = node.width - CARD_PADDING * 2 - dial - DIAL_GAP * node.scale;
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
