import type { CameraManager } from "../core/CameraManager";

const LENS_SIZE = 260;
const DEFAULT_LENS_ZOOM = 2.4;
const MIN_LENS_ZOOM = 1.25;
const MAX_LENS_ZOOM = 8;

const UI_SELECTOR =
  ".cb-toolbar, .cb-zoom-controls, .cb-board-head, .cb-thread-inspector, .cb-empty, .cb-tool-hint, .cb-toast, .cb-loading, .cb-error, .caseboard-modal, .modal-container, .menu";

export class BoardLoupe {
  private readonly el: HTMLElement;
  private readonly scene: HTMLElement;
  private readonly host: HTMLElement;
  private readonly scale: HTMLElement;
  private cameraClone: HTMLElement | null = null;
  private surfaceClone: HTMLElement | null = null;
  private backgroundClone: HTMLElement | null = null;
  private active = false;
  private visible = false;
  private lensZoom = DEFAULT_LENS_ZOOM;
  private pointer = { x: 0, y: 0 };
  private center = { x: 0, y: 0 };
  private refreshTimer: number | null = null;

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (!this.active) return;
    const target = event.target instanceof Element ? event.target : null;
    const rect = this.stage.getBoundingClientRect();
    const inside =
      event.clientX >= rect.left &&
      event.clientX <= rect.right &&
      event.clientY >= rect.top &&
      event.clientY <= rect.bottom;
    if (!inside || target?.closest(UI_SELECTOR)) {
      this.hide();
      return;
    }
    this.pointer = { x: event.clientX, y: event.clientY };
    this.show();
  };

  constructor(
    private readonly stage: HTMLElement,
    private readonly cameraEl: HTMLElement,
    private readonly surfaceEl: HTMLElement,
    private readonly root: HTMLElement,
    private readonly camera: CameraManager,
  ) {
    this.el = document.createElement("div");
    this.el.className = "caseboard-root cb-loupe";
    this.el.hidden = true;
    this.scene = document.createElement("div");
    this.scene.className = "cb-loupe-scene";
    this.host = document.createElement("div");
    this.host.className = "cb-loupe-host";
    this.scale = document.createElement("div");
    this.scale.className = "cb-loupe-scale";
    this.updateScaleLabel();
    const glass = document.createElement("div");
    glass.className = "cb-loupe-glass";
    this.scene.appendChild(this.host);
    this.el.append(this.scene, glass, this.scale);
    document.body.appendChild(this.el);
    window.addEventListener("pointermove", this.onPointerMove, true);
    window.addEventListener("blur", this.onWindowBlur);
  }

  get isActive(): boolean {
    return this.active;
  }

  adjustZoom(factor: number): boolean {
    if (!this.active || !Number.isFinite(factor) || factor <= 0) return false;
    const next = Math.max(MIN_LENS_ZOOM, Math.min(MAX_LENS_ZOOM, this.lensZoom * factor));
    if (Math.abs(next - this.lensZoom) < 0.0001) return false;
    this.lensZoom = next;
    this.updateScaleLabel();
    this.updateTransform();
    return true;
  }

  toggle(): boolean {
    this.setActive(!this.active);
    return this.active;
  }

  setActive(active: boolean): void {
    if (this.active === active) return;
    this.active = active;
    this.root.classList.toggle("is-loupe", active);
    if (!active) {
      this.hide();
      this.el.hidden = true;
      this.stopRefresh();
      return;
    }
    this.el.hidden = true;
    const rect = this.stage.getBoundingClientRect();
    const centerPoint = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    const last = this.pointer;
    const inside =
      last.x >= rect.left && last.x <= rect.right && last.y >= rect.top && last.y <= rect.bottom;
    this.pointer = inside ? last : centerPoint;
    this.copyTheme();
    this.refresh();
    this.startRefresh();
    this.show();
  }

  syncCamera(): void {
    if (!this.active || !this.cameraClone) return;
    this.updateCamera();
    this.updateSurface();
    this.updateBackground();
    this.updateTransform();
  }

  refresh(): void {
    if (!this.active) return;
    this.copyTheme();
    this.rebuild();
    this.updateTransform();
  }

  destroy(): void {
    this.stopRefresh();
    this.el.remove();
    window.removeEventListener("pointermove", this.onPointerMove, true);
    window.removeEventListener("blur", this.onWindowBlur);
  }

  private readonly onWindowBlur = (): void => {
    if (this.active) this.hide();
  };

  private show(): void {
    const rect = this.stage.getBoundingClientRect();
    const half = LENS_SIZE / 2;
    const center = {
      x: Math.min(Math.max(this.pointer.x, rect.left + half), rect.right - half),
      y: Math.min(Math.max(this.pointer.y, rect.top + half), rect.bottom - half),
    };
    if (!Number.isFinite(center.x) || !Number.isFinite(center.y)) return;
    this.center = center;
    this.visible = true;
    this.el.hidden = false;
    this.el.style.left = `${center.x}px`;
    this.el.style.top = `${center.y}px`;
    this.updateTransform();
  }

  private hide(): void {
    this.visible = false;
    this.el.hidden = true;
  }

  private startRefresh(): void {
    this.stopRefresh();
    this.refreshTimer = window.setInterval(() => {
      if (this.active && this.visible) this.refresh();
    }, 450);
  }

  private stopRefresh(): void {
    if (this.refreshTimer !== null) {
      window.clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  private copyTheme(): void {
    const computed = getComputedStyle(this.root);
    for (let index = 0; index < computed.length; index++) {
      const name = computed[index];
      if (!name.startsWith("--cb")) continue;
      this.el.style.setProperty(name, computed.getPropertyValue(name).trim());
    }
    for (const key of ["theme", "pin", "ui"]) {
      const value = this.root.dataset[key];
      if (value) this.el.dataset[key] = value;
    }
    this.el.style.fontFamily = computed.fontFamily;
  }

  private rebuild(): void {
    this.cameraClone?.remove();
    this.surfaceClone?.remove();
    this.backgroundClone?.remove();

    const clone = this.cameraEl.cloneNode(true) as HTMLElement;
    clone.classList.add("cb-loupe-camera");
    clone.querySelectorAll(".is-selected").forEach((element) => {
      element.classList.remove("is-selected", "is-single");
    });
    this.cameraClone = clone;

    const surface = document.createElement("div");
    surface.className = "cb-surface cb-loupe-surface";
    this.surfaceClone = surface;

    const liveBackground = this.stage.querySelector<HTMLElement>(".cb-board-image");
    this.backgroundClone = liveBackground?.cloneNode(true) as HTMLElement | null;
    if (this.backgroundClone) this.backgroundClone.classList.add("cb-loupe-background");

    if (this.backgroundClone) this.host.appendChild(this.backgroundClone);
    this.host.appendChild(surface);
    this.host.appendChild(clone);

    this.updateCamera();
    this.updateSurface();
    this.updateBackground();
  }

  private updateCamera(): void {
    if (!this.cameraClone) return;
    const rect = this.stage.getBoundingClientRect();
    const camera = this.camera.value;
    this.cameraClone.style.transform = `translate3d(${rect.left + camera.x}px, ${
      rect.top + camera.y
    }px, 0) scale(${camera.zoom})`;
  }

  private updateSurface(): void {
    if (!this.surfaceClone) return;
    const rect = this.stage.getBoundingClientRect();
    Object.assign(this.surfaceClone.style, {
      position: "absolute",
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      right: "auto",
      bottom: "auto",
      width: `${rect.width}px`,
      height: `${rect.height}px`,
      backgroundPosition: this.surfaceEl.style.backgroundPosition,
      backgroundSize: this.surfaceEl.style.backgroundSize,
    });
  }

  private updateBackground(): void {
    if (!this.backgroundClone) return;
    const rect = this.stage.getBoundingClientRect();
    Object.assign(this.backgroundClone.style, {
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      right: "auto",
      bottom: "auto",
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    });
  }

  private updateScaleLabel(): void {
    this.scale.textContent = `${this.lensZoom.toFixed(1)}×`;
  }

  private updateTransform(): void {
    if (!this.active || !this.visible) return;
    const offsetX = this.pointer.x - this.center.x + LENS_SIZE / 2;
    const offsetY = this.pointer.y - this.center.y + LENS_SIZE / 2;
    this.host.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${this.lensZoom}) translate(${-this.pointer.x}px, ${-this.pointer.y}px)`;
  }
}
