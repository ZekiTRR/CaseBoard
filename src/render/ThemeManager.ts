import type { ThemeId } from "../core/types";
import { getTheme } from "./themes";
import { getPaperTexture, getSurfaceTexture } from "./textures";

export function applyTheme(el: HTMLElement, id: ThemeId, textures = true): void {
  const theme = getTheme(id);
  el.dataset.theme = theme.id;
  el.dataset.pin = theme.pin;
  el.dataset.ui = theme.ui;
  for (const [key, value] of Object.entries(theme.vars)) {
    el.style.setProperty(key, value);
  }
  if (textures) {
    el.style.setProperty("--cb-surface-texture", `url("${getSurfaceTexture(theme)}")`);
    el.style.setProperty("--cb-paper-texture", `url("${getPaperTexture(theme)}")`);
  }
}

export function applyThemeTokens(el: HTMLElement, id: ThemeId): void {
  applyTheme(el, id, false);
}
