export const VIEW_TYPE = "caseboard-view";
export const BOARD_SCHEMA_VERSION = 1;

export const THEME_IDS = [
  "cork",
  "dark",
  "concrete",
  "vintage",
  "whiteboard",
] as const;
export type ThemeId = (typeof THEME_IDS)[number];

export type NodeKind = "note" | "text" | "image" | "tape";
export type BoardTool = "select" | "pan" | "thread" | "tape";

export type ThreadMode = "dynamic" | "taut" | "static";
export type AnchorKind = "auto" | "pin" | "tape" | "top" | "right" | "bottom" | "left";
export type FastenerKind = "pin" | "tape";

export interface TapePlacement {
  /** Center offset as a fraction of the card width/height. */
  x: number;
  y: number;
  angle: number;
}
export type ImageFit = "cover" | "contain";
export type BackgroundFit = "cover" | "contain" | "repeat";

export interface CameraState {
  x: number;
  y: number;
  zoom: number;
}

export interface BoardSettings {
  snapToGrid: boolean;
  gridSize: number;
  showPins: boolean;
  autoTension: boolean;
  defaultThreadMode: ThreadMode;
  defaultAnchor: AnchorKind;
  imageFit: ImageFit;
  customBackground: string;
  backgroundFit: BackgroundFit;
  backgroundDim: number;
}

export interface BaseBoardNode {
  id: string;
  type: NodeKind;
  /** Center of the card in board coordinates. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Degrees, clockwise. */
  rotation: number;
  z: number;
  locked: boolean;
  variant: string;
  accent: string;
  createdAt: number;
  fastener?: FastenerKind;
  tapes?: TapePlacement[];
}

export interface NoteBoardNode extends BaseBoardNode {
  type: "note";
  file: string;
  fontScale: number;
}

export interface TextBoardNode extends BaseBoardNode {
  type: "text";
  text: string;
  fontScale: number;
}

export interface ImageBoardNode extends BaseBoardNode {
  type: "image";
  file: string;
  caption: string;
  fit: ImageFit;
}

/** A free-standing strip of tape that can sit on cards or directly on the board. */
export interface TapeBoardNode extends BaseBoardNode {
  type: "tape";
}

export type BoardNode = NoteBoardNode | TextBoardNode | ImageBoardNode | TapeBoardNode;

export interface ConnectionEnd {
  nodeId: string;
  anchor: AnchorKind;
}

export interface BoardConnection {
  id: string;
  from: ConnectionEnd;
  to: ConnectionEnd;
  color: string;
  width: number;
  physics: ThreadMode;
  /** 0..1 — manual amount of slack. */
  sag: number;
  /** 0..1 — how tight the thread is pulled. */
  tension: number;
  autoTension: boolean;
  animated: boolean;
  /** Board-space distance used as the physical length of the thread. */
  restLength: number;
  createdAt: number;
}

export type ImportMode = "direct" | "recursive" | "filtered";
export type ImportLayout = "organic" | "tree";

export interface PropertyFilter {
  key: string;
  value: string;
}

export interface ImportFilters {
  folder: string;
  tags: string[];
  properties: PropertyFilter[];
}

export interface ImportGroup {
  id: string;
  sourcePath: string;
  mode: ImportMode;
  depth: number;
  limit: number;
  layout: ImportLayout;
  filters: ImportFilters;
  createdAt: number;
  updatedAt: number;
}

export interface BoardDoc {
  schemaVersion: number;
  id: string;
  name: string;
  theme: ThemeId;
  createdAt: number;
  updatedAt: number;
  camera: CameraState;
  settings: BoardSettings;
  nodes: BoardNode[];
  connections: BoardConnection[];
  imports: ImportGroup[];
}

export interface BoardMeta {
  id: string;
  name: string;
  theme: ThemeId;
  createdAt: number;
  updatedAt: number;
}

export interface CaseboardSettings {
  defaultTheme: ThemeId;
  defaultThreadMode: ThreadMode;
  defaultAutoTension: boolean;
  defaultAnchor: AnchorKind;
  autosaveDelay: number;
  showPinsByDefault: boolean;
  snapToGridByDefault: boolean;
  gridSize: number;
  importDepth: number;
  importLimit: number;
  importLayout: ImportLayout;
  imageFolder: string;
  boardFolder: string;
  confirmDeleteBoard: boolean;
}

export interface PluginData {
  version: number;
  settings: CaseboardSettings;
  boards: BoardMeta[];
  lastBoardId: string | null;
}

export interface Vec2 {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface NoteMeta {
  title: string;
  excerpt: string;
  tags: string[];
  icon: string;
  missing: boolean;
  mtime: number;
  path: string;
}

export interface ConnectionGeometry {
  /** Sampled points in board coordinates. */
  points: Vec2[];
  /** Endpoints clipped/attached to the cards. */
  start: Vec2;
  end: Vec2;
}

export interface ImportResult {
  addedNodes: number;
  addedConnections: number;
  skippedExisting: number;
  missingLinks: number;
  truncated: boolean;
}

export const NODE_VARIANTS: Record<NodeKind, string[]> = {
  note: ["paper", "index", "aged", "grid", "kraft", "night", "bare"],
  text: ["sticky", "index", "aged", "grid", "kraft", "night", "bare"],
  image: ["polaroid", "plain", "taped", "bare"],
  tape: ["masking"],
};

export const DEFAULT_NODE_SIZES: Record<NodeKind, { width: number; height: number }> = {
  note: { width: 280, height: 210 },
  text: { width: 260, height: 180 },
  image: { width: 320, height: 260 },
  tape: { width: 128, height: 26 },
};
