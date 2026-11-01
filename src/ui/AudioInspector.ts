import { setIcon } from "obsidian";
import type { AudioBoardNode } from "../core/types";

export interface AudioStylePatch {
  scale?: number;
  stampScale?: number;
}

export interface AudioInspectorHost {
  getSelectedAudio(): AudioBoardNode | null;
  beginAudioLiveEdit(label: string): void;
  updateAudioLive(patch: AudioStylePatch): void;
  endAudioLiveEdit(): void;
  closeAudioInspector(): void;
}

const SCALE_MIN = 0.6;
const SCALE_MAX = 3;
const STAMP_MIN = 0.7;
const STAMP_MAX = 3;

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
    const input = track.createEl("input", {
      cls: "cb-slider",
      attr: {
        type: "range",
        min: String(Math.round(bounds[0] * 100)),
        max: String(Math.round(bounds[1] * 100)),
        step: "1",
        "aria-label": label,
      },
    });
    const valueEl = track.createSpan({ cls: "cb-slider-value", text: "" });
    return { input, valueEl };
  }
}
