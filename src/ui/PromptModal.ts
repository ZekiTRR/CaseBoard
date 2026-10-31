import { App, Modal } from "obsidian";
import type { ThemeId } from "../core/types";
import { applyThemeTokens } from "../render/ThemeManager";

export interface PromptModalOptions {
  title: string;
  description: string;
  value: string;
  cta: string;
  theme: ThemeId;
  placeholder?: string;
  onSave: (value: string) => string | null;
}

export class PromptModal extends Modal {
  private input!: HTMLInputElement;
  private errorEl!: HTMLElement;

  constructor(
    app: App,
    private readonly options: PromptModalOptions,
  ) {
    super(app);
    this.modalEl.addClass("caseboard-modal", "cb-prompt-modal");
    applyThemeTokens(this.modalEl, options.theme);
  }

  onOpen(): void {
    const content = this.contentEl;
    content.addClass("cb-modal-content");
    content.empty();

    const header = content.createDiv({ cls: "cb-modal-head" });
    const titles = header.createDiv({ cls: "cb-modal-titles" });
    titles.createDiv({ cls: "cb-eyebrow", text: "Caseboard" });
    titles.createDiv({ cls: "cb-modal-title", text: this.options.title });
    titles.createDiv({ cls: "cb-modal-desc", text: this.options.description });

    const form = content.createEl("form", { cls: "cb-prompt-form" });
    this.input = form.createEl("input", {
      cls: "cb-text-input",
      attr: { type: "text", placeholder: this.options.placeholder ?? "" },
    });
    this.input.value = this.options.value;

    const footer = form.createDiv({ cls: "cb-modal-footer" });
    this.errorEl = footer.createDiv({ cls: "cb-import-error", attr: { "aria-live": "polite" } });
    const actions = footer.createDiv({ cls: "cb-modal-actions" });
    const cancel = actions.createEl("button", {
      cls: "cb-ghost-button",
      text: "Cancel",
      attr: { type: "button" },
    });
    cancel.addEventListener("click", () => this.close());
    actions.createEl("button", {
      cls: "cb-primary-button",
      text: this.options.cta,
      attr: { type: "submit" },
    });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      this.submit();
    });

    window.setTimeout(() => {
      this.input.focus();
      this.input.select();
    }, 40);
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private submit(): void {
    const value = this.input.value.trim();
    if (!value) {
      this.errorEl.textContent = "A name is required.";
      return;
    }
    const error = this.options.onSave(value);
    if (error) {
      this.errorEl.textContent = error;
      return;
    }
    this.close();
  }
}
