import {
  AUDIO_PEAK_COUNT,
  BOARD_SCHEMA_VERSION,
  DEFAULT_NODE_SIZES,
  NODE_VARIANTS,
  THEME_IDS,
  type AnchorKind,
  type BackgroundFit,
  type BoardConnection,
  type BoardDoc,
  type BoardMeta,
  type BoardNode,
  type BoardSettings,
  type CameraState,
  type CaseboardSettings,
  type FastenerKind,
  type ImageFit,
  type ImportFilters,
  type ImportGroup,
  type ImportLayout,
  type ImportMode,
  type NodeKind,
  type PropertyFilter,
  type TapePlacement,
  type ThemeId,
  type ThreadMode,
} from "../core/types";
import { DEFAULT_SETTINGS, makeBoardSettings } from "../core/defaults";
import { syntheticPeaks } from "../core/BoardModel";
import { TAPE_COORD_LIMIT } from "../core/tape";
import { normalizeFolderSetting } from "../util/paths";
import { clamp, isHexColor, normalizeDeg, MAX_ZOOM, MIN_ZOOM } from "../util/math";
import { uid } from "../util/uid";
import { migrateBoard, UnsupportedBoardVersionError } from "./Migrations";

const THREAD_MODES: ThreadMode[] = ["dynamic", "taut", "static"];
const FASTENERS: FastenerKind[] = ["pin", "tape"];
const ANCHORS: AnchorKind[] = ["auto", "pin", "tape", "top", "right", "bottom", "left"];
const IMAGE_FITS: ImageFit[] = ["cover", "contain"];
const BACKGROUND_FITS: BackgroundFit[] = ["cover", "contain", "repeat"];
const IMPORT_MODES: ImportMode[] = ["direct", "recursive", "filtered"];
const IMPORT_LAYOUTS: ImportLayout[] = ["organic", "tree"];

export interface BoardParseSuccess {
  ok: true;
  doc: BoardDoc;
  warnings: string[];
}

export interface BoardParseFailure {
  ok: false;
  error: string;
  reason: "json" | "schema" | "version";
}

export type BoardParseResult = BoardParseSuccess | BoardParseFailure;

export function parseBoardText(text: string): BoardParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return {
      ok: false,
      reason: "json",
      error: error instanceof Error ? error.message : "Invalid JSON",
    };
  }

  return normalizeBoard(raw);
}

export function normalizeBoard(raw: unknown): BoardParseResult {
  if (!isRecord(raw)) {
    return { ok: false, reason: "schema", error: "The board file does not contain an object." };
  }

  let migrated: Record<string, unknown>;
  try {
    migrated = migrateBoard(raw).board;
  } catch (error) {
    if (error instanceof UnsupportedBoardVersionError) {
      return { ok: false, reason: "version", error: error.message };
    }
    return {
      ok: false,
      reason: "schema",
      error: error instanceof Error ? error.message : "The board could not be migrated.",
    };
  }

  const warnings: string[] = [];
  const theme = readTheme(migrated.theme, "cork", warnings);
  const camera = readCamera(migrated.camera);
  const settings = readBoardSettings(migrated.settings, warnings);
  const nodes = readNodes(migrated.nodes, warnings);
  const nodeIds = new Set(nodes.map((node) => node.id));
  const connections = readConnections(migrated.connections, nodes, nodeIds, warnings);
  const imports = readImports(migrated.imports, warnings);

  const doc: BoardDoc = {
    schemaVersion: BOARD_SCHEMA_VERSION,
    id: readId(migrated.id, warnings),
    name: readString(migrated.name, "Untitled Case").trim() || "Untitled Case",
    theme,
    createdAt: readNumber(migrated.createdAt, Date.now(), 0, Number.MAX_SAFE_INTEGER),
    updatedAt: readNumber(migrated.updatedAt, Date.now(), 0, Number.MAX_SAFE_INTEGER),
    camera,
    settings,
    nodes,
    connections,
    imports,
  };

  return { ok: true, doc, warnings };
}

export function serializeBoard(doc: BoardDoc): string {
  return JSON.stringify(doc, null, 2);
}

