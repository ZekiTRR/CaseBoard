import type {
  BoardConnection,
  BoardDoc,
  ConnectionGeometry,
  Vec2,
} from "../core/types";
import { clamp, hashString, TAU } from "../util/math";
import { resolveEndpoints } from "../render/anchors";

interface RopeState {
  points: Vec2[];
  previous: Vec2[];
  restLength: number;
  segmentLength: number;
  idleTime: number;
  asleep: boolean;
  lastSag: number;
  lastTension: number;
  start: Vec2;
  end: Vec2;
}

const GRAVITY = 2200;
const MIN_SEGMENTS = 8;
const MAX_SEGMENTS = 34;

export class PhysicsEngine {
  private readonly ropes = new Map<string, RopeState>();
  private readonly geometry = new Map<string, ConnectionGeometry>();
  private readonly dirty = new Set<string>();
  private animationUntil = 0;
  private lastAnimationUpdate = 0;
  private wasAnimating = false;
  private lastNow = 0;

  constructor(private readonly getBoard: () => BoardDoc | null) {}

  reset(): void {
    this.ropes.clear();
    this.geometry.clear();
    this.dirty.clear();
    this.animationUntil = 0;
    this.lastNow = 0;
  }

  markDirty(ids: Iterable<string>): void {
    for (const id of ids) {
      this.dirty.add(id);
      const rope = this.ropes.get(id);
      if (rope) {
        rope.asleep = false;
        rope.idleTime = 0;
      }
    }
  }

  markAllDirty(): void {
    const board = this.getBoard();
    if (!board) return;
    for (const connection of board.connections) {
      this.dirty.add(connection.id);
      const rope = this.ropes.get(connection.id);
      if (rope) {
        rope.asleep = false;
        rope.idleTime = 0;
      }
    }
  }

  remove(connectionId: string): void {
    this.ropes.delete(connectionId);
    this.geometry.delete(connectionId);
    this.dirty.delete(connectionId);
  }

  getGeometry(connectionId: string): ConnectionGeometry | null {
    return this.geometry.get(connectionId) ?? null;
  }

  get isAnimating(): boolean {
    return performance.now() < this.animationUntil;
  }

  wakeAnimation(now = performance.now()): void {
    const board = this.getBoard();
    if (!board) return;
    if (!board.connections.some((c) => c.animated && c.physics === "taut")) return;
    this.animationUntil = Math.max(this.animationUntil, now + 3200);
  }

  hasActivity(now = performance.now()): boolean {
    if (this.dirty.size > 0) return true;
    if (now < this.animationUntil) return true;
    const board = this.getBoard();
    for (const [id, rope] of this.ropes) {
      if (!rope.asleep) return true;
      const connection = board?.connections.find((item) => item.id === id);
      if (connection?.autoTension) {
        const distance = Math.hypot(rope.end.x - rope.start.x, rope.end.y - rope.start.y);
        if (rope.restLength - Math.max(12, distance * 1.035) > 0.4) return true;
      }
    }
    return false;
  }

