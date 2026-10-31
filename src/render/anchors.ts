import type { AnchorKind, BoardDoc, BoardNode, TapePlacement, Vec2 } from "../core/types";
import { degToRad, rotateVec, clamp } from "../util/math";
import { tapePlacements, tapeWorldCenter } from "../core/tape";

export interface ConnectionEndpoints {
  start: Vec2;
  end: Vec2;
  fromNode: BoardNode;
  toNode: BoardNode;
}

/**
 * Resolves a thread attachment point on a card. `auto` slides along the card's
 * perimeter along the line to the other endpoint, which keeps strands readable
 * in dense clusters.
 */
export function resolveAnchor(node: BoardNode, anchor: AnchorKind, toward: Vec2): Vec2 {
  if (node.type === "tape") return { x: node.x, y: node.y };
  const halfW = node.width / 2;
  const halfH = node.height / 2;
  const angle = degToRad(node.rotation);
  let local: Vec2;

  if (anchor === "auto" || anchor === "tape") {
    const tape = nearestTape(node, toward);
    if (tape) return tapeWorldCenter(node, tape);
  }

  if (anchor === "auto") {
    const dx = toward.x - node.x;
    const dy = toward.y - node.y;
    const target = rotateVec(dx, dy, -angle);
    const absX = Math.abs(target.x);
    const absY = Math.abs(target.y);
    if (absX < 0.001 && absY < 0.001) {
      local = { x: 0, y: -halfH - 2 };
    } else {
      const scaleX = absX > 0.001 ? (halfW + 2.5) / absX : Number.POSITIVE_INFINITY;
      const scaleY = absY > 0.001 ? (halfH + 2.5) / absY : Number.POSITIVE_INFINITY;
      const scale = Math.min(scaleX, scaleY);
      local = { x: target.x * scale, y: target.y * scale };
    }
  } else {
    switch (anchor) {
      case "pin":
      case "tape":
        local = { x: 0, y: -halfH - 6 };
        break;
      case "top":
        local = { x: 0, y: -halfH - 2 };
        break;
      case "right":
        local = { x: halfW + 2, y: 0 };
        break;
      case "bottom":
        local = { x: 0, y: halfH + 2 };
        break;
      case "left":
        local = { x: -halfW - 2, y: 0 };
        break;
      default:
        local = { x: 0, y: -halfH - 2 };
    }
  }

  const world = rotateVec(local.x, local.y, angle);
  return { x: node.x + world.x, y: node.y + world.y };
}

export function resolveEndpoints(
  doc: BoardDoc,
  fromId: string,
  toId: string,
  fromAnchor: AnchorKind = "auto",
  toAnchor: AnchorKind = "auto",
): ConnectionEndpoints | null {
  const fromNode = doc.nodes.find((node) => node.id === fromId);
  const toNode = doc.nodes.find((node) => node.id === toId);
  if (!fromNode || !toNode) return null;
  const start = resolveAnchor(fromNode, fromAnchor, { x: toNode.x, y: toNode.y });
  const end = resolveAnchor(toNode, toAnchor, { x: fromNode.x, y: fromNode.y });
  return { start, end, fromNode, toNode };
}

export function pinPosition(node: BoardNode): Vec2 {
  const tapes = tapePlacements(node);
  if (tapes.length > 0) return tapeWorldCenter(node, tapes[0]);
  const angle = degToRad(node.rotation);
  const local = rotateVec(0, -node.height / 2 - 6, angle);
  return { x: node.x + local.x, y: node.y + local.y };
}

function nearestTape(node: BoardNode, toward: Vec2): TapePlacement | null {
  const tapes = tapePlacements(node);
  if (tapes.length === 0) return null;
  let best = tapes[0];
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const tape of tapes) {
    const center = tapeWorldCenter(node, tape);
    const distance = Math.hypot(center.x - toward.x, center.y - toward.y);
    if (distance < bestDistance) {
      best = tape;
      bestDistance = distance;
    }
  }
  return best;
}

export function clampAnchorPoint(point: Vec2, margin = 50000): Vec2 {
  return {
    x: clamp(point.x, -margin, margin),
    y: clamp(point.y, -margin, margin),
  };
}