export function normalizeBoardMeta(raw: unknown): BoardMeta | null {
  if (!isRecord(raw)) return null;
  const id = typeof raw.id === "string" ? raw.id.trim() : "";
  if (!id) return null;
  return {
    id,
    name: readString(raw.name, "Untitled Case").trim() || "Untitled Case",
    theme: readTheme(raw.theme, "cork", []),
    createdAt: readNumber(raw.createdAt, Date.now(), 0, Number.MAX_SAFE_INTEGER),
    updatedAt: readNumber(raw.updatedAt, Date.now(), 0, Number.MAX_SAFE_INTEGER),
  };
}

export function normalizeSettings(raw: unknown): CaseboardSettings {
  const defaults = DEFAULT_SETTINGS;
  if (!isRecord(raw)) return { ...defaults };
  return {
    defaultTheme: readTheme(raw.defaultTheme, defaults.defaultTheme, []),
    defaultThreadMode: readThreadMode(raw.defaultThreadMode, defaults.defaultThreadMode),
    defaultAutoTension: readBoolean(raw.defaultAutoTension, defaults.defaultAutoTension),
    defaultAnchor: readAnchor(raw.defaultAnchor, defaults.defaultAnchor),
    autosaveDelay: clamp(readNumber(raw.autosaveDelay, defaults.autosaveDelay, 200, 5000), 200, 5000),
    showPinsByDefault: readBoolean(raw.showPinsByDefault, defaults.showPinsByDefault),
    snapToGridByDefault: readBoolean(raw.snapToGridByDefault, defaults.snapToGridByDefault),
    gridSize: clamp(readNumber(raw.gridSize, defaults.gridSize, 5, 200), 5, 200),
    importDepth: clamp(Math.round(readNumber(raw.importDepth, defaults.importDepth, 1, 4)), 1, 4),
    importLimit: clamp(Math.round(readNumber(raw.importLimit, defaults.importLimit, 1, 500)), 1, 500),
    importLayout: IMPORT_LAYOUTS.includes(raw.importLayout as ImportLayout)
      ? (raw.importLayout as ImportLayout)
      : defaults.importLayout,
    imageFolder: normalizeFolderSetting(readString(raw.imageFolder, defaults.imageFolder)),
    boardFolder: normalizeFolderSetting(readString(raw.boardFolder, defaults.boardFolder)),
    confirmDeleteBoard: readBoolean(raw.confirmDeleteBoard, defaults.confirmDeleteBoard),
  };
}

function readNodes(raw: unknown, warnings: string[]): BoardNode[] {
  if (!Array.isArray(raw)) {
    if (raw !== undefined) warnings.push("The nodes array is invalid; the board starts empty.");
    return [];
  }

  const nodes: BoardNode[] = [];
  const seen = new Set<string>();

  for (let index = 0; index < raw.length; index++) {
    const normalized = readNode(raw[index], index, warnings);
    if (!normalized) continue;
    if (seen.has(normalized.id)) {
      warnings.push(`Skipped a duplicate node id (${normalized.id}).`);
      continue;
    }
    seen.add(normalized.id);
    nodes.push(normalized);
  }

  nodes.sort((a, b) => a.z - b.z || a.createdAt - b.createdAt);
  nodes.forEach((node, index) => {
    node.z = index + 1;
  });
  return nodes;
}