  update(now: number): Set<string> {
    const board = this.getBoard();
    const changed = new Set<string>();
    if (!board) return changed;

    const dt = this.lastNow === 0 ? 0 : clamp((now - this.lastNow) / 1000, 0, 0.05);
    this.lastNow = now;

    const connectionsById = new Map(board.connections.map((connection) => [connection.id, connection]));
    const animating = now < this.animationUntil;

    for (const id of [...this.dirty]) {
      const connection = connectionsById.get(id);
      if (!connection) {
        this.ropes.delete(id);
        this.geometry.delete(id);
        continue;
      }
      const ends = resolveEndpoints(
        board,
        connection.from.nodeId,
        connection.to.nodeId,
        connection.from.anchor,
        connection.to.anchor,
      );
      if (!ends) continue;

      if (connection.physics === "dynamic") {
        let rope = this.ropes.get(id);
        if (!rope) {
          rope = this.createRope(connection, ends.start, ends.end);
          this.ropes.set(id, rope);
        }
        this.syncRopeSettings(rope, connection);
        rope.start = ends.start;
        rope.end = ends.end;
        rope.points[0] = { ...ends.start };
        rope.points[rope.points.length - 1] = { ...ends.end };
        rope.previous[0] = { ...ends.start };
        rope.previous[rope.previous.length - 1] = { ...ends.end };
        rope.asleep = false;
        rope.idleTime = 0;
        this.geometry.set(id, this.geometryFromPoints(rope, ends.start, ends.end));
        changed.add(id);
      } else {
        this.ropes.delete(id);
        this.geometry.set(
          id,
          this.computeCurved(connection, ends.start, ends.end, now, animating),
        );
        changed.add(id);
      }
    }
    this.dirty.clear();

    for (const [id, rope] of [...this.ropes]) {
      const connection = connectionsById.get(id);
      if (!connection || connection.physics !== "dynamic") {
        this.ropes.delete(id);
        this.geometry.delete(id);
        continue;
      }
      const ends = resolveEndpoints(
        board,
        connection.from.nodeId,
        connection.to.nodeId,
        connection.from.anchor,
        connection.to.anchor,
      );
      if (!ends) continue;

      const moved =
        Math.hypot(ends.start.x - rope.start.x, ends.start.y - rope.start.y) > 0.08 ||
        Math.hypot(ends.end.x - rope.end.x, ends.end.y - rope.end.y) > 0.08;
      rope.start = ends.start;
      rope.end = ends.end;
      if (moved) {
        rope.asleep = false;
        rope.idleTime = 0;
      }

      if (rope.asleep) {
        if (connection.autoTension) {
          const distance = Math.hypot(ends.end.x - ends.start.x, ends.end.y - ends.start.y);
          const target = Math.max(12, distance * 1.035);
          if (rope.restLength - target > 0.4) {
            rope.restLength = Math.max(
              target,
              rope.restLength - Math.max(1.2, rope.restLength * 0.025),
            );
            rope.segmentLength = rope.restLength / (rope.points.length - 1);
            rope.asleep = false;
            rope.idleTime = 0;
            changed.add(id);
          }
        }
        continue;
      }

      if (dt > 0) {
        this.stepRope(rope, dt);
      }
      this.geometry.set(id, this.geometryFromPoints(rope, ends.start, ends.end));
      changed.add(id);
      this.updateSleep(rope, dt);
    }

    if (animating && now - this.lastAnimationUpdate > 32) {
      this.lastAnimationUpdate = now;
      for (const connection of board.connections) {
        if (connection.physics !== "taut" || !connection.animated) continue;
        const ends = resolveEndpoints(
          board,
          connection.from.nodeId,
          connection.to.nodeId,
          connection.from.anchor,
          connection.to.anchor,
        );
        if (!ends) continue;
        this.geometry.set(
          connection.id,
          this.computeCurved(connection, ends.start, ends.end, now, true),
        );
        changed.add(connection.id);
      }
    }

    if (this.wasAnimating && !animating) {
      for (const connection of board.connections) {
        if (connection.physics !== "taut" || !connection.animated) continue;
        const ends = resolveEndpoints(
          board,
          connection.from.nodeId,
          connection.to.nodeId,
          connection.from.anchor,
          connection.to.anchor,
        );
        if (!ends) continue;
        this.geometry.set(
          connection.id,
          this.computeCurved(connection, ends.start, ends.end, now, false),
        );
        changed.add(connection.id);
      }
    }
    this.wasAnimating = animating;

    return changed;
  }

