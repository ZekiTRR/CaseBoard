import type { ThemeId } from "../core/types";

export type SurfaceKind = "cork" | "felt" | "concrete" | "parchment" | "whiteboard";
export type PinStyle = "pushpin" | "tack" | "magnet";

export interface SurfaceSpec {
  kind: SurfaceKind;
  base: string;
  tint: string;
  light: string;
  seed: number;
}

export interface BoardTheme {
  id: ThemeId;
  name: string;
  tagline: string;
  surface: SurfaceSpec;
  paperSeed: number;
  pin: PinStyle;
  ui: "dark" | "light";
  vars: Record<string, string>;
  threadPalette: string[];
  pinColor: string;
  tapeColor: string;
  swatch: [string, string, string];
}

const CORK_THEME: BoardTheme = {
  id: "cork",
  name: "Classic Corkboard",
  tagline: "Warm cork, red thread, old case files.",
  surface: { kind: "cork", base: "#b38251", tint: "#7d532b", light: "#d7ae74", seed: 17 },
  paperSeed: 31,
  pin: "pushpin",
  ui: "dark",
  pinColor: "#b3352d",
  tapeColor: "#d8c79e",
  threadPalette: ["#a62b2f", "#6e1e21", "#262321", "#d8cfba", "#2f5b74", "#a9863d"],
  swatch: ["#b38251", "#f1e4ca", "#a62b2f"],
  vars: {
    "--cb-surface-base": "#b38251",
    "--cb-paper": "#f1e4ca",
    "--cb-paper-ink": "#2d2318",
    "--cb-paper-muted": "#78664f",
    "--cb-paper-border": "rgba(83, 56, 25, 0.28)",
    "--cb-paper-shadow": "rgba(32, 18, 4, 0.45)",
    "--cb-photo-frame": "#f8f2e5",
    "--cb-photo-caption": "#4b3a26",
    "--cb-tape": "rgba(226, 209, 168, 0.62)",
    "--cb-accent": "#b23a30",
    "--cb-pin": "#b3352d",
    "--cb-pin-alt": "#6f1a16",
    "--cb-vignette": "rgba(28, 15, 4, 0.6)",
    "--cb-light": "rgba(255, 222, 160, 0.16)",
    "--cb-ui-bg": "rgba(31, 22, 14, 0.78)",
    "--cb-ui-border": "rgba(255, 236, 202, 0.14)",
    "--cb-ui-text": "#f4ead8",
    "--cb-ui-muted": "#b7a68b",
    "--cb-ui-hover": "rgba(255, 246, 230, 0.09)",
    "--cb-ui-active": "rgba(255, 246, 230, 0.16)",
    "--cb-ui-shadow": "rgba(0, 0, 0, 0.45)",
    "--cb-selection": "#f0c574",
    "--cb-handle-bg": "#f6ecd8",
    "--cb-grid": "rgba(45, 30, 15, 0.35)",
    "--cb-card-radius": "3px",
    "--cb-index": "#f8f1e2",
    "--cb-kraft": "#cdb18a",
    "--cb-sticky": "#f2e1a8",
    "--cb-grid-paper": "#f6f0df",
  },
};

const DARK_THEME: BoardTheme = {
  id: "dark",
  name: "Dark Investigation",
  tagline: "A dim office, brass pins, secrets in the dark.",
  surface: { kind: "felt", base: "#141519", tint: "#08090c", light: "#3a3d47", seed: 47 },
  paperSeed: 53,
  pin: "tack",
  ui: "dark",
  pinColor: "#c4a15f",
  tapeColor: "#b7a77f",
  threadPalette: ["#ad3b3b", "#c99a52", "#cfc6b5", "#5b7387", "#4e6a5d", "#7d4a6b"],
  swatch: ["#141519", "#ddd2bf", "#ad3b3b"],
  vars: {
    "--cb-surface-base": "#16171b",
    "--cb-paper": "#ddd2bf",
    "--cb-paper-ink": "#29241b",
    "--cb-paper-muted": "#7c6f5c",
    "--cb-paper-border": "rgba(18, 14, 8, 0.42)",
    "--cb-paper-shadow": "rgba(0, 0, 0, 0.67)",
    "--cb-photo-frame": "#e9e2d3",
    "--cb-photo-caption": "#3e3629",
    "--cb-tape": "rgba(190, 168, 120, 0.35)",
    "--cb-accent": "#b4443c",
    "--cb-pin": "#c4a15f",
    "--cb-pin-alt": "#6f5426",
    "--cb-vignette": "rgba(0, 0, 0, 0.74)",
    "--cb-light": "rgba(255, 186, 108, 0.085)",
    "--cb-ui-bg": "rgba(14, 15, 19, 0.83)",
    "--cb-ui-border": "rgba(255, 255, 255, 0.09)",
    "--cb-ui-text": "#e9e2d4",
    "--cb-ui-muted": "#948d80",
    "--cb-ui-hover": "rgba(255, 255, 255, 0.07)",
    "--cb-ui-active": "rgba(255, 255, 255, 0.13)",
    "--cb-ui-shadow": "rgba(0, 0, 0, 0.62)",
    "--cb-selection": "#d2b06e",
    "--cb-handle-bg": "#22242a",
    "--cb-grid": "rgba(255, 255, 255, 0.22)",
    "--cb-card-radius": "2px",
    "--cb-index": "#e7dfcc",
    "--cb-kraft": "#b39b78",
    "--cb-sticky": "#d8c58d",
    "--cb-grid-paper": "#ddd8c6",
  },
};

