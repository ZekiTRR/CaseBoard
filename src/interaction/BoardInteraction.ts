import type { BoardDoc, BoardTool, TapePlacement, Vec2 } from "../core/types";
import { DEFAULT_NODE_SIZES } from "../core/types";
import type { CameraManager } from "../core/CameraManager";
import type { BoardRenderer } from "../render/BoardRenderer";
import { resolveAnchor } from "../render/anchors";
import { createConnection, getNode, touch } from "../core/BoardModel";
import { clampTape, ensureTapes, tapeWorldCenter, usesTape } from "../core/tape";
import {
  clamp,
  degToRad,
  nodeBounds,
  normalizeDeg,
  radToDeg,
  rectFromPoints,
  rectsIntersect,
  rotateVec,
} from "../util/math";

export interface InteractionSelection {
  nodes: Set<string>;
  connection: string | null;
}

export interface InteractionHost {
  getBoard(): BoardDoc;
  getCamera(): CameraManager;
  getRenderer(): BoardRenderer;
  getTool(): BoardTool;
  getSelection(): InteractionSelection;
  setSelection(nodeIds: Iterable<string>, connection: string | null): void;
  getDefaultThreadColor(): string;
  beginHistory(label: string): void;
  commitHistory(label?: string): void;
  cancelHistory(): void;
  onBoardChanged(): void;
  openNode(nodeId: string): void;
  createTextCard(point: Vec2): void;
  connectionCreated(connectionId: string): void;
  onNodeContextMenu(nodeId: string, event: MouseEvent): void;
  onConnectionContextMenu(connectionId: string, event: MouseEvent): void;
  onBoardContextMenu(point: Vec2, event: MouseEvent): void;
  onPendingThreadChange(pending: boolean): void;
  createTapeStrip(start: Vec2, end: Vec2): void;
  getTapeToolColor(): string;
  adjustLoupeZoom(factor: number): boolean;
}

type ActiveOperation =
  | {
      kind: "pan";
      lastX: number;
      lastY: number;
    }
  | {
      kind: "marquee";
      startWorld: Vec2;
      startScreen: Vec2;
      base: Set<string>;
      additive: boolean;
      moved: boolean;
    }
  | {
      kind: "nodes";
      primaryId: string;
      pointerId: number;
      startClient: Vec2;
      startWorld: Vec2;
      positions: Map<string, Vec2>;
      startWidth: number;
      startHeight: number;
      moved: boolean;
    }
  | {
      kind: "resize";
      nodeId: string;
      pointerId: number;
      signX: number;
      signY: number;
      fixedWorld: Vec2;
      rotation: number;
      startWidth: number;
      startHeight: number;
      startX: number;
      startY: number;
      moved: boolean;
    }
  | {
      kind: "rotate";
      nodeId: string;
      pointerId: number;
      center: Vec2;
      startAngle: number;
      startRotation: number;
      moved: boolean;
    }
  | {
      kind: "tape";
      nodeId: string;
      index: number;
      mode: "move" | "rotate";
      pointerId: number;
      startWorld: Vec2;
      center: Vec2;
      startX: number;
      startY: number;
      startAngle: number;
      startPointerAngle: number;
      previousTapes: TapePlacement[] | null;
      moved: boolean;
    }
  | {
      kind: "tape-create";
      pointerId: number;
      startWorld: Vec2;
      startScreen: Vec2;
      previewEl: HTMLElement;
      moved: boolean;
    }
  | null;

export class BoardInteraction {
  private active: ActiveOperation = null;
  private spaceHeld = false;
  private pendingThreadNodeId: string | null = null;
  private marqueeEl: HTMLElement | null = null;
  private destroyed = false;

  constructor(
    private readonly stage: HTMLElement,
    private readonly host: InteractionHost,
  ) {
    stage.addEventListener("pointerdown", this.onPointerDown);
    stage.addEventListener("pointermove", this.onHoverMove);
    stage.addEventListener("wheel", this.onWheel, { passive: false });
    stage.addEventListener("dblclick", this.onDoubleClick);
    stage.addEventListener("contextmenu", this.onContextMenu);
    stage.addEventListener("pointerleave", this.onPointerLeave);
    window.addEventListener("pointermove", this.onPointerMove);
    window.addEventListener("pointerup", this.onPointerUp);
    window.addEventListener("pointercancel", this.onPointerCancel);
    window.addEventListener("blur", this.onWindowBlur);
    stage.addEventListener("dragstart", this.onDragStart);
  }

