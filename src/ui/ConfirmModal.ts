import { Modal } from "obsidian";
import type { App } from "obsidian";

export interface ConfirmModalOptions {
  heading: string;
  body: string;
  confirmText: string;
  cancelText: string;
  destructive?: boolean;
}

export class ConfirmModal extends Modal {
  private handled = false;

  constructor(
    app: App,
    private readonly options: ConfirmModalOptions,
    private readonly onConfirm: () => void,
  ) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText(this.options.heading);

    const content = this.contentEl;
    content.empty();
    content.createDiv({ cls: "cb-confirm-text", text: this.options.body });

    const buttons = content.createDiv({ cls: "modal-button-container" });
    const cancel = buttons.createEl("button", { text: this.options.cancelText });
    cancel.addEventListener("click", () => this.close());

    const confirm = buttons.createEl("button", {
      text: this.options.confirmText,
      cls: this.options.destructive ? "mod-warning" : "mod-cta",
    });
    confirm.addEventListener("click", () => {
      if (this.handled) return;
      this.handled = true;
      this.close();
      this.onConfirm();
    });
    confirm.focus();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
