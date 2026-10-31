import type { CameraState, Rect, Vec2 } from "../core/types";
import { clamp, MAX_ZOOM, MIN_ZOOM, mod } from "../util/math";

const TEXTURE_WORLD_SIZE = 768;

export interface CameraElements {
  stage: HTMLElement;
  camera: HTMLElement;
  surface: HTMLElement;
  root: HTMLElement;
}

export type ZoomListener = (zoom: number) => void;

const WHEEL_GLIDE_RATE = 30;

export class CameraManager {
  private state: CameraState;
  private tween: number | null = null;
  private glideFrame: number | null = null;
  private glideTarget: CameraState | null = null;
  private glideLast = 0;
  private appliedZoom: number | null = null;
  private readonly onZoom: ZoomListener;

  constructor(
    private readonly elements: CameraElements,
    initial: CameraState,
    onZoom?: ZoomListener,
  ) {
    this.state = { ...initial };
    this.onZoom = onZoom ?? (() => undefined);
  }

  get value(): CameraState {
    return { ...this.state };
  }

  get zoom(): number {
    return this.state.zoom;
  }

  get panX(): number {
    return this.state.x;
  }

  get panY(): number {
    return this.state.y;
  }

  set(camera: CameraState, options: { notify?: boolean } = {}): void {
    this.cancelTween();
    this.state = {
      x: camera.x,
      y: camera.y,
      zoom: clamp(camera.zoom, MIN_ZOOM, MAX_ZOOM),
    };
    this.apply();
    if (options.notify !== false) this.onZoom(this.state.zoom);
  }

  panBy(dx: number, dy: number): void {
    this.cancelTween();
    this.state = { ...this.state, x: this.state.x + dx, y: this.state.y + dy };
    this.apply();
  }

  /** Glide to a new pan position so wheel and trackpad input stays fluid. */
  panBySmooth(dx: number, dy: number): void {
    this.cancelTweenOnly();
    const target = this.glideTarget ?? this.value;
    this.glideTarget = { x: target.x + dx, y: target.y + dy, zoom: target.zoom };
    this.startGlide();
  }

  /** Zoom with the given screen point anchored, easing the camera toward it. */
  zoomAtSmooth(factor: number, screenX: number, screenY: number): void {
    this.cancelTweenOnly();
    const target = this.glideTarget ?? this.value;
    const rect = this.elements.stage.getBoundingClientRect();
    const localX = screenX - rect.left;
    const localY = screenY - rect.top;
    const worldX = (localX - target.x) / target.zoom;
    const worldY = (localY - target.y) / target.zoom;
    const zoom = clamp(target.zoom * factor, MIN_ZOOM, MAX_ZOOM);
    this.glideTarget = {
      x: localX - worldX * zoom,
      y: localY - worldY * zoom,
      zoom,
    };
    this.startGlide();
  }

  /** Zoom keeping the given screen point anchored. */
  zoomAt(zoom: number, screenX: number, screenY: number): void {
    this.cancelTween();
    const target = clamp(zoom, MIN_ZOOM, MAX_ZOOM);
    const point = this.screenToWorld(screenX, screenY);
    this.state = {
      zoom: target,
      x: screenX - point.x * target,
      y: screenY - point.y * target,
    };
    this.apply();
    this.onZoom(this.state.zoom);
  }

  zoomBy(factor: number, screenX?: number, screenY?: number): void {
    const rect = this.elements.stage.getBoundingClientRect();
    this.zoomAt(
      this.state.zoom * factor,
      screenX ?? rect.left + rect.width / 2,
      screenY ?? rect.top + rect.height / 2,
    );
  }

  screenToWorld(clientX: number, clientY: number): Vec2 {
    const rect = this.elements.stage.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    return {
      x: (x - this.state.x) / this.state.zoom,
      y: (y - this.state.y) / this.state.zoom,
    };
  }

  worldToScreen(worldX: number, worldY: number): Vec2 {
    const rect = this.elements.stage.getBoundingClientRect();
    return {
      x: rect.left + worldX * this.state.zoom + this.state.x,
      y: rect.top + worldY * this.state.zoom + this.state.y,
    };
  }

  viewportSize(): { width: number; height: number } {
    const rect = this.elements.stage.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  }

  worldCenter(): Vec2 {
    const size = this.viewportSize();
    const rect = this.elements.stage.getBoundingClientRect();
    return this.screenToWorld(rect.left + size.width / 2, rect.top + size.height / 2);
  }