  destroy(): void {
    this.destroyed = true;
    this.stage.removeEventListener("pointerdown", this.onPointerDown);
    this.stage.removeEventListener("pointermove", this.onHoverMove);
    this.stage.removeEventListener("wheel", this.onWheel);
    this.stage.removeEventListener("dblclick", this.onDoubleClick);
    this.stage.removeEventListener("contextmenu", this.onContextMenu);
    this.stage.removeEventListener("pointerleave", this.onPointerLeave);
    window.removeEventListener("pointermove", this.onPointerMove);
    window.removeEventListener("pointerup", this.onPointerUp);
    window.removeEventListener("pointercancel", this.onPointerCancel);
    window.removeEventListener("blur", this.onWindowBlur);
    this.stage.removeEventListener("dragstart", this.onDragStart);
    this.removeMarquee();
    if (this.active?.kind === "tape-create") this.active.previewEl.remove();
    this.active = null;
    this.resetThreadState();
  }

  setSpaceHeld(held: boolean): void {
    if (this.destroyed || this.spaceHeld === held) return;
    this.spaceHeld = held;
    this.stage.classList.toggle("is-space-pan", held);
  }

  handleToolChanged(): void {
    if (this.host.getTool() !== "thread") this.resetThreadState();
  }

  startThreadFrom(nodeId: string): void {
    const node = getNode(this.host.getBoard(), nodeId);
    if (!node) return;
    this.beginThread(nodeId);
    this.host.getRenderer().hideConnectionPreview();
  }

  cancelPending(): void {
    this.resetThreadState();
  }

  cancelActive(): void {
    if (!this.active || this.active.kind === "pan") {
      this.active = null;
      this.endPointerClasses();
      return;
    }
    const operation = this.active;
    const renderer = this.host.getRenderer();
    const board = this.host.getBoard();
    if (operation.kind === "nodes") {
      const ids: string[] = [];
      for (const [id, position] of operation.positions) {
        const node = getNode(board, id);
        if (!node) continue;
        node.x = position.x;
        node.y = position.y;
        ids.push(id);
      }
      renderer.markNodesMoved(ids);
      this.host.cancelHistory();
    } else if (operation.kind === "resize") {
      const node = getNode(board, operation.nodeId);
      if (node) {
        node.width = operation.startWidth;
        node.height = operation.startHeight;
        node.x = operation.startX;
        node.y = operation.startY;
        renderer.markNodeGeometryChanged(node.id);
        renderer.getNodeView(node.id)?.setSizeBadge(null);
      }
      this.host.cancelHistory();
    } else if (operation.kind === "rotate") {
      const node = getNode(board, operation.nodeId);
      if (node) {
        node.rotation = normalizeDeg(operation.startRotation);
        renderer.markNodeGeometryChanged(node.id);
        renderer.getNodeView(node.id)?.setSizeBadge(null);
      }
      this.host.cancelHistory();
    } else if (operation.kind === "tape") {
      const node = getNode(board, operation.nodeId);
      if (node) {
        node.tapes = operation.previousTapes ?? undefined;
        renderer.refreshNode(node.id);
        renderer.markNodeGeometryChanged(node.id);
      }
      this.host.cancelHistory();
    } else if (operation.kind === "tape-create") {
      operation.previewEl.remove();
    } else if (operation.kind === "marquee") {
      this.removeMarquee();
    }
    this.active = null;
    this.endPointerClasses();
  }