const CONCRETE_THEME: BoardTheme = {
  id: "concrete",
  name: "Concrete Wall",
  tagline: "Cold concrete, evidence tags, hard facts.",
  surface: { kind: "concrete", base: "#8a8c88", tint: "#5d5f5b", light: "#b9bab4", seed: 71 },
  paperSeed: 73,
  pin: "tack",
  ui: "dark",
  pinColor: "#c4c9c8",
  tapeColor: "#cbc7b9",
  threadPalette: ["#a92c29", "#262626", "#2f4b66", "#c47a2c", "#d7d4c9", "#426b52"],
  swatch: ["#8a8c88", "#e9e7df", "#a92c29"],
  vars: {
    "--cb-surface-base": "#8a8c88",
    "--cb-paper": "#e9e7df",
    "--cb-paper-ink": "#262624",
    "--cb-paper-muted": "#6f6e68",
    "--cb-paper-border": "rgba(40, 40, 36, 0.26)",
    "--cb-paper-shadow": "rgba(15, 17, 17, 0.52)",
    "--cb-photo-frame": "#f2f1ec",
    "--cb-photo-caption": "#454744",
    "--cb-tape": "rgba(212, 208, 194, 0.45)",
    "--cb-accent": "#b0392f",
    "--cb-pin": "#aeb4b3",
    "--cb-pin-alt": "#565c5d",
    "--cb-vignette": "rgba(14, 17, 19, 0.58)",
    "--cb-light": "rgba(255, 255, 255, 0.07)",
    "--cb-ui-bg": "rgba(24, 27, 29, 0.82)",
    "--cb-ui-border": "rgba(255, 255, 255, 0.11)",
    "--cb-ui-text": "#ecebe5",
    "--cb-ui-muted": "#a3a6a1",
    "--cb-ui-hover": "rgba(255, 255, 255, 0.07)",
    "--cb-ui-active": "rgba(255, 255, 255, 0.13)",
    "--cb-ui-shadow": "rgba(0, 0, 0, 0.5)",
    "--cb-selection": "#e0b25f",
    "--cb-handle-bg": "#ecebe5",
    "--cb-grid": "rgba(255, 255, 255, 0.28)",
    "--cb-card-radius": "1px",
    "--cb-index": "#f1efe8",
    "--cb-kraft": "#c9beab",
    "--cb-sticky": "#efe3ae",
    "--cb-grid-paper": "#eceae2",
  },
};