  centerOn(point: Vec2, zoom = this.state.zoom): void {
    const size = this.viewportSize();
    this.set({
      x: size.width / 2 - point.x * zoom,
      y: size.height / 2 - point.y * zoom,
      zoom,
    });
  }

  reset(): void {
    this.animateTo(
      {
        x: this.elements.stage.clientWidth / 2,
        y: this.elements.stage.clientHeight / 2,
        zoom: 1,
      },
      260,
    );
  }

  fitTo(rect: Rect, paddingX = 120, paddingY = 140): void {
    const size = this.viewportSize();
    const availableW = Math.max(200, size.width - paddingX * 2);
    const availableH = Math.max(160, size.height - paddingY * 2);
    const zoom = clamp(
      Math.min(availableW / Math.max(rect.width, 1), availableH / Math.max(rect.height, 1), 1.35),
      MIN_ZOOM,
      MAX_ZOOM,
    );
    const centerX = rect.x + rect.width / 2;
    const centerY = rect.y + rect.height / 2;
    this.animateTo(
      {
        x: size.width / 2 - centerX * zoom,
        y: size.height / 2 - centerY * zoom,
        zoom,
      },
      300,
    );
  }

  animateTo(target: CameraState, duration = 280): void {
    this.cancelTween();
    const start = { ...this.state };
    const zoom = clamp(target.zoom, MIN_ZOOM, MAX_ZOOM);
    const startTime = performance.now();

    const tick = (now: number): void => {
      const t = clamp((now - startTime) / duration, 0, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      this.state = {
        x: start.x + (target.x - start.x) * eased,
        y: start.y + (target.y - start.y) * eased,
        zoom: start.zoom + (zoom - start.zoom) * eased,
      };
      this.apply();
      this.onZoom(this.state.zoom);
      if (t < 1) {
        this.tween = window.requestAnimationFrame(tick);
      } else {
        this.tween = null;
      }
    };
    this.tween = window.requestAnimationFrame(tick);
  }

  cancelTween(): void {
    this.cancelTweenOnly();
    if (this.glideFrame !== null) {
      cancelAnimationFrame(this.glideFrame);
      this.glideFrame = null;
    }
    this.glideTarget = null;
    this.elements.root.classList.remove("is-camera-gliding");
  }

  private cancelTweenOnly(): void {
    if (this.tween !== null) {
      cancelAnimationFrame(this.tween);
      this.tween = null;
    }
  }

  private startGlide(): void {
    if (this.glideFrame !== null) return;
    this.elements.root.classList.add("is-camera-gliding");
    this.glideLast = performance.now();
    const step = (now: number): void => {
      this.glideFrame = null;
      const target = this.glideTarget;
      if (!target) {
        this.elements.root.classList.remove("is-camera-gliding");
        return;
      }
      const dt = clamp((now - this.glideLast) / 1000, 0, 0.05);
      this.glideLast = now;
      const alpha = 1 - Math.exp(-Math.max(dt, 0.001) * WHEEL_GLIDE_RATE);
      const x = this.state.x + (target.x - this.state.x) * alpha;
      const y = this.state.y + (target.y - this.state.y) * alpha;
      const zoom = this.state.zoom + (target.zoom - this.state.zoom) * alpha;
      const done =
        Math.abs(target.x - x) < 0.3 &&
        Math.abs(target.y - y) < 0.3 &&
        Math.abs(target.zoom - zoom) < 0.0006;
      this.state = done ? { ...target } : { x, y, zoom };
      this.apply();
      if (done) {
        this.glideTarget = null;
        this.elements.root.classList.remove("is-camera-gliding");
        return;
      }
      this.glideFrame = window.requestAnimationFrame(step);
    };
    this.glideFrame = window.requestAnimationFrame(step);
  }

  apply(): void {
    const { camera, surface, root } = this.elements;
    camera.style.transform = `translate3d(${this.state.x}px, ${this.state.y}px, 0) scale(${this.state.zoom})`;

    const zoom = this.state.zoom;
    const tile = TEXTURE_WORLD_SIZE * zoom;
    surface.style.backgroundPosition = `${mod(this.state.x, tile)}px ${mod(this.state.y, tile)}px`;
    if (this.appliedZoom !== zoom) {
      this.appliedZoom = zoom;
      surface.style.backgroundSize = `${tile}px ${tile}px`;
      root.dataset.lod = zoom < 0.34 ? "far" : zoom < 0.62 ? "mid" : "near";
      root.style.setProperty("--cb-zoom", String(zoom));
    }
    this.onZoom(zoom);
  }

  destroy(): void {
    this.cancelTween();
  }
}