  private onPointerDown = (event: PointerEvent): void => {
    if (this.destroyed || event.button === 2) return;
    this.host.getCamera().cancelTween();
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    const editing = this.host.getRenderer().getAnyEditingNode();
    if (editing) {
      if (editing.element.contains(target)) return;
      editing.stopEditing();
    }

    if (event.button === 1 || (this.spaceHeld && event.button === 0)) {
      event.preventDefault();
      this.host.getCamera().cancelTween();
      this.active = { kind: "pan", lastX: event.clientX, lastY: event.clientY };
      this.endPointerClasses();
      this.stage.classList.add("is-panning");
      return;
    }

    if (event.button !== 0) return;
    if (target.closest(".cb-text-content[contenteditable='plaintext-only']")) return;

    const tool = this.host.getTool();
    const nodeId = this.nodeIdFromTarget(target);

    if (tool === "pan") {
      event.preventDefault();
      this.active = { kind: "pan", lastX: event.clientX, lastY: event.clientY };
      this.endPointerClasses();
      this.stage.classList.add("is-panning");
      return;
    }

    if (tool === "tape") {
      event.preventDefault();
      this.beginTapeCreate(event);
      return;
    }

    if (this.pendingThreadNodeId) {
      event.preventDefault();
      if (nodeId) {
        this.handleThreadClick(nodeId, event);
      } else {
        this.resetThreadState();
        this.host.setSelection([], null);
      }
      return;
    }

    if (tool === "thread") {
      event.preventDefault();
      if (nodeId) this.handleThreadClick(nodeId, event);
      else this.host.setSelection([], null);
      return;
    }

    const tapeStrip = target.closest<HTMLElement>(".cb-tape");
    if (tapeStrip && nodeId) {
      const index = Number(tapeStrip.dataset.tape ?? "0");
      const mode = target.closest("[data-tape-rotate]") ? "rotate" : "move";
      if (this.beginTapeOperation(nodeId, index, mode, event)) {
        event.preventDefault();
        return;
      }
    }

    const handle = target.closest<HTMLElement>("[data-handle]");
    if (handle && nodeId) {
      event.preventDefault();
      this.beginHandleOperation(nodeId, handle.dataset.handle ?? "", event);
      return;
    }

    // Play and waveform belong to the card's own controls, never to the drag.
    if (nodeId && target.closest("[data-audio-control]")) {
      this.host.setSelection([nodeId], null);
      return;
    }

    const thread = target.closest<SVGElement>(".cb-thread-hit");
    if (thread) {
      const connectionId = thread.dataset.connectionId;
      if (connectionId) {
        event.preventDefault();
        this.host.setSelection([], connectionId);
      }
      return;
    }

    if (nodeId) {
      event.preventDefault();
      this.beginNodeDrag(nodeId, event);
      return;
    }

    event.preventDefault();
    this.beginMarquee(event);
  };

  private onHoverMove = (event: PointerEvent): void => {
    if (this.active || !this.pendingThreadNodeId) return;
    const board = this.host.getBoard();
    const node = getNode(board, this.pendingThreadNodeId);
    if (!node) {
      this.resetThreadState();
      return;
    }
    const cursor = this.host.getCamera().screenToWorld(event.clientX, event.clientY);
    const anchor = resolveAnchor(node, board.settings.defaultAnchor, cursor);
    this.host.getRenderer().showConnectionPreview(anchor, cursor);
  };

  private onPointerMove = (event: PointerEvent): void => {
    if (this.destroyed || !this.active) return;
    const camera = this.host.getCamera();
    switch (this.active.kind) {
      case "pan": {
        const dx = event.clientX - this.active.lastX;
        const dy = event.clientY - this.active.lastY;
        this.active.lastX = event.clientX;
        this.active.lastY = event.clientY;
        camera.panBy(dx, dy);
        return;
      }
      case "marquee": {
        this.updateMarquee(this.active, event);
        return;
      }
      case "nodes": {
        this.updateNodeDrag(this.active, event);
        return;
      }
      case "resize": {
        this.updateResize(this.active, event);
        return;
      }
      case "rotate": {
        this.updateRotate(this.active, event);
        return;
      }
      case "tape": {
        this.updateTape(this.active, event);
        return;
      }
      case "tape-create": {
        this.updateTapePreview(this.active, event);
        return;
      }
      default:
        return;
    }
  };

