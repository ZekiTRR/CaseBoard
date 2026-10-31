import type {
  BoardDoc,
  BoardNode,
  ImageBoardNode,
  NoteBoardNode,
  Vec2,
} from "../core/types";
import { nodesBounds } from "../util/math";
import { NodeView, type NodeViewHost } from "./NodeView";
import { ConnectionRenderer } from "./ConnectionRenderer";
import { PhysicsEngine } from "../physics/PhysicsEngine";
import type { FileInfoService } from "../core/FileInfoService";

export interface BoardRendererOptions {
  camera: HTMLElement;
  nodes: HTMLElement;
  threads: SVGSVGElement;
  overlay: HTMLElement;
  getBoard: () => BoardDoc | null;
  fileInfo: FileInfoService;
  nodeHost: NodeViewHost;
}

export class BoardRenderer {
  private readonly nodeViews = new Map<string, NodeView>();
  private readonly connections: ConnectionRenderer;
  private readonly physics: PhysicsEngine;
  private readonly groupFrame: HTMLElement;
  private readonly connectionIndex = new Map<string, Set<string>>();
  private readonly knownConnections = new Set<string>();
  private readonly dirtyNodes = new Set<string>();
  private readonly selectedNodeIds = new Set<string>();
  private frame: number | null = null;
  private destroyed = false;
  private threadSourceId: string | null = null;

  constructor(private readonly options: BoardRendererOptions) {
    this.physics = new PhysicsEngine(() => this.options.getBoard());
    this.connections = new ConnectionRenderer(options.threads);
    this.groupFrame = options.overlay.createDiv({ cls: "cb-group-frame" });
    this.groupFrame.toggleAttribute("hidden", true);
  }

  setBoard(board: BoardDoc): void {
    this.cancelFrame();
    this.physics.reset();
    this.connections.clear();
    this.knownConnections.clear();
    this.connectionIndex.clear();
    this.dirtyNodes.clear();
    this.options.nodes.empty();
    for (const view of this.nodeViews.values()) view.element.remove();
    this.nodeViews.clear();
    this.connections.hidePreview();
    this.threadSourceId = null;

    const sorted = [...board.nodes].sort((a, b) => a.z - b.z);
    for (const node of sorted) this.createNode(node);
    this.rebuildConnectionIndex(board);
    this.connections.sync(board);
    for (const connection of board.connections) this.knownConnections.add(connection.id);
    this.physics.markAllDirty();
    this.physics.update(performance.now());
    for (const connection of board.connections) {
      this.connections.render(connection, this.physics.getGeometry(connection.id));
    }
    this.applyPins(board.settings.showPins);
    this.requestFrame();
  }

  clear(): void {
    this.cancelFrame();
    this.physics.reset();
    this.connections.clear();
    this.knownConnections.clear();
    this.connectionIndex.clear();
    this.dirtyNodes.clear();
    this.options.nodes.empty();
    for (const view of this.nodeViews.values()) view.element.remove();
    this.nodeViews.clear();
    this.groupFrame.toggleAttribute("hidden", true);
  }

  addNode(node: BoardNode): void {
    this.createNode(node);
  }

  removeNode(nodeId: string): void {
    const view = this.nodeViews.get(nodeId);
    if (view) {
      view.element.remove();
      this.nodeViews.delete(nodeId);
    }
    this.dirtyNodes.delete(nodeId);
    this.selectedNodeIds.delete(nodeId);
  }

  refreshNode(nodeId: string, reloadContent = false): void {
    const board = this.options.getBoard();
    const node = board?.nodes.find((item) => item.id === nodeId);
    const view = this.nodeViews.get(nodeId);
    if (!node || !view) return;
    view.updateFromNode(node);
    if (reloadContent) this.refreshNodeContent(nodeId);
  }

  refreshNodeContent(nodeId: string): void {
    const board = this.options.getBoard();
    const node = board?.nodes.find((item) => item.id === nodeId);
    const view = this.nodeViews.get(nodeId);
    if (!node || !view) return;
    if (node.type === "note") {
      void this.loadNoteContent(node, view);
    } else if (node.type === "image") {
      this.loadImageContent(node, view);
    }
  }

