import {
  AUDIO_PEAK_COUNT,
  DEFAULT_NODE_SIZES,
  type AnchorKind,
  type AudioBoardNode,
  type BoardConnection,
  type BoardDoc,
  type BoardNode,
  type ImageBoardNode,
  type ImageFit,
  type NoteBoardNode,
  type TextBoardNode,
  type TapeBoardNode,
  type ThemeId,
  type ThreadMode,
  type Vec2,
} from "./types";
import { makeBoardSettings } from "./defaults";
import type { CaseboardSettings } from "./types";
import { uid } from "../util/uid";
import { clamp, seededRandom } from "../util/math";

export interface NewNodeOptions {
  position: Vec2;
  accent: string;
  rotation?: number;
  size?: { width: number; height: number };
}

export function createBoardDoc(
  id: string,
  name: string,
  theme: ThemeId,
  settings: CaseboardSettings,
): BoardDoc {
  const now = Date.now();
  return {
    schemaVersion: 1,
    id,
    name,
    theme,
    createdAt: now,
    updatedAt: now,
    camera: { x: 0, y: 0, zoom: 1 },
    settings: makeBoardSettings(settings),
    nodes: [],
    connections: [],
    imports: [],
  };
}

export function createNoteNode(
  file: string,
  options: NewNodeOptions,
): NoteBoardNode {
  const size = options.size ?? DEFAULT_NODE_SIZES.note;
  return {
    id: uid("n"),
    type: "note",
    file,
    x: options.position.x,
    y: options.position.y,
    width: size.width,
    height: size.height,
    rotation: options.rotation ?? tiltFor(file),
    z: 1,
    locked: false,
    variant: "paper",
    accent: options.accent,
    createdAt: Date.now(),
    fontScale: 1,
    fastener: "pin",
  };
}

export function createTextNode(text: string, options: NewNodeOptions): TextBoardNode {
  const size = options.size ?? DEFAULT_NODE_SIZES.text;
  return {
    id: uid("n"),
    type: "text",
    text,
    x: options.position.x,
    y: options.position.y,
    width: size.width,
    height: size.height,
    rotation: options.rotation ?? tiltFor(uid("t")),
    z: 1,
    locked: false,
    variant: "sticky",
    accent: options.accent,
    createdAt: Date.now(),
    fontScale: 1,
    fastener: "pin",
  };
}

export function createImageNode(
  file: string,
  caption: string,
  fit: ImageFit,
  options: NewNodeOptions,
): ImageBoardNode {
  const size = options.size ?? DEFAULT_NODE_SIZES.image;
  return {
    id: uid("n"),
    type: "image",
    file,
    caption,
    fit,
    x: options.position.x,
    y: options.position.y,
    width: size.width,
    height: size.height,
    rotation: options.rotation ?? tiltFor(file),
    z: 1,
    locked: false,
    variant: "polaroid",
    accent: options.accent,
    createdAt: Date.now(),
    fastener: "pin",
  };
}

export function createAudioNode(
  file: string,
  duration: number,
  peaks: number[],
  caption: string,
  options: NewNodeOptions,
): AudioBoardNode {
  const size = options.size ?? DEFAULT_NODE_SIZES.audio;
  return {
    id: uid("n"),
    type: "audio",
    file,
    duration: Math.max(0, duration),
    peaks: peaks.length ? peaks : syntheticPeaks(file, AUDIO_PEAK_COUNT),
    caption,
    x: options.position.x,
    y: options.position.y,
    width: size.width,
    height: size.height,
    rotation: options.rotation ?? tiltFor(file),
    z: 1,
    locked: false,
    variant: "paper",
    accent: options.accent,
    createdAt: Date.now(),
    fastener: "pin",
  };
}

/**
 * Used when a file cannot be decoded (missing media, unsupported codec): the card keeps
 * a stable shape derived from its path instead of collapsing into a flat line.
 */
export function syntheticPeaks(seed: string, count: number): number[] {
  const random = seededRandom(`peaks:${seed}`);
  const out: number[] = [];
  let energy = 0.5;
  for (let index = 0; index < count; index++) {
    if (random() < 0.12) energy = random() < 0.35 ? 0.12 + random() * 0.12 : 0.55 + random() * 0.45;
    const shape = 0.55 + Math.sin((index / count) * Math.PI) * 0.45;
    out.push(clamp(energy * (0.72 + random() * 0.3) * shape, 0.07, 1));
  }
  return out;
}

export interface NewConnectionOptions {
  color: string;
  physics: ThreadMode;
  anchor: AnchorKind;
  autoTension: boolean;
}