  private onPointerUp = (event: PointerEvent): void => {
    if (!this.active) return;
    const operation = this.active;
    this.active = null;
    this.endPointerClasses();

    if (operation.kind === "pan") return;

    if (operation.kind === "tape-create") {
      operation.previewEl.remove();
      const end = operation.moved
        ? this.host.getCamera().screenToWorld(event.clientX, event.clientY)
        : operation.startWorld;
      this.host.createTapeStrip(operation.startWorld, end);
      return;
    }

    if (operation.kind === "marquee") {
      this.updateMarquee(operation, event);
      this.removeMarquee();
      return;
    }

    if (operation.kind === "nodes") {
      if (!operation.moved) {
        this.host.cancelHistory();
        return;
      }
      this.host.commitHistory("Move cards");
      this.host.onBoardChanged();
      this.host.getRenderer().wakeAnimation();
      return;
    }

    if (operation.kind === "tape") {
      if (!operation.moved) {
        this.host.cancelHistory();
        this.host.getRenderer().refreshNode(operation.nodeId);
        return;
      }
      this.host.commitHistory("Adjust tape");
      this.host.onBoardChanged();
      this.host.getRenderer().wakeAnimation();
      return;
    }

    if (operation.kind === "resize" || operation.kind === "rotate") {
      const view = this.host.getRenderer().getNodeView(operation.nodeId);
      view?.setSizeBadge(null);
      if (!operation.moved) {
        this.host.cancelHistory();
        return;
      }
      this.host.commitHistory(operation.kind === "resize" ? "Resize card" : "Rotate card");
      this.host.onBoardChanged();
      this.host.getRenderer().wakeAnimation();
    }
  };

  private onPointerCancel = (): void => {
    this.cancelActive();
  };

  private onWindowBlur = (): void => {
    this.cancelActive();
    this.setSpaceHeld(false);
  };

  private onPointerLeave = (): void => {
    if (this.pendingThreadNodeId && !this.active) {
      this.host.getRenderer().hideConnectionPreview();
    }
  };

  private onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    const camera = this.host.getCamera();
    let deltaX = event.deltaX;
    let deltaY = event.deltaY;
    if (event.deltaMode === 1) {
      deltaX *= 16;
      deltaY *= 16;
    } else if (event.deltaMode === 2) {
      deltaX *= 100;
      deltaY *= 100;
    }

    const factor = clamp(Math.exp(-deltaY * 0.0016), 0.5, 2);
    if (this.host.adjustLoupeZoom(factor)) return;

    if (event.ctrlKey || event.metaKey) {
      camera.zoomAtSmooth(factor, event.clientX, event.clientY);
      return;
    }