  markNodesMoved(ids: Iterable<string>): void {
    const list = [...ids];
    for (const id of list) {
      if (this.nodeViews.has(id)) {
        this.dirtyNodes.add(id);
      }
    }
    const affected = this.connectionIdsForNodes(list);
    if (affected.size > 0) {
      this.physics.markDirty(affected);
      this.physics.wakeAnimation();
    }
    this.requestFrame();
  }

  markNodeGeometryChanged(nodeId: string): void {
    this.markNodesMoved([nodeId]);
  }

  refreshConnection(connectionId: string): void {
    const board = this.options.getBoard();
    const connection = board?.connections.find((item) => item.id === connectionId);
    if (!connection) return;
    this.connections.update(connection);
    this.physics.markDirty([connectionId]);
    this.physics.wakeAnimation();
    this.requestFrame();
  }

  syncConnections(): void {
    const board = this.options.getBoard();
    if (!board) return;
    const previousKnown = new Set(this.knownConnections);
    const ids = new Set(board.connections.map((connection) => connection.id));
    for (const known of [...this.knownConnections]) {
      if (!ids.has(known)) {
        this.physics.remove(known);
        this.knownConnections.delete(known);
      }
    }
    this.connections.sync(board);
    this.knownConnections.clear();
    const fresh: string[] = [];
    for (const connection of board.connections) {
      this.knownConnections.add(connection.id);
      if (!previousKnown.has(connection.id)) fresh.push(connection.id);
    }
    this.rebuildConnectionIndex(board);
    if (fresh.length > 0) this.physics.markDirty(fresh);
    this.physics.wakeAnimation();
    this.requestFrame();
  }

  refreshSelection(nodeIds: Set<string>, connectionId: string | null): void {
    this.selectedNodeIds.clear();
    for (const id of nodeIds) this.selectedNodeIds.add(id);
    const single = nodeIds.size === 1;
    for (const [id, view] of this.nodeViews) {
      view.setSelected(nodeIds.has(id), single);
    }
    this.connections.setSelected(connectionId);
    this.updateGroupFrame();
  }

  setThreadSource(nodeId: string | null): void {
    if (this.threadSourceId && this.threadSourceId !== nodeId) {
      this.nodeViews.get(this.threadSourceId)?.element.classList.remove("is-thread-source");
    }
    this.threadSourceId = nodeId;
    if (nodeId) this.nodeViews.get(nodeId)?.element.classList.add("is-thread-source");
  }

  refreshPins(visible: boolean): void {
    this.applyPins(visible);
  }

  refreshFile(path: string): void {
    this.options.fileInfo.invalidate(path);
    const board = this.options.getBoard();
    if (!board) return;
    for (const node of board.nodes) {
      if ((node.type === "note" || node.type === "image") && node.file !== path) continue;
      const view = this.nodeViews.get(node.id);
      if (!view) continue;
      if (node.type === "note") void this.loadNoteContent(node, view);
      else if (node.type === "image") this.loadImageContent(node, view);
    }
  }

  refreshAllContent(): void {
    this.options.fileInfo.invalidateAll();
    const board = this.options.getBoard();
    if (!board) return;
    for (const node of board.nodes) {
      const view = this.nodeViews.get(node.id);
      if (!view) continue;
      if (node.type === "note") void this.loadNoteContent(node, view);
      else if (node.type === "image") this.loadImageContent(node, view);
    }
  }

  showConnectionPreview(from: Vec2, to: Vec2): void {
    this.connections.showPreview(from, to);
  }

  hideConnectionPreview(): void {
    this.connections.hidePreview();
  }

  wakeAnimation(): void {
    this.physics.wakeAnimation();
    this.requestFrame();
  }

  getNodeElement(nodeId: string): HTMLElement | null {
    return this.nodeViews.get(nodeId)?.element ?? null;
  }

  getNodeView(nodeId: string): NodeView | null {
    return this.nodeViews.get(nodeId) ?? null;
  }

  getAnyEditingNode(): NodeView | null {
    for (const view of this.nodeViews.values()) {
      if (view.isEditing) return view;
    }
    return null;
  }

  destroy(): void {
    this.destroyed = true;
    this.cancelFrame();
    this.physics.reset();
    this.connections.clear();
    this.nodeViews.clear();
  }

