import { setIcon, setTooltip } from "obsidian";
import type { AudioBoardNode, VoiceStyle } from "../core/types";
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
const MIN_BARS = 12;
const MAX_BARS = 84;

/** The mark's own box in card units, per style. */
const MARK_SIZE: Record<VoiceStyle, number> = {
  reel: 44,
  analyzer: 32,
  sleeve: 40,
  dial: 38,
};

/** Room the scene needs at the right of the waveform (second reel, broadcast rings). */
const SCENE_TAIL: Record<VoiceStyle, number> = {
  reel: 52,
  analyzer: 0,
  sleeve: 0,
  dial: 36,
};

const SVG_NS = "http://www.w3.org/2000/svg";

function svg(tag: string, attrs: Record<string, string | number>, cls = ""): SVGElement {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, String(value));
  if (cls) node.setAttribute("class", cls);
  return node;
}

function spokes(half: number, reach: number): SVGElement {
  const group = svg("g", {}, "cb-voice-spin");
  group.append(
    svg("path", { d: `M${half} ${half - reach} V${half + reach}` }, "cb-voice-spoke"),
    svg(
      "path",
      {
        d: `M${(half - reach * 0.87).toFixed(2)} ${(half - reach * 0.5).toFixed(2)} L${(half + reach * 0.87).toFixed(2)} ${(half + reach * 0.5).toFixed(2)}`,
      },
      "cb-voice-spoke",
    ),
    svg(
      "path",
      {
        d: `M${(half - reach * 0.87).toFixed(2)} ${(half + reach * 0.5).toFixed(2)} L${(half + reach * 0.87).toFixed(2)} ${(half - reach * 0.5).toFixed(2)}`,
      },
      "cb-voice-spoke",
    ),
  );
  return group;
}

function reel(half: number, wound: number): { node: SVGElement; woundEl: SVGCircleElement } {
  const woundEl = svg("circle", { cx: half, cy: half, r: wound }, "cb-voice-wound") as SVGCircleElement;
  const node = svg("svg", { viewBox: `0 0 ${half * 2} ${half * 2}`, "aria-hidden": "true" });
  node.append(
    woundEl,
    svg("circle", { cx: half, cy: half, r: half - 2 }, "cb-voice-rim"),
    spokes(half, half - 5),
    svg("circle", { cx: half, cy: half, r: 5 }, "cb-voice-hub"),
  );
  return { node, woundEl };
}

function glyphs(half: number, arm: number, spread: number, cls = ""): SVGElement {
  const prefix = cls ? `${cls} ` : "";
  const group = svg("g", {});
  group.append(
    svg(
      "path",
      {
        d: `M${(half - arm * 0.7).toFixed(2)} ${half - spread} L${half + arm} ${half} L${(half - arm * 0.7).toFixed(2)} ${half + spread} Z`,
      },
      `${prefix}cb-voice-play`,
    ),
    (() => {
      const pause = svg("g", {}, `${prefix}cb-voice-pause`);
      pause.append(
        svg("rect", { x: half - arm, y: half - spread, width: arm * 0.62, height: spread * 2, rx: 1.4 }, ""),
        svg("rect", { x: half + arm * 0.38, y: half - spread, width: arm * 0.62, height: spread * 2, rx: 1.4 }, ""),
      );
      return pause;
    })(),
  );
  return group;
}

/**
 * The voice-note card. It can wear four drawings — reel, analyzer, evidence sleeve,
 * receiver dial — picked per card in the Recording panel.
 */
export class AudioCard {
  readonly el: HTMLElement;
  private readonly headEl: HTMLElement;
  private readonly stampEl: HTMLElement;
  private readonly eqEl: HTMLElement;
  private readonly playEl: HTMLElement;
  private readonly waveEl: HTMLElement;
  private readonly sceneEl: HTMLElement;
  private readonly barsEl: HTMLElement;
  private readonly cueEl: HTMLElement;
  private readonly currentEl: HTMLElement;
  private readonly totalEl: HTMLElement;
  private readonly noteEl: HTMLElement;
  private readonly missingEl: HTMLElement;
  private bars: HTMLElement[] = [];
  private barCount = 0;
  private woundLeft: SVGCircleElement | null = null;
  private woundRight: SVGCircleElement | null = null;
  private style: VoiceStyle | null = null;
  private ratio = 0;
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

    const box = main.createDiv({ cls: "cb-audio-box" });
    this.waveEl = box.createDiv({ cls: "cb-audio-wave", attr: { "data-audio-control": "wave" } });
    this.sceneEl = this.waveEl.createDiv({ cls: "cb-audio-scene", attr: { "aria-hidden": "true" } });
    this.barsEl = this.waveEl.createDiv({ cls: "cb-audio-bars" });
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

  /** Rebuilds the mark and the scene only when the card changes its drawing. */
  private dress(style: VoiceStyle): void {
    if (style === this.style) return;
    this.style = style;
    this.el.dataset.voice = style;
    this.sceneEl.empty();
    this.playEl.empty();
    this.barsEl.empty();
    for (const child of Array.from(this.waveEl.children)) {
      if (child !== this.sceneEl && child !== this.barsEl && child !== this.cueEl) child.remove();
    }
    this.bars = [];
    this.barCount = 0;
    this.woundLeft = null;
    this.woundRight = null;
    this.buildMark(style);
    this.buildScene(style);
  }

