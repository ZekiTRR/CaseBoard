import type { Rect, Vec2 } from "../core/types";
import { clamp, hashString, TAU } from "../util/math";

export interface LayoutNodeSpec {
  key: string;
  width: number;
  height: number;
  fixed?: boolean;
}

export interface LayoutEdgeSpec {
  from: string;
  to: string;
}

export interface LayoutOptions {
  rootKey: string;
  rootPosition?: Vec2 | null;
  mode: "organic" | "tree";
  viewCenter: Vec2;
  obstacles: Rect[];
}

export interface LayoutResult {
  positions: Map<string, Vec2>;
  bounds: Rect;
}

const GAP = 112;

export function layoutGraph(
  nodes: LayoutNodeSpec[],
  edges: LayoutEdgeSpec[],
  options: LayoutOptions,
): LayoutResult {
  const specs = new Map(nodes.map((node) => [node.key, node]));
  const root = specs.get(options.rootKey) ?? nodes[0];
  if (!root) {
    return { positions: new Map(), bounds: { x: 0, y: 0, width: 0, height: 0 } };
  }

  const radii = new Map<string, number>();
  for (const node of nodes) {
    radii.set(node.key, Math.hypot(node.width, node.height) / 2 + 12);
  }
  const maxRadius = Math.max(...[...radii.values()], 80);

  const adjacency = buildAdjacency(nodes, edges);
  const depth = new Map<string, number>();
  const parent = new Map<string, string | null>();
  const children = new Map<string, string[]>();
  for (const node of nodes) children.set(node.key, []);

  depth.set(root.key, 0);
  parent.set(root.key, null);
  const queue = [root.key];
  while (queue.length > 0) {
    const key = queue.shift() as string;
    const neighbors = (adjacency.get(key) ?? []).filter((next) => !depth.has(next));
    neighbors.sort();
    for (const next of neighbors) {
      depth.set(next, (depth.get(key) ?? 0) + 1);
      parent.set(next, key);
      children.get(key)?.push(next);
      queue.push(next);
    }
  }
  for (const node of nodes) {
    if (depth.has(node.key)) continue;
    depth.set(node.key, 1);
    parent.set(node.key, root.key);
    children.get(root.key)?.push(node.key);
  }

  const weight = new Map<string, number>();
  for (const node of nodes) weight.set(node.key, 1);
  const byDepthDescending = [...nodes].sort(
    (a, b) => (depth.get(b.key) ?? 0) - (depth.get(a.key) ?? 0),
  );
  for (const node of byDepthDescending) {
    const p = parent.get(node.key);
    if (p) weight.set(p, (weight.get(p) ?? 1) + (weight.get(node.key) ?? 1));
  }

  const angles = new Map<string, number>();
  angles.set(root.key, -Math.PI / 2);
  assignAngles(root.key, -Math.PI / 2, (3 * Math.PI) / 2, children, weight, angles);

  const layers = new Map<number, string[]>();
  let maxDepth = 0;
  for (const node of nodes) {
    if (node.key === root.key) continue;
    const d = depth.get(node.key) ?? 1;
    maxDepth = Math.max(maxDepth, d);
    const layer = layers.get(d) ?? [];
    layer.push(node.key);
    layers.set(d, layer);
  }

  const layerRadius = new Map<number, number>();
  let previousRadius = 0;
  for (let d = 1; d <= maxDepth; d++) {
    const layer = layers.get(d) ?? [];
    const circumference = layer.reduce((sum, key) => sum + 2 * (radii.get(key) ?? 80) + GAP, 0);
    const needed = circumference / TAU;
    const radius = Math.max(needed, previousRadius + 2 * maxRadius + 150, 470 + d * 110);
    layerRadius.set(d, radius);
    previousRadius = radius;
  }

  const positions = new Map<string, Vec2>();
  positions.set(root.key, { x: 0, y: 0 });
  for (const node of nodes) {
    if (node.key === root.key) continue;
    const d = depth.get(node.key) ?? 1;
    const baseRadius = layerRadius.get(d) ?? 420;
    let angle = angles.get(node.key) ?? 0;
    let radius = baseRadius;
    if (options.mode === "organic") {
      const random = seededUnit(node.key);
      angle += (random - 0.5) * 0.16;
      radius *= 1 + (seededUnit(`${node.key}:r`) - 0.5) * 0.045;
    }
    positions.set(node.key, {
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
    });
  }

  const rootFixed = Boolean(options.rootPosition);
  const rootOffset = options.rootPosition ?? { x: 0, y: 0 };
  for (const [key, position] of positions) {
    positions.set(key, { x: position.x + rootOffset.x, y: position.y + rootOffset.y });
  }

  const fixedKeys = new Set<string>([root.key]);
  for (const node of nodes) {
    if (node.fixed) fixedKeys.add(node.key);
  }

  if (options.mode === "organic") {
    relax(
      positions,
      nodes,
      edges,
      radii,
      fixedKeys,
      rootFixed ? options.obstacles : [],
      root.key,
    );
  } else {
    resolveCollisions(positions, nodes, radii, fixedKeys, rootFixed ? options.obstacles : [], 26);
  }

  if (!rootFixed) {
    const bounds = boundsOf(positions, nodes);
    const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
    let dx = options.viewCenter.x - center.x;
    let dy = options.viewCenter.y - center.y;
    const spot = findFreeTranslation(positions, nodes, radii, options.obstacles, options.viewCenter);
    dx = spot.x;
    dy = spot.y;
    for (const [key, position] of positions) {
      positions.set(key, { x: position.x + dx, y: position.y + dy });
    }
  } else {
    resolveObstacles(positions, nodes, radii, fixedKeys, options.obstacles, 20);
  }

  return { positions, bounds: boundsOf(positions, nodes) };
}