function readNode(raw: unknown, index: number, warnings: string[]): BoardNode | null {
  if (!isRecord(raw)) return null;
  const type = raw.type;
  if (type !== "note" && type !== "text" && type !== "image" && type !== "audio" && type !== "tape") {
    warnings.push(`Skipped node #${index + 1}: unknown type.`);
    return null;
  }

  const fallbackSize = DEFAULT_NODE_SIZES[type];
  const isTape = type === "tape";
  const createdAt = readNumber(raw.createdAt, Date.now(), 0, Number.MAX_SAFE_INTEGER);
  const base = {
    id: typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : uid("n"),
    x: readNumber(raw.x, 0, -1e7, 1e7),
    y: readNumber(raw.y, 0, -1e7, 1e7),
    width: clamp(readNumber(raw.width, fallbackSize.width, 24, 6000), isTape ? 24 : 60, isTape ? 2400 : 6000),
    height: clamp(readNumber(raw.height, fallbackSize.height, 8, 6000), isTape ? 8 : 40, isTape ? 160 : 6000),
    rotation: normalizeDeg(readNumber(raw.rotation, 0, -36000, 36000)),
    z: readNumber(raw.z, index + 1, -1e6, 1e6),
    locked: readBoolean(raw.locked, false),
    variant: readVariant(raw.variant, type),
    accent: isHexColor(readString(raw.accent, ""))
      ? readString(raw.accent, "")
      : isTape
        ? "#cbb98f"
        : "#a6322c",
    createdAt,
    fastener: FASTENERS.includes(raw.fastener as FastenerKind)
      ? (raw.fastener as FastenerKind)
      : "pin",
    tapes: readTapes(raw.tapes),
  };

  if (type === "tape") {
    return { ...base, type };
  }

  if (type === "note") {
    const file = readString(raw.file, "").trim();
    if (!file) {
      warnings.push(`Skipped note node #${index + 1}: no file path.`);
      return null;
    }
    return { ...base, type, file, fontScale: readFontScale(raw.fontScale) };
  }

  if (type === "text") {
    return {
      ...base,
      type,
      text: readString(raw.text, ""),
      fontScale: readFontScale(raw.fontScale),
    };
  }

  if (type === "audio") {
    const file = readString(raw.file, "").trim();
    if (!file) {
      warnings.push(`Skipped audio node #${index + 1}: no file path.`);
      return null;
    }
    const peaks = readPeaks(raw.peaks, file);
    if (!Array.isArray(raw.peaks)) {
      warnings.push(`Audio node #${index + 1} had no usable waveform; a placeholder trace was drawn.`);
    }
    return {
      ...base,
      type,
      file,
      duration: readNumber(raw.duration, 0, 0, 60 * 60 * 12),
      peaks,
      caption: readString(raw.caption, ""),
    };
  }

  const file = readString(raw.file, "").trim();
  if (!file) {
    warnings.push(`Skipped image node #${index + 1}: no file path.`);
    return null;
  }
  return {
    ...base,
    type,
    file,
    caption: readString(raw.caption, ""),
    fit: IMAGE_FITS.includes(raw.fit as ImageFit) ? (raw.fit as ImageFit) : "cover",
  };
}

/** Waveform columns, kept to AUDIO_PEAK_COUNT so a hand-edited file cannot bloat the board. */
function readPeaks(raw: unknown, seed: string): number[] {
  if (!Array.isArray(raw)) return syntheticPeaks(seed, AUDIO_PEAK_COUNT);
  const values: number[] = [];
  for (let index = 0; index < Math.min(raw.length, AUDIO_PEAK_COUNT); index++) {
    const value: unknown = raw[index];
    values.push(typeof value === "number" && Number.isFinite(value) ? clamp(value, 0.02, 1) : 0.08);
  }
  if (values.length === 0) return syntheticPeaks(seed, AUDIO_PEAK_COUNT);
  while (values.length < AUDIO_PEAK_COUNT) values.push(values[values.length - 1]);
  return values;
}