  private createNode(node: BoardNode): void {
    const view = new NodeView(node, this.options.nodeHost);
    view.setPinsVisible(this.options.getBoard()?.settings.showPins ?? true);
    this.nodeViews.set(node.id, view);
    this.options.nodes.appendChild(view.element);
    if (node.type === "note") {
      const cached = this.options.fileInfo.getNoteMeta(node.file);
      if (cached) view.updateNotePreview(node, cached);
      else void this.loadNoteContent(node, view);
    } else if (node.type === "image") {
      this.loadImageContent(node, view);
    }
  }

  private async loadNoteContent(node: NoteBoardNode, view: NodeView): Promise<void> {
    const meta = await this.options.fileInfo.loadNoteMeta(node.file);
    const currentView = this.nodeViews.get(node.id);
    if (!currentView || currentView !== view) return;
    const current = this.options
      .getBoard()
      ?.nodes.find((item) => item.id === node.id);
    if (!current || current.type !== "note" || current.file !== node.file) return;
    currentView.updateNotePreview(current, meta);
  }

  private loadImageContent(node: ImageBoardNode, view: NodeView): void {
    const info = this.options.fileInfo.getImageInfo(node.file);
    view.updateImage(info.src, info.missing);
    view.updateFromNode(node);
  }

  private applyPins(visible: boolean): void {
    for (const view of this.nodeViews.values()) view.setPinsVisible(visible);
  }

  private rebuildConnectionIndex(board: BoardDoc): void {
    this.connectionIndex.clear();
    for (const connection of board.connections) {
      addIndex(this.connectionIndex, connection.from.nodeId, connection.id);
      addIndex(this.connectionIndex, connection.to.nodeId, connection.id);
    }
  }

  private connectionIdsForNodes(nodeIds: string[]): Set<string> {
    const result = new Set<string>();
    for (const nodeId of nodeIds) {
      const ids = this.connectionIndex.get(nodeId);
      if (ids) for (const id of ids) result.add(id);
    }
    return result;
  }

  private updateGroupFrame(): void {
    const board = this.options.getBoard();
    if (!board || this.selectedNodeIds.size < 2) {
      this.groupFrame.toggleAttribute("hidden", true);
      return;
    }
    const nodes = board.nodes.filter((node) => this.selectedNodeIds.has(node.id));
    const bounds = nodesBounds(nodes);
    if (!bounds) {
      this.groupFrame.toggleAttribute("hidden", true);
      return;
    }
    this.groupFrame.removeAttribute("hidden");
    this.groupFrame.style.left = `${bounds.x - 14}px`;
    this.groupFrame.style.top = `${bounds.y - 14}px`;
    this.groupFrame.style.width = `${bounds.width + 28}px`;
    this.groupFrame.style.height = `${bounds.height + 28}px`;
  }

  private requestFrame(): void {
    if (this.destroyed || this.frame !== null) return;
    this.frame = window.requestAnimationFrame((now) => {
      this.frame = null;
      this.tick(now);
    });
  }

  private cancelFrame(): void {
    if (this.frame !== null) {
      cancelAnimationFrame(this.frame);
      this.frame = null;
    }
  }

  private tick(now: number): void {
    if (this.destroyed) return;
    if (this.dirtyNodes.size > 0) {
      for (const id of this.dirtyNodes) this.nodeViews.get(id)?.applyTransform();
      this.dirtyNodes.clear();
      this.updateGroupFrame();
    }

    const changed = this.physics.update(now);
    if (changed.size > 0) {
      const board = this.options.getBoard();
      if (board) {
        const map = new Map(board.connections.map((connection) => [connection.id, connection]));
        for (const id of changed) {
          const connection = map.get(id);
          if (connection) this.connections.render(connection, this.physics.getGeometry(id));
        }
      }
    }

    if (this.dirtyNodes.size > 0 || this.physics.hasActivity(now)) {
      this.requestFrame();
    }
  }
}

function addIndex(index: Map<string, Set<string>>, nodeId: string, connectionId: string): void {
  let set = index.get(nodeId);
  if (!set) {
    set = new Set();
    index.set(nodeId, set);
  }
  set.add(connectionId);
}
