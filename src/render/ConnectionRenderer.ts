import type { BoardConnection, BoardDoc, ConnectionGeometry, Vec2 } from "../core/types";

const SVG_NS = "http://www.w3.org/2000/svg";

interface ThreadElements {
  group: SVGGElement;
  shadow: SVGPathElement;
  main: SVGPathElement;
  hit: SVGPathElement;
  fromDot: SVGCircleElement;
  toDot: SVGCircleElement;
  pathData: string;
  connection: BoardConnection;
}

export class ConnectionRenderer {
  private readonly threads = new Map<string, ThreadElements>();
  private selectedId: string | null = null;
  private previewPath: SVGPathElement;
  private previewFrom: SVGCircleElement;
  private previewTo: SVGCircleElement;

  constructor(private readonly svg: SVGSVGElement) {
    const preview = document.createElementNS(SVG_NS, "g");
    preview.setAttribute("class", "cb-thread-preview");
    this.previewPath = document.createElementNS(SVG_NS, "path");
    this.previewPath.setAttribute("class", "cb-thread-preview-path");
    this.previewFrom = document.createElementNS(SVG_NS, "circle");
    this.previewFrom.setAttribute("class", "cb-thread-preview-dot");
    this.previewFrom.setAttribute("r", "3.4");
    this.previewTo = document.createElementNS(SVG_NS, "circle");
    this.previewTo.setAttribute("class", "cb-thread-preview-dot");
    this.previewTo.setAttribute("r", "3.4");
    preview.append(this.previewPath, this.previewFrom, this.previewTo);
    svg.appendChild(preview);
    this.hidePreview();
  }

  sync(board: BoardDoc): void {
    const ids = new Set(board.connections.map((connection) => connection.id));
    for (const id of [...this.threads.keys()]) {
      if (!ids.has(id)) this.remove(id);
    }
    for (const connection of board.connections) {
      let thread = this.threads.get(connection.id);
      if (!thread) {
        thread = this.createThread(connection);
        this.threads.set(connection.id, thread);
      }
      thread.connection = connection;
      this.styleThread(thread, connection);
    }
    if (this.selectedId && !ids.has(this.selectedId)) this.selectedId = null;
  }

  update(connection: BoardConnection): void {
    let thread = this.threads.get(connection.id);
    if (!thread) {
      thread = this.createThread(connection);
      this.threads.set(connection.id, thread);
    }
    thread.connection = connection;
    this.styleThread(thread, connection);
  }

  render(connection: BoardConnection, geometry: ConnectionGeometry | null): void {
    const thread = this.threads.get(connection.id);
    if (!thread || !geometry) return;
    const path = buildPath(geometry.points);
    if (path !== thread.pathData) {
      thread.pathData = path;
      thread.shadow.setAttribute("d", path);
      thread.main.setAttribute("d", path);
      thread.hit.setAttribute("d", path);
    }
    setCircle(thread.fromDot, geometry.start);
    setCircle(thread.toDot, geometry.end);
  }

  setSelected(id: string | null): void {
    if (this.selectedId === id) return;
    if (this.selectedId) this.threads.get(this.selectedId)?.group.classList.remove("is-selected");
    this.selectedId = id;
    if (id) this.threads.get(id)?.group.classList.add("is-selected");
  }

  getSelected(): string | null {
    return this.selectedId;
  }

  remove(id: string): void {
    const thread = this.threads.get(id);
    if (!thread) return;
    thread.group.remove();
    this.threads.delete(id);
    if (this.selectedId === id) this.selectedId = null;
  }

  clear(): void {
    for (const thread of this.threads.values()) thread.group.remove();
    this.threads.clear();
    this.selectedId = null;
  }

  showPreview(start: Vec2, end: Vec2): void {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.hypot(dx, dy);
    const sag = Math.min(30, length * 0.04);
    const midX = (start.x + end.x) / 2;
    const midY = (start.y + end.y) / 2 + sag * 2;
    this.previewPath.setAttribute(
      "d",
      `M ${fmt(start.x)} ${fmt(start.y)} Q ${fmt(midX)} ${fmt(midY)} ${fmt(end.x)} ${fmt(end.y)}`,
    );
    setCircle(this.previewFrom, start);
    setCircle(this.previewTo, end);
    this.previewPath.removeAttribute("hidden");
    this.previewFrom.removeAttribute("hidden");
    this.previewTo.removeAttribute("hidden");
  }

