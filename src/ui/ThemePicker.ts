import { setIcon, setTooltip } from "obsidian";
import type { ThemeId } from "../core/types";
import { getThemeList } from "../render/themes";
import { Popover } from "./Popover";

export class ThemePicker {
  private readonly popover: Popover;

  constructor(
    root: HTMLElement,
    private readonly onPick: (id: ThemeId) => void,
  ) {
    this.popover = new Popover(root, "cb-theme-picker");
  }

  toggle(anchor: HTMLElement, current: ThemeId): void {
    this.popover.toggle(
      anchor,
      (el) => this.render(el, current),
      { placement: "above", width: 342, gap: 12 },
    );
  }

  close(): void {
    this.popover.close();
  }

  destroy(): void {
    this.popover.destroy();
  }

  private render(el: HTMLElement, current: ThemeId): void {
    const header = el.createDiv({ cls: "cb-popover-head" });
    header.createDiv({ cls: "cb-eyebrow", text: "Board surface" });
    header.createDiv({
      cls: "cb-popover-sub",
      text: "Every investigation gets its own atmosphere.",
    });

    const list = el.createDiv({ cls: "cb-theme-list" });
    for (const theme of getThemeList()) {
      const button = list.createEl("button", {
        cls: "cb-theme-row",
        attr: { type: "button", "aria-pressed": String(theme.id === current) },
      });
      button.classList.toggle("is-active", theme.id === current);

      const preview = button.createDiv({ cls: "cb-theme-preview" });
      preview.style.setProperty("--preview-base", theme.swatch[0]);
      preview.style.setProperty("--preview-paper", theme.swatch[1]);
      preview.style.setProperty("--preview-thread", theme.swatch[2]);
      preview.createDiv({ cls: "cb-theme-preview-paper p1" });
      preview.createDiv({ cls: "cb-theme-preview-paper p2" });
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("class", "cb-theme-preview-thread");
      svg.setAttribute("viewBox", "0 0 66 48");
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", "M 10 14 Q 32 32 56 20");
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", theme.swatch[2]);
      path.setAttribute("stroke-width", "1.6");
      path.setAttribute("stroke-linecap", "round");
      svg.appendChild(path);
      preview.appendChild(svg);

      const text = button.createDiv({ cls: "cb-theme-text" });
      text.createDiv({ cls: "cb-theme-name", text: theme.name });
      text.createDiv({ cls: "cb-theme-tagline", text: theme.tagline });

      const check = button.createDiv({ cls: "cb-theme-check" });
      if (theme.id === current) setIcon(check, "check");

      button.addEventListener("click", () => {
        this.onPick(theme.id);
        for (const row of Array.from(list.children)) {
          row.classList.remove("is-active");
          (row as HTMLElement).setAttribute("aria-pressed", "false");
          const icon = row.querySelector<HTMLElement>(".cb-theme-check");
          icon?.empty();
        }
        button.classList.add("is-active");
        button.setAttribute("aria-pressed", "true");
        setIcon(check, "check");
      });
      setTooltip(button, theme.name);
    }

    el.createDiv({
      cls: "cb-popover-foot",
      text: "Theme is stored with this board.",
    });
  }
}
