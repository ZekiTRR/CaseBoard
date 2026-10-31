import type { BoardNode, Rect, Vec2 } from "../core/types";

export const TAU = Math.PI * 2;
export const MIN_ZOOM = 0.12;
export const MAX_ZOOM = 8;

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function degToRad(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

export function radToDeg(radians: number): number {
  return (radians * 180) / Math.PI;
}

export function normalizeDeg(degrees: number): number {
  let value = degrees % 360;
  if (value > 180) value -= 360;
  if (value <= -180) value += 360;
  return value;
}

export function rotateVec(x: number, y: number, angle: number): Vec2 {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return { x: x * cos - y * sin, y: x * sin + y * cos };
}

export function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function mod(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus;
}

export function roundTo(value: number, step: number): number {
  if (step <= 0) return value;
  return Math.round(value / step) * step;
}

export function rectsIntersect(a: Rect, b: Rect, padding = 0): boolean {
  return (
    a.x < b.x + b.width + padding &&
    a.x + a.width + padding > b.x &&
    a.y < b.y + b.height + padding &&
    a.y + a.height + padding > b.y
  );
}

export function rectFromPoints(a: Vec2, b: Vec2): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}

export function unionRects(rects: Rect[]): Rect | null {
  if (rects.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of rects) {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.width);
    maxY = Math.max(maxY, r.y + r.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function expandRect(rect: Rect, padding: number): Rect {
  return {
    x: rect.x - padding,
    y: rect.y - padding,
    width: rect.width + padding * 2,
    height: rect.height + padding * 2,
  };
}

export function nodeCorners(node: BoardNode): Vec2[] {
  const angle = degToRad(node.rotation);
  const halfW = node.width / 2;
  const halfH = node.height / 2;
  return [
    { x: -halfW, y: -halfH },
    { x: halfW, y: -halfH },
    { x: halfW, y: halfH },
    { x: -halfW, y: halfH },
  ].map((p) => {
    const r = rotateVec(p.x, p.y, angle);
    return { x: node.x + r.x, y: node.y + r.y };
  });
}

export function nodeBounds(node: BoardNode): Rect {
  const corners = nodeCorners(node);
  const xs = corners.map((p) => p.x);
  const ys = corners.map((p) => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return {
    x: minX,
    y: minY,
    width: Math.max(...xs) - minX,
    height: Math.max(...ys) - minY,
  };
}

export function nodesBounds(nodes: BoardNode[]): Rect | null {
  return unionRects(nodes.map(nodeBounds));
}

export function pointInRotatedNode(node: BoardNode, point: Vec2): boolean {
  const angle = -degToRad(node.rotation);
  const dx = point.x - node.x;
  const dy = point.y - node.y;
  const local = rotateVec(dx, dy, angle);
  return Math.abs(local.x) <= node.width / 2 && Math.abs(local.y) <= node.height / 2;
}

export function seededRandom(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return mulberry32(h >>> 0);
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(value: string, seed = 0): number {
  let h = 2166136261 ^ seed;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function formatZoom(zoom: number): string {
  return `${Math.round(zoom * 100)}%`;
}

export function isHexColor(value: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(value);
}

export function withAlpha(hex: string, alpha: number): string {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match) return `rgba(0,0,0,${alpha})`;
  const int = parseInt(match[1], 16);
  return `rgba(${(int >> 16) & 255}, ${(int >> 8) & 255}, ${int & 255}, ${alpha})`;
}

export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}