function buildAdjacency(
  nodes: LayoutNodeSpec[],
  edges: LayoutEdgeSpec[],
): Map<string, string[]> {
  const adjacency = new Map<string, string[]>();
  for (const node of nodes) adjacency.set(node.key, []);
  const known = new Set(nodes.map((node) => node.key));
  const seen = new Set<string>();
  for (const edge of edges) {
    if (edge.from === edge.to) continue;
    if (!known.has(edge.from) || !known.has(edge.to)) continue;
    const pair = [edge.from, edge.to].sort().join("\u0000");
    if (seen.has(pair)) continue;
    seen.add(pair);
    adjacency.get(edge.from)?.push(edge.to);
    adjacency.get(edge.to)?.push(edge.from);
  }
  return adjacency;
}

function assignAngles(
  key: string,
  start: number,
  end: number,
  children: Map<string, string[]>,
  weight: Map<string, number>,
  angles: Map<string, number>,
): void {
  const kids = children.get(key) ?? [];
  if (kids.length === 0) return;
  const total = kids.reduce((sum, child) => sum + (weight.get(child) ?? 1), 0);
  const span = end - start;
  let cursor = start;
  for (const child of kids) {
    const childSpan = (span * (weight.get(child) ?? 1)) / total;
    const pad = Math.min(0.09, childSpan * 0.12);
    const childStart = cursor + pad;
    const childEnd = cursor + childSpan - pad;
    angles.set(child, (childStart + childEnd) / 2);
    assignAngles(child, childStart, childEnd, children, weight, angles);
    cursor += childSpan;
  }
}