const VINTAGE_THEME: BoardTheme = {
  id: "vintage",
  name: "Vintage Paper",
  tagline: "Aged parchment, wax seals, a case gone cold.",
  surface: { kind: "parchment", base: "#b49a73", tint: "#8b6f4b", light: "#d8c29a", seed: 97 },
  paperSeed: 101,
  pin: "tack",
  ui: "dark",
  pinColor: "#a98745",
  tapeColor: "#cbb68f",
  threadPalette: ["#7d2b2a", "#57402c", "#4e6470", "#d8c9a9", "#405640", "#9a6b32"],
  swatch: ["#b49a73", "#ecdcba", "#7d2b2a"],
  vars: {
    "--cb-surface-base": "#b49a73",
    "--cb-paper": "#ecdcba",
    "--cb-paper-ink": "#3a2d1c",
    "--cb-paper-muted": "#7e6a4d",
    "--cb-paper-border": "rgba(74, 55, 28, 0.3)",
    "--cb-paper-shadow": "rgba(43, 29, 12, 0.5)",
    "--cb-photo-frame": "#f3e7cc",
    "--cb-photo-caption": "#5a4529",
    "--cb-tape": "rgba(206, 185, 143, 0.58)",
    "--cb-accent": "#8b3a2c",
    "--cb-pin": "#a98745",
    "--cb-pin-alt": "#5d4722",
    "--cb-vignette": "rgba(39, 25, 9, 0.58)",
    "--cb-light": "rgba(255, 235, 180, 0.16)",
    "--cb-ui-bg": "rgba(43, 32, 20, 0.8)",
    "--cb-ui-border": "rgba(255, 235, 190, 0.13)",
    "--cb-ui-text": "#f2e6cf",
    "--cb-ui-muted": "#b6a487",
    "--cb-ui-hover": "rgba(255, 240, 210, 0.08)",
    "--cb-ui-active": "rgba(255, 240, 210, 0.15)",
    "--cb-ui-shadow": "rgba(0, 0, 0, 0.45)",
    "--cb-selection": "#d2ad67",
    "--cb-handle-bg": "#f1e4c9",
    "--cb-grid": "rgba(50, 34, 14, 0.4)",
    "--cb-card-radius": "2px",
    "--cb-index": "#f2e6cd",
    "--cb-kraft": "#cbaf85",
    "--cb-sticky": "#e6d39a",
    "--cb-grid-paper": "#eee0c2",
  },
};

const WHITEBOARD_THEME: BoardTheme = {
  id: "whiteboard",
  name: "Whiteboard",
  tagline: "Clean markers, magnets, a fresh theory.",
  surface: { kind: "whiteboard", base: "#e8eae6", tint: "#cfd4ce", light: "#ffffff", seed: 127 },
  paperSeed: 131,
  pin: "magnet",
  ui: "light",
  pinColor: "#3f79a6",
  tapeColor: "#cbdde1",
  threadPalette: ["#2f6ea8", "#c23a37", "#25292c", "#3f7d5c", "#cc7a33", "#76539a"],
  swatch: ["#e8eae6", "#fbfbf8", "#2f6ea8"],
  vars: {
    "--cb-surface-base": "#e8eae6",
    "--cb-paper": "#fbfbf8",
    "--cb-paper-ink": "#22282c",
    "--cb-paper-muted": "#737c81",
    "--cb-paper-border": "rgba(30, 40, 45, 0.16)",
    "--cb-paper-shadow": "rgba(30, 40, 45, 0.16)",
    "--cb-photo-frame": "#ffffff",
    "--cb-photo-caption": "#4e5a60",
    "--cb-tape": "rgba(210, 222, 226, 0.65)",
    "--cb-accent": "#3d6e9d",
    "--cb-pin": "#3f79a6",
    "--cb-pin-alt": "#214a6b",
    "--cb-vignette": "rgba(35, 45, 50, 0.17)",
    "--cb-light": "rgba(255, 255, 255, 0.5)",
    "--cb-ui-bg": "rgba(250, 250, 247, 0.85)",
    "--cb-ui-border": "rgba(25, 35, 40, 0.12)",
    "--cb-ui-text": "#23282c",
    "--cb-ui-muted": "#6c757a",
    "--cb-ui-hover": "rgba(25, 35, 40, 0.055)",
    "--cb-ui-active": "rgba(25, 35, 40, 0.1)",
    "--cb-ui-shadow": "rgba(35, 45, 50, 0.18)",
    "--cb-selection": "#3d6e9d",
    "--cb-handle-bg": "#ffffff",
    "--cb-grid": "rgba(25, 35, 40, 0.3)",
    "--cb-card-radius": "4px",
    "--cb-index": "#ffffff",
    "--cb-kraft": "#d7cdb7",
    "--cb-sticky": "#f0e39a",
    "--cb-grid-paper": "#fbfcf9",
  },
};

const THEMES: Record<ThemeId, BoardTheme> = {
  cork: CORK_THEME,
  dark: DARK_THEME,
  concrete: CONCRETE_THEME,
  vintage: VINTAGE_THEME,
  whiteboard: WHITEBOARD_THEME,
};

const customThemes = new Map<string, BoardTheme>();

export function getTheme(id: ThemeId): BoardTheme {
  return THEMES[id] ?? customThemes.get(id) ?? CORK_THEME;
}

export function getThemeList(): BoardTheme[] {
  return [...Object.values(THEMES), ...customThemes.values()];
}

/**
 * Extension point for user-defined themes. A future release can surface this
 * through settings without changing the renderer or the board format.
 */
export function registerTheme(theme: BoardTheme): void {
  customThemes.set(theme.id, theme);
}