    if (event.shiftKey && Math.abs(deltaX) < 1) {
      camera.panBySmooth(-deltaY, 0);
      return;
    }
    camera.panBySmooth(-deltaX, -deltaY);
  };

  private onDoubleClick = (event: MouseEvent): void => {
    if (this.host.getTool() !== "select") return;
    const target = event.target instanceof Element ? event.target : null;
    if (!target || target.closest(".cb-text-content[contenteditable='plaintext-only']")) return;
    const nodeId = this.nodeIdFromTarget(target);
    if (nodeId) {
      const node = getNode(this.host.getBoard(), nodeId);
      if (!node) return;
      if (target.closest("[data-handle]")) return;
      this.host.setSelection([node.id], null);
      if (node.type === "text") {
        this.host.getRenderer().getNodeView(node.id)?.startEditing();
      } else if (node.type !== "tape") {
        this.host.openNode(node.id);
      }
      return;
    }
    if (target.closest(".cb-thread-hit") || target.closest(".cb-thread-dot")) return;
    const point = this.host.getCamera().screenToWorld(event.clientX, event.clientY);
    this.host.createTextCard(point);
  };

  private onContextMenu = (event: MouseEvent): void => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    if (target.closest(".cb-text-content[contenteditable='plaintext-only']")) return;
    event.preventDefault();
    if (this.pendingThreadNodeId) this.resetThreadState();

    const nodeId = this.nodeIdFromTarget(target);
    if (nodeId) {
      const selection = this.host.getSelection();
      if (!selection.nodes.has(nodeId)) this.host.setSelection([nodeId], null);
      this.host.onNodeContextMenu(nodeId, event);
      return;
    }

    const thread = target.closest<SVGElement>(".cb-thread-hit");
    if (thread?.dataset.connectionId) {
      this.host.setSelection([], thread.dataset.connectionId);
      this.host.onConnectionContextMenu(thread.dataset.connectionId, event);
      return;
    }

    const point = this.host.getCamera().screenToWorld(event.clientX, event.clientY);
    this.host.onBoardContextMenu(point, event);
  };

  private onDragStart = (event: DragEvent): void => {
    const target = event.target;
    if (target instanceof Element && target.closest(".cb-node")) {
      event.preventDefault();
    }
  };

  private beginNodeDrag(nodeId: string, event: PointerEvent): void {
    const board = this.host.getBoard();
    const node = getNode(board, nodeId);
    if (!node) return;
    const selection = this.host.getSelection();
    const additive = event.shiftKey || event.metaKey || event.ctrlKey;

    if (additive) {
      const next = new Set(selection.nodes);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      this.host.setSelection(next, null);
      if (!next.has(nodeId)) return;
    } else if (!selection.nodes.has(nodeId)) {
      this.host.setSelection([nodeId], null);
    }

    if (node.locked) return;
    const currentSelection = this.host.getSelection().nodes;
    const positions = new Map<string, Vec2>();
    for (const id of currentSelection) {
      const selected = getNode(board, id);
      if (!selected || selected.locked) continue;
      positions.set(id, { x: selected.x, y: selected.y });
    }
    if (!positions.has(nodeId)) return;

    this.host.beginHistory("Move cards");
    const startWorld = this.host.getCamera().screenToWorld(event.clientX, event.clientY);
    this.active = {
      kind: "nodes",
      primaryId: nodeId,
      pointerId: event.pointerId,
      startClient: { x: event.clientX, y: event.clientY },
      startWorld,
      positions,
      startWidth: node.width,
      startHeight: node.height,
      moved: false,
    };
    this.stage.classList.add("is-dragging");
  }

  private updateNodeDrag(
    operation: Extract<ActiveOperation, { kind: "nodes" }>,
    event: PointerEvent,
  ): void {
    const dxScreen = event.clientX - operation.startClient.x;
    const dyScreen = event.clientY - operation.startClient.y;
    if (!operation.moved && Math.hypot(dxScreen, dyScreen) < 3) return;
    operation.moved = true;

    const board = this.host.getBoard();
    const primary = getNode(board, operation.primaryId);
    if (!primary) return;
    const camera = this.host.getCamera();
    let dx = dxScreen / camera.zoom;
    let dy = dyScreen / camera.zoom;

    if (event.shiftKey) {
      if (Math.abs(dx) > Math.abs(dy)) dy = 0;
      else dx = 0;
    }

    if (board.settings.snapToGrid && board.settings.gridSize > 1) {
      const grid = board.settings.gridSize;
      const start = operation.positions.get(operation.primaryId);
      if (start) {
        const rawLeft = start.x + dx - operation.startWidth / 2;
        const rawTop = start.y + dy - operation.startHeight / 2;
        const snappedLeft = Math.round(rawLeft / grid) * grid;
        const snappedTop = Math.round(rawTop / grid) * grid;
        dx += snappedLeft - rawLeft;
        dy += snappedTop - rawTop;
      }
    }

    const moved: string[] = [];
    for (const [id, start] of operation.positions) {
      const node = getNode(board, id);
      if (!node) continue;
      node.x = start.x + dx;
      node.y = start.y + dy;
      moved.push(id);
    }
    this.host.getRenderer().markNodesMoved(moved);
  }

  private beginTapeOperation(
    nodeId: string,
    index: number,
    mode: "move" | "rotate",
    event: PointerEvent,
  ): boolean {
    const board = this.host.getBoard();
    const node = getNode(board, nodeId);
    if (!node || node.locked || !usesTape(node)) return false;
    const selection = this.host.getSelection();
    if (selection.nodes.size !== 1 || !selection.nodes.has(nodeId) || selection.connection) {
      this.host.setSelection([nodeId], null);
    }
    const previousTapes = node.tapes ? node.tapes.map((tape) => ({ ...tape })) : null;
    const tape = ensureTapes(node)[index];
    if (!tape) return false;
    const world = this.host.getCamera().screenToWorld(event.clientX, event.clientY);
    const center = tapeWorldCenter(node, tape);
    this.host.beginHistory("Adjust tape");
    this.active = {
      kind: "tape",
      nodeId,
      index,
      mode,
      pointerId: event.pointerId,
      startWorld: world,
      center,
      startX: tape.x,
      startY: tape.y,
      startAngle: tape.angle,
      startPointerAngle: Math.atan2(world.y - center.y, world.x - center.x),
      previousTapes,
      moved: false,
    };
    this.stage.classList.add("is-transforming");
    return true;
  }

  private updateTape(operation: Extract<ActiveOperation, { kind: "tape" }>, event: PointerEvent): void {
    const board = this.host.getBoard();
    const node = getNode(board, operation.nodeId);
    const tape = node?.tapes?.[operation.index];
    if (!node || !tape) return;
    const world = this.host.getCamera().screenToWorld(event.clientX, event.clientY);

    if (operation.mode === "move") {
      const dx = world.x - operation.startWorld.x;
      const dy = world.y - operation.startWorld.y;
      const local = rotateVec(dx, dy, -degToRad(node.rotation));
      tape.x = operation.startX + local.x / Math.max(1, node.width);
      tape.y = operation.startY + local.y / Math.max(1, node.height);
    } else {
      const current = Math.atan2(world.y - operation.center.y, world.x - operation.center.x);
      tape.angle = normalizeDeg(
        operation.startAngle + radToDeg(current - operation.startPointerAngle),
      );
    }
    clampTape(tape);
    operation.moved =
      operation.moved ||
      Math.hypot(world.x - operation.startWorld.x, world.y - operation.startWorld.y) > 0.5;
    const renderer = this.host.getRenderer();
    renderer.refreshNode(node.id);
    renderer.markNodeGeometryChanged(node.id);
  }

  private beginHandleOperation(nodeId: string, handle: string, event: PointerEvent): void {
    const selection = this.host.getSelection();
    if (selection.nodes.size !== 1 || !selection.nodes.has(nodeId) || selection.connection) return;
    const board = this.host.getBoard();
    const node = getNode(board, nodeId);
    if (!node || node.locked) return;

    if (handle === "rotate") {
      const world = this.host.getCamera().screenToWorld(event.clientX, event.clientY);
      const center = { x: node.x, y: node.y };
      const startAngle = Math.atan2(world.y - center.y, world.x - center.x);
      this.host.beginHistory("Rotate card");
      this.active = {
        kind: "rotate",
        nodeId,
        pointerId: event.pointerId,
        center,
        startAngle,
        startRotation: node.rotation,
        moved: false,
      };
      this.stage.classList.add("is-transforming");
      return;
    }

    const signX = handle.includes("e") ? 1 : -1;
    const signY = handle.includes("s") ? 1 : -1;
    const angle = degToRad(node.rotation);
    const offset = rotateVec((-signX * node.width) / 2, (-signY * node.height) / 2, angle);
    const fixedWorld = { x: node.x + offset.x, y: node.y + offset.y };
    this.host.beginHistory("Resize card");
    this.active = {
      kind: "resize",
      nodeId,
      pointerId: event.pointerId,
      signX,
      signY,
      fixedWorld,
      rotation: node.rotation,
      startWidth: node.width,
      startHeight: node.height,
      startX: node.x,
      startY: node.y,
      moved: false,
    };
    this.stage.classList.add("is-transforming");
  }

  private updateResize(
    operation: Extract<ActiveOperation, { kind: "resize" }>,
    event: PointerEvent,
  ): void {
    const board = this.host.getBoard();
    const node = getNode(board, operation.nodeId);
    if (!node) return;
    const world = this.host.getCamera().screenToWorld(event.clientX, event.clientY);
    const local = rotateVec(
      world.x - operation.fixedWorld.x,
      world.y - operation.fixedWorld.y,
      -degToRad(operation.rotation),
    );
    const isTape = node.type === "tape";
    const minWidth = isTape ? 24 : 90;
    const minHeight = isTape ? 8 : 60;
    const maxWidth = isTape ? 2400 : Number.POSITIVE_INFINITY;
    const maxHeight = isTape ? 160 : Number.POSITIVE_INFINITY;
    let width = Math.max(minWidth, operation.signX * local.x);
    let height = Math.max(minHeight, operation.signY * local.y);

    if (event.shiftKey) {
      const ratio = operation.startWidth / operation.startHeight;
      if (width / operation.startWidth >= height / operation.startHeight) {
        height = Math.max(minHeight, width / ratio);
      } else {
        width = Math.max(minWidth, height * ratio);
      }
    }
    width = Math.min(width, maxWidth);
    height = Math.min(height, maxHeight);

    const cos = Math.cos(degToRad(operation.rotation));
    const sin = Math.sin(degToRad(operation.rotation));
    const localCenterX = (operation.signX * width) / 2;
    const localCenterY = (operation.signY * height) / 2;
    node.width = width;
    node.height = height;
    node.x = operation.fixedWorld.x + localCenterX * cos - localCenterY * sin;
    node.y = operation.fixedWorld.y + localCenterX * sin + localCenterY * cos;
    operation.moved = true;
    this.host.getRenderer().markNodeGeometryChanged(node.id);
    this.host
      .getRenderer()
      .getNodeView(node.id)
      ?.setSizeBadge(`${Math.round(width)} × ${Math.round(height)}`);
  }

  private updateRotate(
    operation: Extract<ActiveOperation, { kind: "rotate" }>,
    event: PointerEvent,
  ): void {
    const board = this.host.getBoard();
    const node = getNode(board, operation.nodeId);
    if (!node) return;
    const world = this.host.getCamera().screenToWorld(event.clientX, event.clientY);
    const angle = Math.atan2(world.y - operation.center.y, world.x - operation.center.x);
    let rotation = normalizeDeg(operation.startRotation + radToDeg(angle - operation.startAngle));
    if (event.shiftKey) rotation = Math.round(rotation / 15) * 15;
    node.rotation = rotation;
    operation.moved = true;
    this.host.getRenderer().markNodeGeometryChanged(node.id);
    this.host.getRenderer().getNodeView(node.id)?.setSizeBadge(`${Math.round(rotation)}°`);
  }

  private beginMarquee(event: PointerEvent): void {
    const additive = event.shiftKey || event.metaKey || event.ctrlKey;
    if (!additive) this.host.setSelection([], null);
    const point = this.host.getCamera().screenToWorld(event.clientX, event.clientY);
    this.active = {
      kind: "marquee",
      startWorld: point,
      startScreen: { x: event.clientX, y: event.clientY },
      base: additive ? new Set(this.host.getSelection().nodes) : new Set(),
      additive,
      moved: false,
    };
    this.removeMarquee();
  }

  private updateMarquee(
    operation: Extract<ActiveOperation, { kind: "marquee" }>,
    event: PointerEvent,
  ): void {
    const dx = event.clientX - operation.startScreen.x;
    const dy = event.clientY - operation.startScreen.y;
    if (!operation.moved && Math.hypot(dx, dy) < 4) return;
    operation.moved = true;
    const rect = this.stage.getBoundingClientRect();
    if (!this.marqueeEl) {
      this.marqueeEl = createDiv({ cls: "cb-marquee" });
      this.stage.appendChild(this.marqueeEl);
    }
    this.marqueeEl.style.left = `${Math.min(event.clientX, operation.startScreen.x) - rect.left}px`;
    this.marqueeEl.style.top = `${Math.min(event.clientY, operation.startScreen.y) - rect.top}px`;
    this.marqueeEl.style.width = `${Math.abs(dx)}px`;
    this.marqueeEl.style.height = `${Math.abs(dy)}px`;

    const endWorld = this.host.getCamera().screenToWorld(event.clientX, event.clientY);
    const worldRect = rectFromPoints(operation.startWorld, endWorld);
    const matched = new Set<string>(operation.base);
    for (const node of this.host.getBoard().nodes) {
      if (rectsIntersect(nodeBounds(node), worldRect)) matched.add(node.id);
    }
    const previous = this.host.getSelection().nodes;
    if (!setsEqual(previous, matched)) this.host.setSelection(matched, null);
  }

  private removeMarquee(): void {
    this.marqueeEl?.remove();
    this.marqueeEl = null;
  }

  private beginThread(nodeId: string): void {
    const board = this.host.getBoard();
    const node = getNode(board, nodeId);
    if (!node) return;
    this.pendingThreadNodeId = nodeId;
    this.host.getRenderer().setThreadSource(nodeId);
    this.host.setSelection([], null);
    this.host.onPendingThreadChange(true);
  }

  private handleThreadClick(nodeId: string, event: PointerEvent): void {
    const board = this.host.getBoard();
    const node = getNode(board, nodeId);
    if (!node) return;
    if (!this.pendingThreadNodeId) {
      this.beginThread(nodeId);
      const cursor = this.host.getCamera().screenToWorld(event.clientX, event.clientY);
      const anchor = resolveAnchor(node, board.settings.defaultAnchor, cursor);
      this.host.getRenderer().showConnectionPreview(anchor, cursor);
      return;
    }
    if (this.pendingThreadNodeId === nodeId) {
      this.resetThreadState();
      return;
    }
    const from = getNode(board, this.pendingThreadNodeId);
    if (!from) {
      this.resetThreadState();
      return;
    }

    this.host.beginHistory("Create thread");
    const connection = createConnection(from, node, {
      color: this.host.getDefaultThreadColor(),
      physics: board.settings.defaultThreadMode,
      anchor: board.settings.defaultAnchor,
      autoTension: board.settings.autoTension,
    });
    board.connections.push(connection);
    touch(board);
    this.resetThreadState();
    this.host.commitHistory("Create thread");
    this.host.getRenderer().syncConnections();
    this.host.connectionCreated(connection.id);
    this.host.onBoardChanged();
  }

  private resetThreadState(): void {
    const hadPending = this.pendingThreadNodeId !== null;
    if (hadPending) {
      this.host.getRenderer().setThreadSource(null);
      this.pendingThreadNodeId = null;
    }
    this.host.getRenderer().hideConnectionPreview();
    if (hadPending) this.host.onPendingThreadChange(false);
  }

  private beginTapeCreate(event: PointerEvent): void {
    const rect = this.stage.getBoundingClientRect();
    const startScreen = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const previewEl = this.stage.createDiv({ cls: "cb-tape-preview" });
    previewEl.style.backgroundColor = this.host.getTapeToolColor();
    previewEl.toggleAttribute("hidden", true);
    this.active = {
      kind: "tape-create",
      pointerId: event.pointerId,
      startWorld: this.host.getCamera().screenToWorld(event.clientX, event.clientY),
      startScreen,
      previewEl,
      moved: false,
    };
    this.stage.classList.add("is-tape-drawing");
  }

  private updateTapePreview(
    operation: Extract<ActiveOperation, { kind: "tape-create" }>,
    event: PointerEvent,
  ): void {
    const rect = this.stage.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const dx = x - operation.startScreen.x;
    const dy = y - operation.startScreen.y;
    const distance = Math.hypot(dx, dy);
    if (distance < 4) {
      operation.moved = false;
      operation.previewEl.toggleAttribute("hidden", true);
      return;
    }
    operation.moved = true;
    operation.previewEl.removeAttribute("hidden");
    const thickness = Math.max(
      8,
      DEFAULT_NODE_SIZES.tape.height * this.host.getCamera().zoom,
    );
    Object.assign(operation.previewEl.style, {
      left: `${operation.startScreen.x}px`,
      top: `${operation.startScreen.y - thickness / 2}px`,
      width: `${distance}px`,
      height: `${thickness}px`,
      transform: `rotate(${radToDeg(Math.atan2(dy, dx))}deg)`,
    });
  }

  private nodeIdFromTarget(target: Element): string | null {
    const nodeEl = target.closest<HTMLElement>(".cb-node");
    if (!nodeEl) return null;
    const id = nodeEl.dataset.id;
    return id && getNode(this.host.getBoard(), id) ? id : null;
  }

  private endPointerClasses(): void {
    this.stage.classList.remove(
      "is-panning",
      "is-dragging",
      "is-transforming",
      "is-tape-drawing",
    );
  }
}

function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const value of a) if (!b.has(value)) return false;
  return true;
}
