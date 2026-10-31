import { setIcon, setTooltip } from "obsidian";
import type { BoardMeta } from "../core/types";
import { getTheme } from "../render/themes";
import { Popover } from "./Popover";

export interface BoardMenuHost {
  getBoards(): BoardMeta[];
  getCurrentBoardId(): string | null;
  getImportCount(): number;
  switchBoard(id: string): void;
  createBoard(): void;
  renameCurrentBoard(): void;
  deleteCurrentBoard(): void;
  refreshImports(): void;
  openBoardSettings(): void;
}

export class BoardMenu {
  private readonly popover: Popover;

  constructor(
    root: HTMLElement,
    private readonly host: BoardMenuHost,
  ) {
    this.popover = new Popover(root, "cb-board-menu");
  }

  toggle(anchor: HTMLElement): void {
    this.popover.toggle(
      anchor,
      (el) => this.render(el),
      { placement: "below", align: "start", width: 328, gap: 8 },
    );
  }

  close(): void {
    this.popover.close();
  }

  destroy(): void {
    this.popover.destroy();
  }

  private render(el: HTMLElement): void {
    const header = el.createDiv({ cls: "cb-popover-head cb-board-menu-head" });
    header.createDiv({ cls: "cb-eyebrow", text: "Caseboard" });
    header.createDiv({ cls: "cb-popover-sub", text: "Your investigations" });

    const list = el.createDiv({ cls: "cb-board-list" });
    const currentId = this.host.getCurrentBoardId();
    for (const board of this.host.getBoards()) {
      const row = list.createEl("button", {
        cls: "cb-board-row",
        attr: { type: "button" },
      });
      row.classList.toggle("is-active", board.id === currentId);
      const swatch = row.createSpan({ cls: "cb-board-swatch" });
      swatch.style.background = getTheme(board.theme).swatch[0];
      const text = row.createDiv({ cls: "cb-board-text" });
      text.createDiv({ cls: "cb-board-name", text: board.name });
      text.createDiv({
        cls: "cb-board-meta",
        text: `${getTheme(board.theme).name} · ${formatUpdated(board.updatedAt)}`,
      });
      if (board.id === currentId) {
        const check = row.createSpan({ cls: "cb-board-check" });
        setIcon(check, "check");
      }
      row.addEventListener("click", () => {
        this.close();
        if (board.id !== currentId) this.host.switchBoard(board.id);
      });
    }

    el.createDiv({ cls: "cb-popover-rule" });

    const actions = el.createDiv({ cls: "cb-board-actions" });
    this.action(actions, "plus", "New board", () => {
      this.close();
      this.host.createBoard();
    });
    this.action(actions, "pencil", "Rename", () => {
      this.close();
      this.host.renameCurrentBoard();
    });
    this.action(actions, "settings-2", "Board settings", () => {
      this.close();
      this.host.openBoardSettings();
    });
    this.action(actions, "trash-2", "Delete board", () => {
      this.close();
      this.host.deleteCurrentBoard();
    }, true);

    if (this.host.getImportCount() > 0) {
      const refresh = el.createEl("button", {
        cls: "cb-board-refresh",
        attr: { type: "button" },
      });
      setIcon(refresh.createSpan({ cls: "cb-inline-icon" }), "refresh-cw");
      refresh.createSpan({ text: "Refresh imported chains" });
      refresh.addEventListener("click", () => {
        this.close();
        this.host.refreshImports();
      });
    }
  }

  private action(
    parent: HTMLElement,
    icon: string,
    label: string,
    onClick: () => void,
    danger = false,
  ): void {
    const button = parent.createEl("button", {
      cls: "cb-board-action",
      attr: { type: "button", "aria-label": label },
    });
    button.classList.toggle("is-danger", danger);
    setIcon(button.createSpan({ cls: "cb-inline-icon" }), icon);
    button.createSpan({ cls: "cb-board-action-label", text: label });
    setTooltip(button, label);
    button.addEventListener("click", onClick);
  }
}

function formatUpdated(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  if (sameDay) {
    return `today ${date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`;
  }
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (
    date.getFullYear() === yesterday.getFullYear() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getDate() === yesterday.getDate()
  ) {
    return "yesterday";
  }
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
