import { App, Modal, setIcon } from "obsidian";
import type { ThemeId } from "../core/types";
import { applyThemeTokens } from "../render/ThemeManager";

export interface ColorPickerOptions {
  title: string;
  description: string;
  initial: string;
  theme: ThemeId;
  onPick: (color: string) => void;
}

export class ColorPickerModal extends Modal {
  private color: string;
  private picker!: HTMLInputElement;
  private hex!: HTMLInputElement;
  private preview!: HTMLElement;
  private errorEl!: HTMLElement;

  constructor(
    app: App,
    private readonly options: ColorPickerOptions,
  ) {
    super(app);
    this.color = normalizeColor(options.initial);
    this.modalEl.addClass("caseboard-modal", "cb-color-picker-modal");
    applyThemeTokens(this.modalEl, options.theme);
  }

  onOpen(): void {
    const content = this.contentEl;
    content.addClass("cb-modal-content");
    content.empty();

    const header = content.createDiv({ cls: "cb-modal-head" });
    const mark = header.createDiv({ cls: "cb-modal-mark" });
    setIcon(mark, "pipette");
    const titles = header.createDiv({ cls: "cb-modal-titles" });
    titles.createDiv({ cls: "cb-eyebrow", text: "Colour" });
    titles.createDiv({ cls: "cb-modal-title", text: this.options.title });
    titles.createDiv({ cls: "cb-modal-desc", text: this.options.description });

    const form = content.createEl("form", { cls: "cb-color-picker-form" });
    const body = form.createDiv({ cls: "cb-color-picker-body" });
    this.preview = body.createDiv({ cls: "cb-color-picker-preview" });
    this.preview.style.background = this.color;

    const pickerRow = body.createDiv({ cls: "cb-color-picker-field" });
    pickerRow.createDiv({ cls: "cb-field-label", text: "Pick a colour" });
    this.picker = pickerRow.createEl("input", {
      cls: "cb-color-picker-input",
      attr: { type: "color", value: this.color, "aria-label": "Colour" },
    });

    const hexRow = body.createDiv({ cls: "cb-color-picker-field" });
    hexRow.createDiv({ cls: "cb-field-label", text: "Hex value" });
    this.hex = hexRow.createEl("input", {
      cls: "cb-text-input cb-color-picker-hex",
      attr: { type: "text", value: this.color.toUpperCase(), spellcheck: "false" },
    });
    this.errorEl = form.createDiv({ cls: "cb-import-error", attr: { "aria-live": "polite" } });

    const footer = form.createDiv({ cls: "cb-modal-footer" });
    const actions = footer.createDiv({ cls: "cb-modal-actions" });
    const cancel = actions.createEl("button", {
      cls: "cb-ghost-button",
      text: "Cancel",
      attr: { type: "button" },
    });
    cancel.addEventListener("click", () => this.close());
    actions.createEl("button", {
      cls: "cb-primary-button",
      text: "Apply colour",
      attr: { type: "submit" },
    });

    this.picker.addEventListener("input", () => this.setColor(this.picker.value));
    this.hex.addEventListener("input", () => {
      const value = parseColor(this.hex.value);
      if (!value) {
        this.errorEl.textContent = "Use a six-digit hex colour, for example #b3352d.";
        return;
      }
      this.errorEl.textContent = "";
      this.setColor(value, false);
    });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const value = parseColor(this.hex.value);
      if (!value) {
        this.errorEl.textContent = "Use a six-digit hex colour, for example #b3352d.";
        return;
      }
      this.color = value;
      this.options.onPick(value);
      this.close();
    });

    window.setTimeout(() => this.picker.focus(), 40);
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private setColor(value: string, syncHex = true): void {
    this.color = value;
    this.preview.style.background = value;
    this.picker.value = value;
    if (syncHex) {
      this.hex.value = value.toUpperCase();
      this.errorEl.textContent = "";
    }
  }
}

function normalizeColor(value: string): string {
  return parseColor(value) ?? "#b3352d";
}

function parseColor(value: string): string | null {
  const trimmed = value.trim();
  return /^#[0-9a-f]{6}$/i.test(trimmed) ? trimmed.toLowerCase() : null;
}