  private buildMark(style: VoiceStyle): void {
    const box = MARK_SIZE[style];
    const half = box / 2;
    const mark = svg("svg", { viewBox: `0 0 ${box} ${box}`, "aria-hidden": "true" });

    if (style === "reel") {
      this.woundLeft = svg("circle", { cx: half, cy: half, r: 18 }, "cb-voice-wound") as SVGCircleElement;
      mark.append(
        this.woundLeft,
        svg("circle", { cx: half, cy: half, r: half - 2 }, "cb-voice-rim"),
        spokes(half, half - 5),
        svg("circle", { cx: half, cy: half, r: 5 }, "cb-voice-hub"),
        glyphs(half, 5.4, 8.2),
      );
    } else if (style === "dial") {
      const turn = svg("g", {}, "cb-voice-turn");
      turn.append(
        svg("circle", { cx: half, cy: half, r: 13.5 }, "cb-voice-knob"),
        svg("path", { d: `M${half} ${half - 11.5} V${half - 6}` }, "cb-voice-notch"),
      );
      mark.append(svg("circle", { cx: half, cy: half, r: 18 }, "cb-voice-knob-ring"), turn);
    } else if (style === "sleeve") {
      mark.append(svg("path", { d: "M4 9 H36 V31 H4 Z" }, "cb-voice-tab"));
      mark.appendChild(glyphs(half, 5.6, 8.4, "cb-voice-tab-ink"));
    } else {
      mark.append(svg("circle", { cx: half, cy: half, r: 14 }, "cb-voice-cue-ring"));
      mark.appendChild(glyphs(half, 5, 7.8, "cb-voice-stamped"));
    }

    this.playEl.appendChild(mark);
  }

  private buildScene(style: VoiceStyle): void {
    if (style === "reel") {
      this.sceneEl.createDiv({ cls: "cb-audio-band" });
      const right = reel(22, 8);
      this.woundRight = right.woundEl;
      right.node.setAttribute("class", "cb-audio-reel-right");
      this.sceneEl.appendChild(right.node);
    } else if (style === "sleeve") {
      this.sceneEl.createDiv({ cls: "cb-audio-strip" });
      // the paper front is above the bars: the take disappears into the file as it is heard
      this.waveEl.createDiv({ cls: "cb-audio-sleeve" });
    } else if (style === "dial") {
      this.sceneEl.createDiv({ cls: "cb-audio-panel" });
      const ripples = svg("svg", { viewBox: "0 0 30 44", "aria-hidden": "true" }, "cb-audio-ripples");
      ripples.append(
        svg("path", { d: "M6 13 Q 14 22 6 31" }, "cb-voice-ripple"),
        svg("path", { d: "M12 7 Q 24 22 12 37" }, "cb-voice-ripple"),
        svg("path", { d: "M18 1 Q 34 22 18 43" }, "cb-voice-ripple"),
      );
      this.sceneEl.appendChild(ripples);
    }
  }

  private bindWaveEvents(): void {
    this.waveEl.addEventListener("pointerdown", (event) => event.stopPropagation());
    this.waveEl.addEventListener("pointermove", (event) => {
      const ratio = this.ratioFromEvent(event.clientX);
      this.cueEl.setCssProps({ "--cb-audio-cue": ratio.toFixed(4) });
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
    const rect = this.barsEl.getBoundingClientRect();
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
    this.dress(node.voiceStyle);
    this.stampEl.textContent = formatClock(node.createdAt);
    this.totalEl.textContent = formatTime(node.duration);
    this.noteEl.textContent = node.caption;
    this.noteEl.hidden = node.caption.trim().length === 0;
    this.el.setCssProps({
      "--cb-audio-scale": String(node.scale),
      "--cb-audio-stamp-scale": String(node.stampScale),
      "--cb-audio-mark": `${Math.round(MARK_SIZE[node.voiceStyle] * node.scale)}px`,
      "--cb-audio-tail": `${Math.round(SCENE_TAIL[node.voiceStyle] * node.scale)}px`,
    });
    this.layoutBars(node);
    this.setProgress(this.ratio);
  }

  /** Rebuilds the columns whenever the card width or the drawing changes. */
  private layoutBars(node: AudioBoardNode): void {
    const usable =
      node.width -
      CARD_PADDING * 2 -
      MARK_SIZE[node.voiceStyle] * node.scale -
      SCENE_TAIL[node.voiceStyle] * node.scale -
      11 * node.scale;
    const wanted = clamp(Math.floor(usable / BAR_PITCH), MIN_BARS, MAX_BARS);
    if (wanted === this.barCount && this.bars.length > 0) {
      this.paintBars(node, wanted);
      return;
    }
    this.barCount = wanted;
    for (const bar of this.bars) bar.remove();
    this.bars = [];
    for (let index = 0; index < wanted; index++) {
      this.bars.push(this.barsEl.createSpan({ cls: "cb-audio-bar" }));
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
    const played = clamp(ratio, 0, 1);
    this.ratio = played;
    this.el.setCssProps({
      "--cb-audio-p": played.toFixed(4),
      "--cb-audio-pull": `${(played * 100).toFixed(2)}%`,
    });

    const reached = Math.round(played * this.bars.length);
    for (let index = 0; index < this.bars.length; index++) {
      this.bars[index].classList.toggle("is-played", index < reached);
    }
    this.woundLeft?.setAttribute("r", (18 - played * 10).toFixed(2));
    this.woundRight?.setAttribute("r", (8 + played * 10).toFixed(2));
    this.currentEl.textContent = formatTime(played * this.node.duration);
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