function readConnections(
  raw: unknown,
  nodes: BoardNode[],
  nodeIds: Set<string>,
  warnings: string[],
): BoardConnection[] {
  if (!Array.isArray(raw)) {
    if (raw !== undefined) warnings.push("The connections array is invalid; no threads were loaded.");
    return [];
  }

  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const seen = new Set<string>();
  const connections: BoardConnection[] = [];

  for (let index = 0; index < raw.length; index++) {
    const item: unknown = raw[index];
    if (!isRecord(item)) continue;
    const from = isRecord(item.from) ? item.from : null;
    const to = isRecord(item.to) ? item.to : null;
    const fromId = from ? readString(from.nodeId, "") : "";
    const toId = to ? readString(to.nodeId, "") : "";
    if (!nodeIds.has(fromId) || !nodeIds.has(toId)) {
      warnings.push(`Dropped thread #${index + 1}: one of its cards no longer exists.`);
      continue;
    }
    if (fromId === toId) {
      warnings.push(`Dropped thread #${index + 1}: a card cannot be threaded to itself.`);
      continue;
    }

    const id = typeof item.id === "string" && item.id.trim() ? item.id.trim() : uid("c");
    if (seen.has(id)) {
      warnings.push(`Skipped a duplicate thread id (${id}).`);
      continue;
    }
    seen.add(id);

    const fromNode = nodeMap.get(fromId);
    const toNode = nodeMap.get(toId);
    const centerDistance =
      fromNode && toNode ? Math.hypot(toNode.x - fromNode.x, toNode.y - fromNode.y) : 300;
    const fallbackRest = Math.max(40, centerDistance * 1.12);

    connections.push({
      id,
      from: { nodeId: fromId, anchor: readAnchor(from?.anchor, "auto") },
      to: { nodeId: toId, anchor: readAnchor(to?.anchor, "auto") },
      color: isHexColor(readString(item.color, "")) ? readString(item.color, "") : "#a6322c",
      width: clamp(readNumber(item.width, 2.4, 0.6, 12), 0.6, 12),
      physics: readThreadMode(item.physics, "taut"),
      sag: clamp(readNumber(item.sag, 0.55, 0, 1.5), 0, 1.5),
      tension: clamp(readNumber(item.tension, 0.35, 0, 1), 0, 1),
      autoTension: readBoolean(item.autoTension, true),
      animated: readBoolean(item.animated, false),
      restLength: clamp(readNumber(item.restLength, fallbackRest, 8, 100000), 8, 100000),
      createdAt: readNumber(item.createdAt, Date.now(), 0, Number.MAX_SAFE_INTEGER),
    });
  }

  return connections;
}

function readImports(raw: unknown, warnings: string[]): ImportGroup[] {
  if (!Array.isArray(raw)) {
    if (raw !== undefined) warnings.push("Import history is invalid and was reset.");
    return [];
  }

  const groups: ImportGroup[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const sourcePath = readString(item.sourcePath, "").trim();
    if (!sourcePath) continue;
    const id = typeof item.id === "string" && item.id.trim() ? item.id.trim() : uid("imp");
    if (seen.has(id)) continue;
    seen.add(id);
    groups.push({
      id,
      sourcePath,
      mode: IMPORT_MODES.includes(item.mode as ImportMode) ? (item.mode as ImportMode) : "direct",
      depth: clamp(Math.round(readNumber(item.depth, 1, 1, 4)), 1, 4),
      limit: clamp(Math.round(readNumber(item.limit, 80, 1, 500)), 1, 500),
      layout: IMPORT_LAYOUTS.includes(item.layout as ImportLayout)
        ? (item.layout as ImportLayout)
        : "organic",
      filters: readFilters(item.filters),
      createdAt: readNumber(item.createdAt, Date.now(), 0, Number.MAX_SAFE_INTEGER),
      updatedAt: readNumber(item.updatedAt, Date.now(), 0, Number.MAX_SAFE_INTEGER),
    });
  }
  return groups;
}

function readFilters(raw: unknown): ImportFilters {
  if (!isRecord(raw)) return { folder: "", tags: [], properties: [] };
  const tags = Array.isArray(raw.tags)
    ? raw.tags.filter((tag): tag is string => typeof tag === "string" && tag.trim().length > 0)
    : [];
  const properties: PropertyFilter[] = [];
  if (Array.isArray(raw.properties)) {
    for (const item of raw.properties) {
      if (!isRecord(item)) continue;
      const key = readString(item.key, "").trim();
      if (!key) continue;
      properties.push({ key, value: readString(item.value, "").trim() });
    }
  }
  return {
    folder: readString(raw.folder, "").trim(),
    tags: tags.map((tag) => (tag.startsWith("#") ? tag.slice(1) : tag)),
    properties,
  };
}

