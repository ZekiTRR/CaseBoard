import { setIcon, setTooltip } from "obsidian";
import type { AudioBoardNode, VoiceStyle } from "../core/types";
import { VOICE_STYLES, VOICE_STYLE_LABELS } from "../core/types";
import { paintAllSliders, watchSliderFill } from "./sliderFill";

export interface AudioStylePatch {
  scale?: number;
  stampScale?: number;
}

export interface AudioInspectorHost {
  getSelectedAudio(): AudioBoardNode | null;
  beginAudioLiveEdit(label: string): void;
  updateAudioLive(patch: AudioStylePatch): void;
  endAudioLiveEdit(): void;
  setAudioStyle(style: VoiceStyle): void;
  closeAudioInspector(): void;
}

const SCALE_MIN = 0.6;
const SCALE_MAX = 3;
const STAMP_MIN = 0.7;
const STAMP_MAX = 3;

const STYLE_HINTS: Record<VoiceStyle, string> = {
  reel: "Two reels and a tape band; the take winds from one spool to the other.",
  analyzer: "Graph paper and a red cue in a thin ring; played bars turn red.",
  sleeve: "An evidence sleeve: the tape slides back into the file as the take is heard.",
  dial: "A receiver dial: passed ticks light up, the knob turns with progress.",
};

/**
 * The material panel for a recording: one drag of the slider resizes the whole
 * sticker, another sizes the timestamp — no repeated context-menu taps.
 */
export class AudioInspector {
  readonly el: HTMLElement;
  private currentId: string | null = null;
  private liveEdited = false;
  private readonly scaleInput: HTMLInputElement;
  private readonly scaleValue: HTMLElement;
  private readonly stampInput: HTMLInputElement;
  private readonly stampValue: HTMLElement;
  private styleButtons: HTMLButtonElement[] = [];

  constructor(
    root: HTMLElement,
    private readonly host: AudioInspectorHost,
  ) {
    this.el = root.createDiv({ cls: "cb-thread-inspector cb-audio-inspector" });
    this.el.toggleAttribute("hidden", true);
    this.el.classList.remove("is-open");

    const head = this.el.createDiv({ cls: "cb-inspector-head" });
    const titles = head.createDiv({ cls: "cb-inspector-titles" });
    const line = titles.createDiv({ cls: "cb-inspector-thread" });
    line.createSpan({ cls: "cb-thread-color-dot cb-audio-inspector-dot" });
    line.createSpan({ cls: "cb-inspector-endpoints", text: "Recording" });
    const close = head.createEl("button", {
      cls: "cb-icon-button cb-inspector-close",
      attr: { type: "button", "aria-label": "Close recording panel" },
    });
    setIcon(close, "x");
    close.addEventListener("click", () => this.host.closeAudioInspector());

    const body = this.el.createDiv({ cls: "cb-inspector-body" });
    const scale = this.slider(body, "Card scale");
    this.scaleInput = scale.input;
    this.scaleValue = scale.valueEl;
    this.scaleInput.addEventListener("input", () => {
      if (!this.currentId) return;
      this.beginLive("Scale card");
      const value = Number(this.scaleInput.value) / 100;
      this.scaleValue.textContent = `${Math.round(value * 100)}%`;
      this.host.updateAudioLive({ scale: value });
    });

    const stamp = this.slider(body, "Date size");
    this.stampInput = stamp.input;
    this.stampValue = stamp.valueEl;
    this.stampInput.addEventListener("input", () => {
      if (!this.currentId) return;
      this.beginLive("Resize the date");
      const value = Number(this.stampInput.value) / 100;
      this.stampValue.textContent = `${Math.round(value * 100)}%`;
      this.host.updateAudioLive({ stampScale: value });
    });

    for (const input of [this.scaleInput, this.stampInput]) {
      input.addEventListener("change", () => this.finishLive());
      input.addEventListener("pointerup", () => this.finishLive());
    }

    body.createDiv({ cls: "cb-field-label cb-voice-styles-label", text: "Drawing" });
    const grid = body.createDiv({ cls: "cb-voice-styles" });
    this.styleButtons = VOICE_STYLES.map((style) => {
      const chip = grid.createEl("button", {
        cls: "cb-voice-style",
        attr: { type: "button", "data-voice-style": style },
      });
      chip.createSpan({ text: VOICE_STYLE_LABELS[style] });
      setTooltip(chip, STYLE_HINTS[style]);
      chip.addEventListener("click", () => {
        if (!this.currentId) return;
        this.host.setAudioStyle(style);
      });
      return chip;
    });
  }

  setAudio(node: AudioBoardNode | null): void {
    if (this.liveEdited && (!node || node.id !== this.currentId)) this.finishLive();
    if (!node) {
      this.currentId = null;
      this.liveEdited = false;
      this.el.toggleAttribute("hidden", true);
      this.el.classList.remove("is-open");
      return;
    }
    this.currentId = node.id;
    this.el.removeAttribute("hidden");
    window.requestAnimationFrame(() => this.el.classList.add("is-open"));
    this.sync(node);
  }

  destroy(): void {
    this.el.remove();
  }

  private sync(node: AudioBoardNode): void {
    this.scaleInput.value = String(Math.round(node.scale * 100));
    this.scaleValue.textContent = `${Math.round(node.scale * 100)}%`;
    this.stampInput.value = String(Math.round(node.stampScale * 100));
    this.stampValue.textContent = `${Math.round(node.stampScale * 100)}%`;
    paintAllSliders(this.el);
    for (const chip of this.styleButtons) {
      chip.classList.toggle("is-active", chip.dataset.voiceStyle === node.voiceStyle);
    }
  }

  private beginLive(label: string): void {
    if (this.liveEdited) return;
    this.host.beginAudioLiveEdit(label);
    this.liveEdited = true;
  }

  private finishLive(): void {
    if (!this.liveEdited) return;
    this.liveEdited = false;
    this.host.endAudioLiveEdit();
  }

  private slider(parent: HTMLElement, label: string): { input: HTMLInputElement; valueEl: HTMLElement } {
    const bounds = label === "Card scale" ? [SCALE_MIN, SCALE_MAX] : [STAMP_MIN, STAMP_MAX];
    const row = parent.createDiv({ cls: "cb-slider-row cb-audio-slider" });
    row.createDiv({ cls: "cb-field-label", text: label });
    const track = row.createDiv({ cls: "cb-audio-slider-track" });
    const lo = Math.round(bounds[0] * 100);
    const hi = Math.round(bounds[1] * 100);
    const input = watchSliderFill(
      track.createEl("input", {
        cls: "cb-slider",
        attr: {
          type: "range",
          min: String(lo),
          max: String(hi),
          step: "1",
          "aria-label": label,
        },
      }),
    );
    // a notch where the card returns to its own size
    input.setCssProps({ "--cb-slider-home": `${(((100 - lo) / (hi - lo)) * 100).toFixed(2)}%` });
    const valueEl = track.createSpan({ cls: "cb-slider-value", text: "" });
    return { input, valueEl };
  }
}