  hidePreview(): void {
    this.previewPath.setAttribute("hidden", "true");
    this.previewFrom.setAttribute("hidden", "true");
    this.previewTo.setAttribute("hidden", "true");
  }

  private createThread(connection: BoardConnection): ThreadElements {
    const group = document.createElementNS(SVG_NS, "g");
    group.setAttribute("class", "cb-thread");
    group.dataset.id = connection.id;

    const shadow = document.createElementNS(SVG_NS, "path");
    shadow.setAttribute("class", "cb-thread-shadow");
    shadow.setAttribute("fill", "none");
    shadow.setAttribute("stroke-linecap", "round");
    shadow.setAttribute("stroke-linejoin", "round");
    shadow.setAttribute("vector-effect", "non-scaling-stroke");
    shadow.setAttribute("transform", "translate(1.2 2.2)");

    const main = document.createElementNS(SVG_NS, "path");
    main.setAttribute("class", "cb-thread-main");
    main.setAttribute("fill", "none");
    main.setAttribute("stroke-linecap", "round");
    main.setAttribute("stroke-linejoin", "round");
    main.setAttribute("vector-effect", "non-scaling-stroke");

    const hit = document.createElementNS(SVG_NS, "path");
    hit.setAttribute("class", "cb-thread-hit");
    hit.setAttribute("fill", "none");
    hit.setAttribute("pointer-events", "stroke");
    hit.setAttribute("vector-effect", "non-scaling-stroke");
    hit.dataset.connectionId = connection.id;

    const fromDot = document.createElementNS(SVG_NS, "circle");
    fromDot.setAttribute("class", "cb-thread-dot");
    fromDot.setAttribute("r", "3.2");
    const toDot = document.createElementNS(SVG_NS, "circle");
    toDot.setAttribute("class", "cb-thread-dot");
    toDot.setAttribute("r", "3.2");

    group.append(shadow, main, hit, fromDot, toDot);
    this.svg.insertBefore(group, this.svg.firstChild);
    return {
      group,
      shadow,
      main,
      hit,
      fromDot,
      toDot,
      pathData: "",
      connection,
    };
  }

  private styleThread(thread: ThreadElements, connection: BoardConnection): void {
    thread.main.setAttribute("stroke", connection.color);
    thread.main.setAttribute("stroke-width", String(connection.width));
    thread.shadow.setAttribute("stroke", "rgba(0, 0, 0, 0.38)");
    thread.shadow.setAttribute("stroke-width", String(connection.width + 1.8));
    thread.hit.setAttribute("stroke", "transparent");
    thread.hit.setAttribute("stroke-width", "18");
    thread.fromDot.setAttribute("fill", connection.color);
    thread.toDot.setAttribute("fill", connection.color);
    thread.group.dataset.physics = connection.physics;
    thread.group.classList.toggle("is-dynamic", connection.physics === "dynamic");
  }
}

function setCircle(circle: SVGCircleElement, point: Vec2): void {
  circle.setAttribute("cx", fmt(point.x));
  circle.setAttribute("cy", fmt(point.y));
}

function fmt(value: number): string {
  return (Math.round(value * 10) / 10).toString();
}

export function buildPath(points: Vec2[]): string {
  if (points.length === 0) return "";
  if (points.length === 1) return `M ${fmt(points[0].x)} ${fmt(points[0].y)}`;
  if (points.length === 2) {
    return `M ${fmt(points[0].x)} ${fmt(points[0].y)} L ${fmt(points[1].x)} ${fmt(points[1].y)}`;
  }

  let path = `M ${fmt(points[0].x)} ${fmt(points[0].y)}`;
  for (let i = 1; i < points.length - 1; i++) {
    const point = points[i];
    const next = points[i + 1];
    const midX = (point.x + next.x) / 2;
    const midY = (point.y + next.y) / 2;
    path += ` Q ${fmt(point.x)} ${fmt(point.y)} ${fmt(midX)} ${fmt(midY)}`;
  }
  const last = points[points.length - 1];
  path += ` L ${fmt(last.x)} ${fmt(last.y)}`;
  return path;
}