  private createRope(connection: BoardConnection, start: Vec2, end: Vec2): RopeState {
    const distance = Math.hypot(end.x - start.x, end.y - start.y);
    const base = Math.max(connection.restLength, distance * 1.01, 12);
    const restLength = this.effectiveLength(base, connection);
    const segments = clamp(Math.round(restLength / 26), MIN_SEGMENTS, MAX_SEGMENTS);
    const points: Vec2[] = [];
    const previous: Vec2[] = [];
    const sag = Math.min(42, restLength * 0.045);
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const point = {
        x: start.x + (end.x - start.x) * t,
        y: start.y + (end.y - start.y) * t + Math.sin(Math.PI * t) * sag,
      };
      points.push(point);
      previous.push({ ...point });
    }
    return {
      points,
      previous,
      restLength,
      segmentLength: restLength / segments,
      idleTime: 0,
      asleep: false,
      lastSag: connection.sag,
      lastTension: connection.tension,
      start: { ...start },
      end: { ...end },
    };
  }

  private syncRopeSettings(rope: RopeState, connection: BoardConnection): void {
    if (rope.lastSag === connection.sag && rope.lastTension === connection.tension) return;
    rope.lastSag = connection.sag;
    rope.lastTension = connection.tension;
    const distance = Math.hypot(rope.end.x - rope.start.x, rope.end.y - rope.start.y);
    const base = Math.max(connection.restLength, distance * 1.01, 12);
    rope.restLength = this.effectiveLength(base, connection);
    rope.segmentLength = rope.restLength / (rope.points.length - 1);
    rope.asleep = false;
    rope.idleTime = 0;
  }

  private effectiveLength(base: number, connection: BoardConnection): number {
    const sagFactor = 0.92 + connection.sag * 0.22;
    const tensionFactor = 1 - connection.tension * 0.1;
    return Math.max(12, base * sagFactor * tensionFactor);
  }

  private stepRope(rope: RopeState, dt: number): void {
    const steps = clamp(Math.ceil(dt / (1 / 60)), 1, 3);
    const h = dt / steps;
    const retention = Math.pow(0.982, h * 60);
    const points = rope.points;
    const previous = rope.previous;
    const segmentLength = rope.segmentLength;
    const last = points.length - 1;

    for (let step = 0; step < steps; step++) {
      for (let i = 1; i < last; i++) {
        const point = points[i];
        const prev = previous[i];
        const vx = (point.x - prev.x) * retention;
        const vy = (point.y - prev.y) * retention + GRAVITY * h * h;
        prev.x = point.x;
        prev.y = point.y;
        point.x += vx;
        point.y += vy;
      }

      points[0] = { ...rope.start };
      points[last] = { ...rope.end };

      for (let iteration = 0; iteration < 5; iteration++) {
        for (let i = 0; i < last; i++) {
          const a = points[i];
          const b = points[i + 1];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const length = Math.hypot(dx, dy);
          if (length < 0.0001) continue;
          const difference = (length - segmentLength) / length;
          const offsetX = dx * difference;
          const offsetY = dy * difference;
          if (i === 0) {
            b.x -= offsetX;
            b.y -= offsetY;
          } else if (i + 1 === last) {
            a.x += offsetX;
            a.y += offsetY;
          } else {
            a.x += offsetX * 0.5;
            a.y += offsetY * 0.5;
            b.x -= offsetX * 0.5;
            b.y -= offsetY * 0.5;
          }
        }
        points[0] = { ...rope.start };
        points[last] = { ...rope.end };
      }
    }

    rope.segmentLength = segmentLength;
  }

  private updateSleep(rope: RopeState, dt: number): void {
    let speed = 0;
    for (let i = 1; i < rope.points.length - 1; i++) {
      const p = rope.points[i];
      const prev = rope.previous[i];
      speed += Math.hypot(p.x - prev.x, p.y - prev.y);
    }
    speed /= Math.max(1, rope.points.length - 2);
    if (speed < 0.22) {
      rope.idleTime += dt;
      if (rope.idleTime > 0.55) {
        rope.asleep = true;
      }
    } else {
      rope.idleTime = 0;
    }
  }

  private geometryFromPoints(rope: RopeState, start: Vec2, end: Vec2): ConnectionGeometry {
    const points = rope.points.map((point) => ({ x: point.x, y: point.y }));
    points[0] = { ...start };
    points[points.length - 1] = { ...end };
    return { points, start: { ...start }, end: { ...end } };
  }

  private computeCurved(
    connection: BoardConnection,
    start: Vec2,
    end: Vec2,
    now: number,
    animating: boolean,
  ): ConnectionGeometry {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.hypot(dx, dy);
    if (length < 1) {
      return { points: [{ ...start }, { ...end }], start: { ...start }, end: { ...end } };
    }

    const restLength = Math.max(connection.restLength, length);
    const slackRatio = clamp((restLength - length) / Math.max(length, 1), 0, 0.4);
    let sag: number;
    if (connection.autoTension) {
      sag =
        length *
        (0.008 + slackRatio * 0.42) *
        connection.sag *
        (1 - connection.tension * 0.58);
    } else {
      sag = length * 0.085 * connection.sag * (1 - connection.tension * 0.6);
    }
    sag = clamp(sag, length * 0.004, 280);

    const normalX = -dy / length;
    const normalY = dx / length;
    const phase = (hashString(connection.id) / 0xffffffff) * TAU;
    const sway =
      connection.physics === "taut" && connection.animated && animating
        ? Math.sin(now / 720 + phase) * Math.min(2.6, length * 0.006)
        : 0;

    const segments = clamp(Math.round(length / 55) + 8, 9, 28);
    const points: Vec2[] = [];
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const sagOffset = 4 * t * (1 - t) * sag;
      const lateral = Math.sin(Math.PI * t) * sway;
      points.push({
        x: start.x + dx * t + normalX * lateral,
        y: start.y + dy * t + sagOffset + normalY * lateral,
      });
    }
    return { points, start: { ...start }, end: { ...end } };
  }
}