function relax(
  positions: Map<string, Vec2>,
  nodes: LayoutNodeSpec[],
  edges: LayoutEdgeSpec[],
  radii: Map<string, number>,
  fixedKeys: Set<string>,
  obstacles: Rect[],
  rootKey: string,
): void {
  const keys = nodes.map((node) => node.key);
  const validEdges = edges.filter(
    (edge) => positions.has(edge.from) && positions.has(edge.to) && edge.from !== edge.to,
  );

  for (let iteration = 0; iteration < 150; iteration++) {
    for (let i = 0; i < keys.length; i++) {
      for (let j = i + 1; j < keys.length; j++) {
        const a = keys[i];
        const b = keys[j];
        const pa = positions.get(a) as Vec2;
        const pb = positions.get(b) as Vec2;
        const radiusA = radii.get(a) ?? 80;
        const radiusB = radii.get(b) ?? 80;
        const minDistance = radiusA + radiusB + 62;
        const dx = pb.x - pa.x;
        const dy = pb.y - pa.y;
        const distance = Math.hypot(dx, dy);
        if (distance < minDistance && distance > 0.001) {
          const push = clamp((minDistance - distance) * 0.5, 0, 22);
          const nx = dx / distance;
          const ny = dy / distance;
          if (!fixedKeys.has(a)) {
            pa.x -= nx * push;
            pa.y -= ny * push;
          }
          if (!fixedKeys.has(b)) {
            pb.x += nx * push;
            pb.y += ny * push;
          }
        } else if (distance < minDistance * 1.7 && distance > 0.001) {
          const pull = (minDistance * 1.7 - distance) * 0.004;
          const nx = dx / distance;
          const ny = dy / distance;
          if (!fixedKeys.has(a)) {
            pa.x -= nx * pull;
            pa.y -= ny * pull;
          }
          if (!fixedKeys.has(b)) {
            pb.x += nx * pull;
            pb.y += ny * pull;
          }
        }
      }
    }

    for (const edge of validEdges) {
      const pa = positions.get(edge.from) as Vec2;
      const pb = positions.get(edge.to) as Vec2;
      const rest = (radii.get(edge.from) ?? 80) + (radii.get(edge.to) ?? 80) + GAP;
      const dx = pb.x - pa.x;
      const dy = pb.y - pa.y;
      const distance = Math.hypot(dx, dy) || 1;
      const nx = dx / distance;
      const ny = dy / distance;
      if (distance > rest * 1.55) {
        const pull = Math.min(14, (distance - rest) * 0.018);
        if (!fixedKeys.has(edge.from)) {
          pa.x += nx * pull;
          pa.y += ny * pull;
        }
        if (!fixedKeys.has(edge.to)) {
          pb.x -= nx * pull;
          pb.y -= ny * pull;
        }
      }
    }

    const root = positions.get(rootKey);
    if (root) {
      for (const key of keys) {
        if (fixedKeys.has(key)) continue;
        const p = positions.get(key) as Vec2;
        const dx = root.x - p.x;
        const dy = root.y - p.y;
        p.x += dx * 0.0012;
        p.y += dy * 0.0012;
      }
    }

    resolveObstacles(positions, nodes, radii, fixedKeys, obstacles, 1);
  }

  resolveCollisions(positions, nodes, radii, fixedKeys, obstacles, 24);
}

function resolveCollisions(
  positions: Map<string, Vec2>,
  nodes: LayoutNodeSpec[],
  radii: Map<string, number>,
  fixedKeys: Set<string>,
  obstacles: Rect[],
  iterations: number,
): void {
  for (let iteration = 0; iteration < iterations; iteration++) {
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i].key;
        const b = nodes[j].key;
        const pa = positions.get(a) as Vec2;
        const pb = positions.get(b) as Vec2;
        const minDistance = (radii.get(a) ?? 80) + (radii.get(b) ?? 80) + 56;
        const dx = pb.x - pa.x;
        const dy = pb.y - pa.y;
        const distance = Math.hypot(dx, dy);
        if (distance >= minDistance || distance < 0.001) continue;
        const push = (minDistance - distance) * 0.5;
        const nx = dx / distance;
        const ny = dy / distance;
        if (!fixedKeys.has(a)) {
          pa.x -= nx * push;
          pa.y -= ny * push;
        }
        if (!fixedKeys.has(b)) {
          pb.x += nx * push;
          pb.y += ny * push;
        }
      }
    }
    resolveObstacles(positions, nodes, radii, fixedKeys, obstacles, 1);
  }
}

function resolveObstacles(
  positions: Map<string, Vec2>,
  nodes: LayoutNodeSpec[],
  radii: Map<string, number>,
  fixedKeys: Set<string>,
  obstacles: Rect[],
  iterations: number,
): void {
  if (obstacles.length === 0) return;
  for (let iteration = 0; iteration < iterations; iteration++) {
    for (const node of nodes) {
      if (fixedKeys.has(node.key)) continue;
      const position = positions.get(node.key);
      if (!position) continue;
      const radius = (radii.get(node.key) ?? 80) + 16;
      for (const obstacle of obstacles) {
        pushOutOfRect(position, radius, obstacle);
      }
    }
  }
}

