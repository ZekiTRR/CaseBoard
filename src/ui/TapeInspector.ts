import { setIcon } from "obsidian";
import type { TapeBoardNode } from "../core/types";

export type TapeStylePatch = Partial<Pick<TapeBoardNode, "accent" | "width" | "height">>;

export interface TapeInspectorHost {
  getSelectedTape(): TapeBoardNode | null;
  beginTapeLiveEdit(label: string): void;
  updateTapeLive(patch: TapeStylePatch): void;
  endTapeLiveEdit(): void;
  changeTapeStyle(patch: TapeStylePatch, label: string): void;
  deleteSelectedTape(): void;
  closeTapeInspector(): void;
}

export class TapeInspector {
  readonly el: HTMLElement;
  private currentId: string | null = null;
  private liveEdited = false;
  private colorInput!: HTMLInputElement;
  private colorChip!: HTMLElement;
  private colorValue!: HTMLElement;
  private lengthInput!: HTMLInputElement;
  private lengthValue!: HTMLElement;
  private widthInput!: HTMLInputElement;
  private widthValue!: HTMLElement;

  constructor(
    root: HTMLElement,
    private readonly host: TapeInspectorHost,
  ) {
    this.el = root.createDiv({ cls: "cb-thread-inspector cb-tape-inspector" });
    this.el.toggleAttribute("hidden", true);
    this.build();
  }

  setTape(tape: TapeBoardNode | null): void {
    if (this.liveEdited && (!tape || tape.id !== this.currentId)) this.finishLive();
    if (!tape) {
      this.el.toggleAttribute("hidden", true);
      this.el.classList.remove("is-open");
      this.currentId = null;
      this.liveEdited = false;
      return;
    }
    this.currentId = tape.id;
    this.el.removeAttribute("hidden");
    window.requestAnimationFrame(() => this.el.classList.add("is-open"));
    this.sync(tape);
  }

  destroy(): void {
    this.el.remove();
  }

  private build(): void {
    const head = this.el.createDiv({ cls: "cb-inspector-head" });
    const titles = head.createDiv({ cls: "cb-inspector-titles" });
    titles.createDiv({ cls: "cb-eyebrow", text: "Material" });
    const line = titles.createDiv({ cls: "cb-inspector-thread" });
    line.createSpan({ cls: "cb-thread-color-dot cb-tape-inspector-dot" });
    line.createSpan({ cls: "cb-inspector-endpoints", text: "Tape strip" });
    const close = head.createEl("button", {
      cls: "cb-icon-button cb-inspector-close",
      attr: { type: "button", "aria-label": "Close tape panel" },
    });
    setIcon(close, "x");
    close.addEventListener("click", () => this.host.closeTapeInspector());

    const body = this.el.createDiv({ cls: "cb-inspector-body" });
    body.createDiv({ cls: "cb-field-label", text: "Colour" });
    const colorButton = body.createEl("label", {
      cls: "cb-tape-color-button",
      attr: { title: "Pick a tape colour" },
    });
    this.colorChip = colorButton.createDiv({ cls: "cb-tape-color-chip" });
    this.colorValue = colorButton.createDiv({ cls: "cb-tape-color-text" });
    this.colorInput = colorButton.createEl("input", {
      attr: { type: "color", "aria-label": "Tape colour" },
    });
    this.colorInput.addEventListener("input", () => {
      if (!this.currentId) return;
      if (!this.liveEdited) {
        this.host.beginTapeLiveEdit("Tape colour");
        this.liveEdited = true;
      }
      this.host.updateTapeLive({ accent: this.colorInput.value });
      this.updateColor(this.colorInput.value);
    });
    this.colorInput.addEventListener("change", () => this.finishLive());

    const length = this.slider(body, "Length", 24, 640, 1);
    this.lengthInput = length.input;
    this.lengthValue = length.valueEl;
    this.lengthInput.addEventListener("input", () => {
      if (!this.currentId) return;
      if (!this.liveEdited) {
        this.host.beginTapeLiveEdit("Tape length");
        this.liveEdited = true;
      }
      const value = Number(this.lengthInput.value);
      this.lengthValue.textContent = `${Math.round(value)} px`;
      this.host.updateTapeLive({ width: value });
    });
    this.lengthInput.addEventListener("change", () => this.finishLive());
    this.lengthInput.addEventListener("pointerup", () => this.finishLive());

    const width = this.slider(body, "Width", 8, 80, 1);
    this.widthInput = width.input;
    this.widthValue = width.valueEl;
    this.widthInput.addEventListener("input", () => {
      if (!this.currentId) return;
      if (!this.liveEdited) {
        this.host.beginTapeLiveEdit("Tape width");
        this.liveEdited = true;
      }
      const value = Number(this.widthInput.value);
      this.widthValue.textContent = `${Math.round(value)} px`;
      this.host.updateTapeLive({ height: value });
    });
    this.widthInput.addEventListener("change", () => this.finishLive());
    this.widthInput.addEventListener("pointerup", () => this.finishLive());

    body.createDiv({
      cls: "cb-tape-inspector-hint",
      text: "Length and width can also be adjusted with the corner handles.",
    });

    const footer = this.el.createDiv({ cls: "cb-inspector-foot" });
    const remove = footer.createEl("button", {
      cls: "cb-danger-button",
      attr: { type: "button" },
    });
    setIcon(remove.createSpan({ cls: "cb-inline-icon" }), "trash-2");
    remove.createSpan({ text: "Remove tape" });
    remove.addEventListener("click", () => this.host.deleteSelectedTape());
    this.colorChip.dataset.role = "tape-colour-preview";
  }

  private sync(tape: TapeBoardNode): void {
    this.updateColor(tape.accent);
    this.lengthInput.max = String(Math.max(640, Math.ceil(tape.width)));
    this.lengthInput.value = String(Math.round(tape.width));
    this.lengthValue.textContent = `${Math.round(tape.width)} px`;
    this.widthInput.max = String(Math.max(80, Math.ceil(tape.height)));
    this.widthInput.value = String(Math.round(tape.height));
    this.widthValue.textContent = `${Math.round(tape.height)} px`;
  }

  private updateColor(color: string): void {
    this.colorInput.value = toColorInput(color);
    this.colorChip.style.background = color;
    this.colorValue.textContent = color.toUpperCase();
    this.el.style.setProperty("--cb-tape-current", color);
  }

  private finishLive(): void {
    if (!this.liveEdited) return;
    this.liveEdited = false;
    this.host.endTapeLiveEdit();
  }

  private slider(
    parent: HTMLElement,
    label: string,
    min: number,
    max: number,
    step: number,
  ): { input: HTMLInputElement; valueEl: HTMLElement } {
    const row = parent.createDiv({ cls: "cb-slider-row" });
    const head = row.createDiv({ cls: "cb-slider-head" });
    head.createSpan({ cls: "cb-field-label", text: label });
    const valueEl = head.createSpan({ cls: "cb-slider-value", text: "" });
    const input = row.createEl("input", {
      cls: "cb-slider",
      attr: {
        type: "range",
        min: String(min),
        max: String(max),
        step: String(step),
        "aria-label": label,
      },
    });
    return { input, valueEl };
  }
}

function toColorInput(color: string): string {
  return /^#[0-9a-f]{6}$/i.test(color) ? color : "#cbb98f";
}