export function createTapeNode(options: NewNodeOptions): TapeBoardNode {
  const size = options.size ?? DEFAULT_NODE_SIZES.tape;
  return {
    id: uid("n"),
    type: "tape",
    x: options.position.x,
    y: options.position.y,
    width: size.width,
    height: size.height,
    rotation: options.rotation ?? 0,
    z: 1,
    locked: false,
    variant: "masking",
    accent: options.accent,
    createdAt: Date.now(),
  };
}

export function createConnection(
  fromNode: BoardNode,
  toNode: BoardNode,
  options: NewConnectionOptions,
): BoardConnection {
  const distance = Math.hypot(toNode.x - fromNode.x, toNode.y - fromNode.y);
  return {
    id: uid("c"),
    from: { nodeId: fromNode.id, anchor: options.anchor },
    to: { nodeId: toNode.id, anchor: options.anchor },
    color: options.color,
    width: 2.4,
    physics: options.physics,
    sag: 0.55,
    tension: 0.35,
    autoTension: options.autoTension,
    animated: false,
    restLength: Math.max(24, distance * 1.12),
    createdAt: Date.now(),
  };
}

export function tiltFor(seed: string): number {
  const random = seededRandom(`tilt:${seed}`);
  return Math.round((random() * 2.4 - 1.2) * 10) / 10;
}

export function nextZ(doc: BoardDoc): number {
  let max = 0;
  for (const node of doc.nodes) max = Math.max(max, node.z);
  return max + 1;
}

export function getNode(doc: BoardDoc, id: string): BoardNode | undefined {
  return doc.nodes.find((node) => node.id === id);
}

export function findNoteNode(doc: BoardDoc, file: string): NoteBoardNode | undefined {
  return doc.nodes.find(
    (node): node is NoteBoardNode => node.type === "note" && node.file === file,
  );
}

export function connectionsForNode(doc: BoardDoc, nodeId: string): BoardConnection[] {
  return doc.connections.filter(
    (connection) => connection.from.nodeId === nodeId || connection.to.nodeId === nodeId,
  );
}

export function findConnectionBetween(
  doc: BoardDoc,
  a: string,
  b: string,
): BoardConnection | undefined {
  return doc.connections.find((connection) => {
    const from = connection.from.nodeId;
    const to = connection.to.nodeId;
    return (from === a && to === b) || (from === b && to === a);
  });
}

export function removeNodes(doc: BoardDoc, ids: Set<string>): number {
  if (ids.size === 0) return 0;
  let removedConnections = 0;
  doc.connections = doc.connections.filter((connection) => {
    const touches = ids.has(connection.from.nodeId) || ids.has(connection.to.nodeId);
    if (touches) removedConnections++;
    return !touches;
  });
  doc.nodes = doc.nodes.filter((node) => !ids.has(node.id));
  return removedConnections;
}

export function removeConnections(doc: BoardDoc, ids: Set<string>): void {
  if (ids.size === 0) return;
  doc.connections = doc.connections.filter((connection) => !ids.has(connection.id));
}

export function bringToFront(doc: BoardDoc, ids: Set<string>): void {
  const nodes = doc.nodes.filter((node) => ids.has(node.id));
  let z = nextZ(doc);
  for (const node of nodes.sort((a, b) => a.z - b.z)) node.z = z++;
}

export function sendToBack(doc: BoardDoc, ids: Set<string>): void {
  const minZ = Math.min(0, ...doc.nodes.map((node) => node.z));
  let z = minZ - ids.size;
  for (const node of doc.nodes.filter((node) => ids.has(node.id)).sort((a, b) => a.z - b.z)) {
    node.z = z++;
  }
}

export function normalizeZ(doc: BoardDoc): void {
  doc.nodes.sort((a, b) => a.z - b.z || a.createdAt - b.createdAt);
  doc.nodes.forEach((node, index) => {
    node.z = index + 1;
  });
}

export function touch(doc: BoardDoc): void {
  doc.updatedAt = Date.now();
}

export function cloneBoard(doc: BoardDoc): BoardDoc {
  return JSON.parse(JSON.stringify(doc)) as BoardDoc;
}

export function patchFilePaths(doc: BoardDoc, oldPath: string, newPath: string): boolean {
  let changed = false;
  const prefix = `${oldPath}/`;
  const patch = (path: string): string => {
    if (path === oldPath) {
      changed = true;
      return newPath;
    }
    if (path.startsWith(prefix)) {
      changed = true;
      return `${newPath}${path.slice(oldPath.length)}`;
    }
    return path;
  };

  for (const node of doc.nodes) {
    if (node.type === "note" || node.type === "image" || node.type === "audio") {
      node.file = patch(node.file);
    }
  }
  for (const group of doc.imports) {
    group.sourcePath = patch(group.sourcePath);
  }
  return changed;
}

export function countNoteNodes(doc: BoardDoc): number {
  return doc.nodes.filter((node) => node.type === "note").length;
}
