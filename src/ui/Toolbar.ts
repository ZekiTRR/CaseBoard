import { setIcon, setTooltip } from "obsidian";
import type { BoardTool } from "../core/types";

export interface ToolbarActions {
  getTool(): BoardTool;
  setTool(tool: BoardTool): void;
  addNote(): void;
  addText(): void;
  addImage(event: MouseEvent): void;
  openImport(): void;
  openThemePicker(anchor: HTMLElement): void;
  openBoardSettings(): void;
  undo(): void;
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;
  saveNow(): void;
  toggleFocus(): void;
  toggleLoupe(): void;
}

export class Toolbar {
  readonly el: HTMLElement;
  private readonly buttons = new Map<string, HTMLButtonElement>();
  private focusButton!: HTMLButtonElement;
  private loupeButton!: HTMLButtonElement;

  constructor(
    root: HTMLElement,
    private readonly actions: ToolbarActions,
  ) {
    this.el = root.createDiv({ cls: "cb-toolbar", attr: { role: "toolbar" } });

    const tools = this.group("tools");
    this.toolButton(tools, "select", "mouse-pointer-2", "Select", "V");
    this.toolButton(tools, "pan", "hand", "Pan", "H");
    this.toolButton(tools, "thread", "git-branch", "Thread", "C");
    this.loupeButton = this.button(tools, "loupe", "search", "Loupe", "Z", () =>
      actions.toggleLoupe(),
    );
    this.toolButton(tools, "tape", "bandage", "Tape", "G");
    this.separator(tools);
    this.button(tools, "note", "sticky-note", "Pin note", "N", () => actions.addNote());
    this.button(tools, "text", "type", "Text block", "T", () => actions.addText());
    this.button(tools, "image", "image", "Add photo", "I", (event) =>
      actions.addImage(event),
    );

    const middle = this.group("actions");
    this.button(middle, "import", "download", "Import linked notes", "", () => actions.openImport());
    this.button(middle, "theme", "palette", "Board theme", "", (event) =>
      actions.openThemePicker(event.currentTarget as HTMLElement),
    );
    this.button(middle, "settings", "sliders-horizontal", "Board settings", "", () =>
      actions.openBoardSettings(),
    );

    const history = this.group("history");
    this.button(history, "undo", "undo-2", "Undo", "Ctrl Z", () => actions.undo());
    this.button(history, "redo", "redo-2", "Redo", "Ctrl Shift Z", () => actions.redo());
    this.button(history, "save", "save", "Save board", "Ctrl S", () => actions.saveNow());
    this.focusButton = this.button(history, "focus", "maximize", "Focus mode", "F", () =>
      actions.toggleFocus(),
    );

    this.updateTool(actions.getTool());
    this.updateHistory(actions.canUndo(), actions.canRedo());
  }

  updateTool(tool: BoardTool): void {
    for (const id of ["select", "pan", "thread", "tape"] as BoardTool[]) {
      this.buttons.get(id)?.classList.toggle("is-active", id === tool);
    }
    this.el.dataset.tool = tool;
  }

  updateHistory(canUndo: boolean, canRedo: boolean): void {
    const undo = this.buttons.get("undo");
    const redo = this.buttons.get("redo");
    if (undo) undo.disabled = !canUndo;
    if (redo) redo.disabled = !canRedo;
  }

  setLoupe(active: boolean): void {
    this.loupeButton.classList.toggle("is-active", active);
    this.el.classList.toggle("is-loupe", active);
  }

  setFocusMode(focused: boolean): void {
    this.focusButton.classList.toggle("is-active", focused);
    this.focusButton.empty();
    setIcon(this.focusButton, focused ? "minimize" : "maximize");
    setTooltip(this.focusButton, focused ? "Exit focus mode" : "Focus mode");
  }

  setSaving(saving: boolean): void {
    const button = this.buttons.get("save");
    if (!button) return;
    button.classList.toggle("is-busy", saving);
  }

  destroy(): void {
    this.el.remove();
  }

  private group(name: string): HTMLElement {
    return this.el.createDiv({ cls: `cb-tool-group cb-tool-${name}` });
  }

  private separator(parent: HTMLElement): void {
    parent.createDiv({ cls: "cb-tool-separator" });
  }

  private toolButton(
    parent: HTMLElement,
    id: BoardTool,
    icon: string,
    label: string,
    shortcut: string,
  ): HTMLButtonElement {
    const button = this.makeButton(parent, icon, label, shortcut);
    button.dataset.tool = id;
    button.addEventListener("click", () => this.actions.setTool(id));
    this.buttons.set(id, button);
    return button;
  }

  private button(
    parent: HTMLElement,
    id: string,
    icon: string,
    label: string,
    shortcut: string,
    onClick: (event: MouseEvent) => void,
  ): HTMLButtonElement {
    const button = this.makeButton(parent, icon, label, shortcut);
    button.addEventListener("click", (event) => onClick(event));
    this.buttons.set(id, button);
    return button;
  }

  private makeButton(
    parent: HTMLElement,
    icon: string,
    label: string,
    shortcut: string,
  ): HTMLButtonElement {
    const button = parent.createEl("button", {
      cls: "cb-tool-button",
      attr: { type: "button", "aria-label": label },
    });
    setIcon(button, icon);
    setTooltip(button, shortcut ? `${label}  (${shortcut})` : label);
    return button;
  }
}