function readCamera(raw: unknown): CameraState {
  if (!isRecord(raw)) return { x: 0, y: 0, zoom: 1 };
  return {
    x: readNumber(raw.x, 0, -1e8, 1e8),
    y: readNumber(raw.y, 0, -1e8, 1e8),
    zoom: clamp(readNumber(raw.zoom, 1, MIN_ZOOM, MAX_ZOOM), MIN_ZOOM, MAX_ZOOM),
  };
}

function readBoardSettings(raw: unknown, warnings: string[]): BoardSettings {
  const defaults = makeBoardSettings(DEFAULT_SETTINGS);
  if (!isRecord(raw)) {
    if (raw !== undefined) warnings.push("Board settings were invalid and were reset to defaults.");
    return defaults;
  }
  return {
    snapToGrid: readBoolean(raw.snapToGrid, defaults.snapToGrid),
    gridSize: clamp(readNumber(raw.gridSize, defaults.gridSize, 5, 200), 5, 200),
    showPins: readBoolean(raw.showPins, defaults.showPins),
    autoTension: readBoolean(raw.autoTension, defaults.autoTension),
    defaultThreadMode: readThreadMode(raw.defaultThreadMode, defaults.defaultThreadMode),
    defaultAnchor: readAnchor(raw.defaultAnchor, defaults.defaultAnchor),
    imageFit: IMAGE_FITS.includes(raw.imageFit as ImageFit)
      ? (raw.imageFit as ImageFit)
      : defaults.imageFit,
    customBackground: readString(raw.customBackground, "").trim(),
    backgroundFit: BACKGROUND_FITS.includes(raw.backgroundFit as BackgroundFit)
      ? (raw.backgroundFit as BackgroundFit)
      : defaults.backgroundFit,
    backgroundDim: clamp(readNumber(raw.backgroundDim, defaults.backgroundDim, 0, 0.85), 0, 0.85),
  };
}

function readTapes(raw: unknown): TapePlacement[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const tapes: TapePlacement[] = [];
  for (const item of raw.slice(0, 5)) {
    if (!isRecord(item)) continue;
    tapes.push({
      x: clamp(
        readNumber(item.x, 0, -TAPE_COORD_LIMIT, TAPE_COORD_LIMIT),
        -TAPE_COORD_LIMIT,
        TAPE_COORD_LIMIT,
      ),
      y: clamp(
        readNumber(item.y, 0, -TAPE_COORD_LIMIT, TAPE_COORD_LIMIT),
        -TAPE_COORD_LIMIT,
        TAPE_COORD_LIMIT,
      ),
      angle: normalizeDeg(readNumber(item.angle, 0, -3600, 3600)),
    });
  }
  return tapes.length > 0 ? tapes : undefined;
}

function readFontScale(raw: unknown): number {
  return clamp(readNumber(raw, 1, 0.7, 1.8), 0.7, 1.8);
}

function readVariant(raw: unknown, type: NodeKind): string {
  const allowed = NODE_VARIANTS[type];
  if (typeof raw === "string" && allowed.includes(raw)) return raw;
  if (type === "tape") return "masking";
  if (type === "text") return "sticky";
  if (type === "image") return "polaroid";
  return "paper";
}

function readTheme(raw: unknown, fallback: ThemeId, warnings: string[]): ThemeId {
  if (THEME_IDS.includes(raw as ThemeId)) return raw as ThemeId;
  if (raw !== undefined) warnings.push("Unknown board theme; Classic Corkboard was applied.");
  return fallback;
}

function readThreadMode(raw: unknown, fallback: ThreadMode): ThreadMode {
  return THREAD_MODES.includes(raw as ThreadMode) ? (raw as ThreadMode) : fallback;
}

function readAnchor(raw: unknown, fallback: AnchorKind): AnchorKind {
  return ANCHORS.includes(raw as AnchorKind) ? (raw as AnchorKind) : fallback;
}

function readId(raw: unknown, warnings: string[]): string {
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  const generated = uid("board");
  warnings.push(`The board id was missing; a new one (${generated}) was assigned.`);
  return generated;
}

function readString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function readNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return clamp(value, min, max);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
