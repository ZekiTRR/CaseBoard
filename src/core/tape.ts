import type { BoardNode, TapePlacement, Vec2 } from "./types";
import { degToRad, normalizeDeg } from "../util/math";

export const DEFAULT_TAPES: TapePlacement[] = [
  { x: -0.34, y: -0.47, angle: -29 },
  { x: 0.34, y: -0.47, angle: 29 },
];

export const MAX_TAPES = 5;
/** Tape positions are fractions of the card, so this is effectively "anywhere on the board". */
export const TAPE_COORD_LIMIT = 50;

export function usesTape(node: BoardNode): boolean {
  if (node.variant === "bare") return false;
  return node.fastener === "tape" || (node.type === "image" && node.variant === "taped");
}

export function tapePlacements(node: BoardNode): TapePlacement[] {
  if (!usesTape(node)) return [];
  if (node.tapes && node.tapes.length > 0) return node.tapes;
  return DEFAULT_TAPES;
}

export function ensureTapes(node: BoardNode): TapePlacement[] {
  if (!node.tapes || node.tapes.length === 0) {
    node.tapes = tapePlacements(node).map((tape) => ({ ...tape }));
  }
  return node.tapes;
}

export function nextTapePlacement(existing: TapePlacement[]): TapePlacement {
  const presets: TapePlacement[] = [
    { x: 0.34, y: 0.47, angle: -22 },
    { x: -0.34, y: 0.47, angle: 22 },
    { x: 0, y: 0, angle: -8 },
  ];
  return { ...presets[Math.min(existing.length - 2, presets.length - 1)] };
}

export function clampTape(tape: TapePlacement): void {
  tape.x = Math.max(-TAPE_COORD_LIMIT, Math.min(TAPE_COORD_LIMIT, tape.x));
  tape.y = Math.max(-TAPE_COORD_LIMIT, Math.min(TAPE_COORD_LIMIT, tape.y));
  tape.angle = normalizeDeg(tape.angle);
  if (!Number.isFinite(tape.angle)) tape.angle = 0;
}

export function tapeWorldCenter(node: BoardNode, tape: TapePlacement): Vec2 {
  const angle = degToRad(node.rotation);
  const localX = tape.x * node.width;
  const localY = tape.y * node.height;
  return {
    x: node.x + localX * Math.cos(angle) - localY * Math.sin(angle),
    y: node.y + localX * Math.sin(angle) + localY * Math.cos(angle),
  };
}

export function cloneTapes(tapes: TapePlacement[]): TapePlacement[] {
  return tapes.map((tape) => ({ ...tape }));
}
