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
const INK_POINTS = 96;

/** The mark's own box in card units, per style. */
const MARK_SIZE: Record<VoiceStyle, number> = {
  reel: 44,
  seal: 60,
  analyzer: 32,
  recorder: 30,
  sleeve: 40,
  dial: 38,
};

/** Room the scene needs at the right of the waveform (second reel, broadcast rings). */
const SCENE_TAIL: Record<VoiceStyle, number> = {
  reel: 52,
  seal: 0,
  analyzer: 0,
  recorder: 0,
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

/** Wax that cooled into a scalloped blob rather than a perfect disc. */
function waxPath(cx: number, cy: number, radius: number): string {
  const parts: string[] = [];
  for (let index = 0; index < 72; index++) {
    const angle = (index / 72) * Math.PI * 2;
    const reach =
      radius + radius * 0.09 * Math.sin(angle * 5) + radius * 0.05 * Math.sin(angle * 3 + 1.2);
    parts.push(
      `${index ? "L" : "M"}${(cx + Math.cos(angle) * reach).toFixed(2)} ${(cy + Math.sin(angle) * reach).toFixed(2)}`,
    );
  }
  return parts.join(" ") + " Z";
}

/**
 * The voice-note card. It can wear six different drawings — reel, seal, analyzer,
 * recorder strip, evidence sleeve, receiver dial — picked per card in the panel.
 */
export class AudioCard {
  readonly el: HTMLElement;
  private readonly headEl: HTMLElement;
  private readonly stampEl: HTMLElement;
  private readonly eqEl: HTMLElement;
  private readonly playEl: HTMLElement;
  private readonly sceneEl: HTMLElement;
  private readonly waveEl: HTMLElement;
  private readonly cueEl: HTMLElement;
  private readonly currentEl: HTMLElement;
  private readonly totalEl: HTMLElement;
  private readonly noteEl: HTMLElement;
  private readonly missingEl: HTMLElement;
  private bars: HTMLElement[] = [];
  private barCount = 0;
  private inkPlayed: SVGPathElement | null = null;
  private woundLeft: SVGCircleElement | null = null;
  private woundRight: SVGCircleElement | null = null;
  private sealRing: SVGCircleElement | null = null;
  private style: VoiceStyle | null = null;
  private ratio = 0;
  private node: AudioBoardNode;

  constructor(node: AudioBoardNode, private readonly host: AudioCardHost) {
    this.node = node;
    this.el = createDiv({ cls: "cb-audio" });

    this.sceneEl = this.el.createDiv({ cls: "cb-audio-scene", attr: { "aria-hidden": "true" } });

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
    this.waveEl.empty();
    this.waveEl.appendChild(this.cueEl);
    this.bars = [];
    this.barCount = 0;
    this.inkPlayed = null;
    this.woundLeft = null;
    this.woundRight = null;
    this.sealRing = null;
    this.buildMark(style);
    this.buildScene(style);
  }

  private buildMark(style: VoiceStyle): void {
    const box = MARK_SIZE[style];
    const mark = svg("svg", { viewBox: `0 0 ${box} ${box}`, "aria-hidden": "true" });
    const half = box / 2;

    if (style === "reel") {
      this.woundLeft = svg("circle", { cx: half, cy: half, r: 18 }, "cb-voice-wound") as SVGCircleElement;
      mark.append(
        this.woundLeft,
        svg("circle", { cx: half, cy: half, r: 20 }, "cb-voice-rim"),
        this.spokes(half, 17),
        svg("circle", { cx: half, cy: half, r: 5 }, "cb-voice-hub"),
      );
      mark.appendChild(this.glyphs(half, 5.4, 8.2));
    } else if (style === "seal") {
      this.sealRing = svg("circle", {
        cx: half,
        cy: half,
        r: 30,
        pathLength: 100,
        "stroke-dasharray": "0 100",
        transform: "rotate(-90 32 32)",
      }, "cb-voice-ring") as SVGCircleElement;
      mark.append(
        svg("circle", { cx: half, cy: half, r: 30 }, "cb-voice-track"),
        this.sealRing,
        svg("path", { d: waxPath(half, half, 22) }, "cb-voice-wax"),
        svg("circle", { cx: half, cy: half, r: 15 }, "cb-voice-wax-deep"),
      );
      mark.appendChild(this.glyphs(half, 7, 11, "cb-voice-emboss"));
    } else if (style === "dial") {
      const turn = svg("g", {}, "cb-voice-turn");
      turn.append(
        svg("circle", { cx: half, cy: half, r: 13.5 }, "cb-voice-knob"),
        svg("path", { d: `M${half} ${half - 11.5} V${half - 6}` }, "cb-voice-notch"),
      );
      mark.append(svg("circle", { cx: half, cy: half, r: 18 }, "cb-voice-knob-ring"), turn);
    } else if (style === "sleeve") {
      mark.append(
        svg("path", { d: `M4 9 H36 V31 H4 Z` }, "cb-voice-tab"),
        ...this.glyphParts(half, 5.6, 8.4, "cb-voice-tab-ink"),
      );
    } else if (style === "recorder") {
      mark.append(svg("rect", { x: 2.5, y: 2.5, width: box - 5, height: box - 5, rx: 4 }, "cb-voice-frame"));
      mark.appendChild(this.glyphs(half, 5.2, 8.2, "cb-voice-stamped"));
    } else {
      mark.append(svg("circle", { cx: half, cy: half, r: 14 }, "cb-voice-cue-ring"));
      mark.appendChild(this.glyphs(half, 5, 7.8, "cb-voice-stamped"));
    }

    this.playEl.appendChild(mark);
  }

  private spokes(half: number, reach: number): SVGElement {
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

  private glyphs(half: number, arm: number, spread: number, cls = ""): SVGElement {
    const [play, pause] = this.glyphParts(half, arm, spread, cls);
    const group = svg("g", {});
    group.append(play, pause);
    return group;
  }

  private glyphParts(half: number, arm: number, spread: number, cls = ""): [SVGElement, SVGElement] {
    const prefix = cls ? `${cls} ` : "";
    const play = svg(
      "path",
      {
        d: `M${(half - arm * 0.7).toFixed(2)} ${half - spread} L${half + arm} ${half} L${(half - arm * 0.7).toFixed(2)} ${half + spread} Z`,
      },
      `${prefix}cb-voice-play`,
    );
    const pause = svg("g", {}, `${prefix}cb-voice-pause`);
    pause.append(
      svg("rect", { x: half - arm, y: half - spread, width: arm * 0.62, height: spread * 2, rx: 1.4 }, ""),
      svg("rect", { x: half + arm * 0.38, y: half - spread, width: arm * 0.62, height: spread * 2, rx: 1.4 }, ""),
    );
    return [play, pause];
  }

  private buildScene(style: VoiceStyle): void {
    if (style === "reel") {
      this.sceneEl.createDiv({ cls: "cb-audio-band" });
      const right = svg("svg", { viewBox: "0 0 44 44", "aria-hidden": "true" }, "cb-audio-reel-right");
      this.woundRight = svg("circle", { cx: 22, cy: 22, r: 8 }, "cb-voice-wound") as SVGCircleElement;
      right.append(
        this.woundRight,
        svg("circle", { cx: 22, cy: 22, r: 20 }, "cb-voice-rim"),
        this.spokes(22, 17),
        svg("circle", { cx: 22, cy: 22, r: 5 }, "cb-voice-hub"),
      );
      this.sceneEl.appendChild(right);
    } else if (style === "analyzer") {
      this.sceneEl.createDiv({ cls: "cb-audio-grid" });
    } else if (style === "recorder") {
      this.sceneEl.createDiv({ cls: "cb-audio-perf is-top" });
      this.sceneEl.createDiv({ cls: "cb-audio-perf is-bottom" });
      this.sceneEl.createDiv({ cls: "cb-audio-margin" });
    } else if (style === "sleeve") {
      this.sceneEl.createDiv({ cls: "cb-audio-strip" });
      const sleeve = this.sceneEl.createDiv({ cls: "cb-audio-sleeve" });
      sleeve.createDiv({ cls: "cb-audio-slit" });
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
    this.layoutWave(node);
    this.setProgress(this.ratio);
  }

  /** Rebuilds the columns — or the ink trace — whenever the card width changes. */
  private layoutWave(node: AudioBoardNode): void {
    const mark = MARK_SIZE[node.voiceStyle] * node.scale;
    const usable =
      node.width - CARD_PADDING * 2 - mark - SCENE_TAIL[node.voiceStyle] * node.scale - 11 * node.scale;

    if (node.voiceStyle === "recorder") {
      if (this.inkPlayed) return;
      const box = svg("svg", {
        viewBox: "0 0 100 40",
        preserveAspectRatio: "none",
        "aria-hidden": "true",
      }, "cb-audio-ink");
      const trace = this.inkTrace(resample(node.peaks, INK_POINTS));
      const base = svg("path", { d: trace }, "cb-voice-ink");
      const played = svg("path", {
        d: trace,
        pathLength: 100,
        "stroke-dasharray": "0 100",
      }, "cb-voice-ink is-played") as SVGPathElement;
      box.append(base, played);
      this.waveEl.insertBefore(box, this.cueEl);
      this.inkPlayed = played;
      return;
    }

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

  /** A single continuous trace that swings above and below the line. */
  private inkTrace(peaks: number[]): string {
    const parts: string[] = [];
    for (let index = 0; index < peaks.length; index++) {
      const x = ((index / (peaks.length - 1)) * 100).toFixed(2);
      const reach = peaks[index] * 17;
      const y = (20 + (index % 2 === 0 ? -reach : reach)).toFixed(2);
      parts.push(`${index ? "L" : "M"}${x} ${y}`);
    }
    return parts.join(" ");
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

    const total = this.bars.length || INK_POINTS - 1;
    const reached = Math.round(played * total);
    for (let index = 0; index < this.bars.length; index++) {
      this.bars[index].classList.toggle("is-played", index < reached);
    }
    this.inkPlayed?.setAttribute("stroke-dasharray", `${Math.round(played * 100)} 100`);
    this.sealRing?.setAttribute("stroke-dasharray", `${Math.round(played * 100)} 100`);
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