function pushOutOfRect(position: Vec2, radius: number, rect: Rect): void {
  const left = rect.x;
  const right = rect.x + rect.width;
  const top = rect.y;
  const bottom = rect.y + rect.height;
  if (position.x < left - radius || position.x > right + radius) return;
  if (position.y < top - radius || position.y > bottom + radius) return;

  const closestX = clamp(position.x, left, right);
  const closestY = clamp(position.y, top, bottom);
  const dx = position.x - closestX;
  const dy = position.y - closestY;
  const distance = Math.hypot(dx, dy);

  if (distance > 0.001) {
    if (distance < radius) {
      const push = radius - distance;
      position.x += (dx / distance) * push;
      position.y += (dy / distance) * push;
    }
    return;
  }

  const distances: Array<{ side: "left" | "right" | "top" | "bottom"; distance: number }> = [
    { side: "left", distance: position.x - left },
    { side: "right", distance: right - position.x },
    { side: "top", distance: position.y - top },
    { side: "bottom", distance: bottom - position.y },
  ];
  distances.sort((a, b) => a.distance - b.distance);
  const closest = distances[0];
  if (closest.side === "left") position.x = left - radius;
  else if (closest.side === "right") position.x = right + radius;
  else if (closest.side === "top") position.y = top - radius;
  else position.y = bottom + radius;
}

function findFreeTranslation(
  positions: Map<string, Vec2>,
  nodes: LayoutNodeSpec[],
  radii: Map<string, number>,
  obstacles: Rect[],
  desired: Vec2,
): Vec2 {
  if (obstacles.length === 0) {
    const bounds = boundsOf(positions, nodes);
    return {
      x: desired.x - (bounds.x + bounds.width / 2),
      y: desired.y - (bounds.y + bounds.height / 2),
    };
  }

  const bounds = boundsOf(positions, nodes);
  const currentCenter = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  const baseDx = desired.x - currentCenter.x;
  const baseDy = desired.y - currentCenter.y;
  const step = Math.max(120, Math.min(260, Math.max(bounds.width, bounds.height) * 0.18));

  const score = (dx: number, dy: number): number => {
    let collisions = 0;
    for (const node of nodes) {
      const p = positions.get(node.key);
      if (!p) continue;
      const radius = (radii.get(node.key) ?? 80) + 20;
      const cx = p.x + dx;
      const cy = p.y + dy;
      for (const obstacle of obstacles) {
        const closestX = clamp(cx, obstacle.x, obstacle.x + obstacle.width);
        const closestY = clamp(cy, obstacle.y, obstacle.y + obstacle.height);
        if (Math.hypot(cx - closestX, cy - closestY) < radius) collisions++;
      }
    }
    return collisions;
  };

  if (score(baseDx, baseDy) === 0) return { x: baseDx, y: baseDy };

  let bestDx = baseDx;
  let bestDy = baseDy;
  let bestScore = Number.POSITIVE_INFINITY;
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 1; i <= 180; i++) {
    const radius = step * Math.sqrt(i);
    const angle = i * golden;
    const dx = baseDx + Math.cos(angle) * radius;
    const dy = baseDy + Math.sin(angle) * radius;
    const collisions = score(dx, dy);
    if (collisions === 0) return { x: dx, y: dy };
    if (collisions < bestScore) {
      bestScore = collisions;
      bestDx = dx;
      bestDy = dy;
    }
  }
  return { x: bestDx, y: bestDy };
}

function boundsOf(positions: Map<string, Vec2>, nodes: LayoutNodeSpec[]): Rect {
  if (nodes.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const node of nodes) {
    const position = positions.get(node.key);
    if (!position) continue;
    minX = Math.min(minX, position.x - node.width / 2);
    minY = Math.min(minY, position.y - node.height / 2);
    maxX = Math.max(maxX, position.x + node.width / 2);
    maxY = Math.max(maxY, position.y + node.height / 2);
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, width: 0, height: 0 };
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function seededUnit(seed: string): number {
  return hashString(seed) / 0xffffffff;
}
