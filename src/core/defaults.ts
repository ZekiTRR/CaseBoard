import type { CaseboardSettings, BoardSettings, PluginData } from "../core/types";

export const DEFAULT_SETTINGS: CaseboardSettings = {
  defaultTheme: "cork",
  defaultThreadMode: "taut",
  defaultAutoTension: true,
  defaultAnchor: "auto",
  autosaveDelay: 700,
  showPinsByDefault: true,
  snapToGridByDefault: false,
  gridSize: 20,
  importDepth: 1,
  importLimit: 80,
  importLayout: "organic",
  imageFolder: "",
  boardFolder: "",
  confirmDeleteBoard: true,
};

export function makeBoardSettings(settings: CaseboardSettings): BoardSettings {
  return {
    snapToGrid: settings.snapToGridByDefault,
    gridSize: clampNumber(Math.round(settings.gridSize), 5, 200, 20),
    showPins: settings.showPinsByDefault,
    autoTension: settings.defaultAutoTension,
    defaultThreadMode: settings.defaultThreadMode,
    defaultAnchor: settings.defaultAnchor,
    imageFit: "cover",
    customBackground: "",
    backgroundFit: "cover",
    backgroundDim: 0.3,
  };
}

export function defaultPluginData(): PluginData {
  return {
    version: 1,
    settings: { ...DEFAULT_SETTINGS },
    boards: [],
    lastBoardId: null,
  };
}

function clampNumber(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}
