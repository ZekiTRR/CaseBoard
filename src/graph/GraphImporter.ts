import { App, TFile, getAllTags } from "obsidian";
import type {
  BoardConnection,
  BoardDoc,
  BoardNode,
  ImportFilters,
  ImportGroup,
  ImportLayout,
  ImportMode,
  ImportResult,
  NoteBoardNode,
  Vec2,
} from "../core/types";
import {
  createConnection,
  createNoteNode,
  findConnectionBetween,
  nextZ,
} from "../core/BoardModel";
import { clamp, nodeBounds } from "../util/math";
import { uid } from "../util/uid";
import { resolveNote } from "./LinkResolver";
import { layoutGraph, type LayoutEdgeSpec, type LayoutNodeSpec } from "./GraphLayout";

export interface ImportOptions {
  source: string;
  mode: ImportMode;
  depth: number;
  limit: number;
  layout: ImportLayout;
  filters: ImportFilters;
}

export interface ImportPlan {
  rootPath: string;
  files: string[];
  edges: LayoutEdgeSpec[];
  missingLinks: number;
  truncated: boolean;
}

export interface ImportApplyContext {
  viewCenter: Vec2;
  pinColor: string;
  threadColor: string;
}

export interface ImportOutcome extends ImportResult {
  newNodes: BoardNode[];
  newConnections: BoardConnection[];
  group: ImportGroup;
  plan: ImportPlan;
}

export class ImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportError";
  }
}

export class GraphImporter {
  constructor(private readonly app: App) {}

  buildPlan(options: ImportOptions, existingPaths: Set<string> = new Set()): ImportPlan {
    const source = resolveNote(this.app, options.source);
    if (!source) {
      throw new ImportError(`Could not find the note "${options.source}".`);
    }
    const rootPath = source.path;
    const mode = options.mode;
    const maxDepth = mode === "direct" ? 1 : clamp(Math.round(options.depth), 1, 4);
    const limit = clamp(Math.round(options.limit), 1, 500);

    const visited = new Set<string>([rootPath]);
    const queue: Array<{ path: string; depth: number }> = [{ path: rootPath, depth: 0 }];
    const files: string[] = [rootPath];
    let newCount = existingPaths.has(rootPath) ? 0 : 1;
    let truncated = false;

    outer: while (queue.length > 0) {
      const current = queue.shift() as { path: string; depth: number };
      if (current.depth >= maxDepth) continue;
      const links = this.app.metadataCache.resolvedLinks[current.path] ?? {};
      const targets = Object.keys(links).sort();
      for (const target of targets) {
        if (!target.toLowerCase().endsWith(".md")) continue;
        if (visited.has(target)) continue;
        const file = this.app.vault.getAbstractFileByPath(target);
        if (!(file instanceof TFile) || file.extension !== "md") continue;
        if (mode === "filtered" && !this.passesFilters(file, options.filters)) continue;

        const existsOnBoard = existingPaths.has(target);
        if (!existsOnBoard && newCount >= limit) {
          truncated = true;
          continue;
        }

        visited.add(target);
        files.push(target);
        if (!existsOnBoard) newCount++;
        queue.push({ path: target, depth: current.depth + 1 });
        if (newCount >= limit && !existsOnBoard) {
          // Keep traversing only through notes that are already pinned.
          continue;
        }
        if (newCount >= limit) {
          // Existing cards do not count against the limit; keep exploring.
          continue;
        }
      }
      if (queue.length > 2000) break outer;
    }

    const plannedSet = new Set(files);
    const noteTargets = new Set(existingPaths);
    const edges: LayoutEdgeSpec[] = [];
    const seenPairs = new Set<string>();
    let missingLinks = 0;

    for (const path of files) {
      const unresolved = this.app.metadataCache.unresolvedLinks[path];
      if (unresolved) missingLinks += Object.keys(unresolved).length;

      const links = this.app.metadataCache.resolvedLinks[path] ?? {};
      for (const target of Object.keys(links)) {
        if (target === path) continue;
        if (!target.toLowerCase().endsWith(".md")) continue;
        if (!plannedSet.has(target) && !noteTargets.has(target)) continue;
        const pair = [path, target].sort().join("\u0000");
        if (seenPairs.has(pair)) continue;
        seenPairs.add(pair);
        edges.push({ from: path, to: target });
      }
    }

    return { rootPath, files, edges, missingLinks, truncated };
  }

  importIntoBoard(
    doc: BoardDoc,
    options: ImportOptions,
    context: ImportApplyContext,
  ): ImportOutcome {
    const existingNoteNodes = new Map<string, NoteBoardNode>();
    for (const node of doc.nodes) {
      if (node.type === "note") existingNoteNodes.set(node.file, node);
    }
    const existingPaths = new Set(existingNoteNodes.keys());
    const plan = this.buildPlan(options, existingPaths);
    const rootNode = existingNoteNodes.get(plan.rootPath) ?? null;
    const newFiles = plan.files.filter((path) => !existingPaths.has(path));

    let positions = new Map<string, Vec2>();
    if (newFiles.length > 0) {
      const layoutKeys = new Set<string>([plan.rootPath, ...newFiles]);
      const layoutNodes: LayoutNodeSpec[] = newFiles.map((path) => ({
        key: path,
        width: 280,
        height: 210,
      }));
      if (!rootNode) {
        layoutNodes.push({ key: plan.rootPath, width: 280, height: 210 });
      } else {
        layoutNodes.push({
          key: plan.rootPath,
          width: rootNode.width,
          height: rootNode.height,
          fixed: true,
        });
      }

      const layoutEdges = plan.edges.filter(
        (edge) => layoutKeys.has(edge.from) && layoutKeys.has(edge.to),
      );
      const obstacles = doc.nodes
        .filter((node) => node.id !== rootNode?.id)
        .map((node) => nodeBounds(node))
        .filter((rect) => rect.width > 0 && rect.height > 0);

      const layout = layoutGraph(layoutNodes, layoutEdges, {
        rootKey: plan.rootPath,
        rootPosition: rootNode ? { x: rootNode.x, y: rootNode.y } : null,
        mode: options.layout,
        viewCenter: context.viewCenter,
        obstacles,
      });
      positions = layout.positions;
    }

    let z = nextZ(doc);
    const nodeByFile = new Map<string, NoteBoardNode>(existingNoteNodes);
    const newNodes: BoardNode[] = [];
    for (const path of plan.files) {
      if (nodeByFile.has(path)) continue;
      const position = positions.get(path) ?? { ...context.viewCenter };
      const node = createNoteNode(path, {
        position,
        accent: context.pinColor,
      });
      node.z = z++;
      doc.nodes.push(node);
      nodeByFile.set(path, node);
      newNodes.push(node);
    }

    const newConnections: BoardConnection[] = [];
    for (const edge of plan.edges) {
      const fromNode = nodeByFile.get(edge.from);
      const toNode = nodeByFile.get(edge.to);
      if (!fromNode || !toNode) continue;
      if (findConnectionBetween(doc, fromNode.id, toNode.id)) continue;
      const connection = createConnection(fromNode, toNode, {
        color: context.threadColor,
        physics: doc.settings.defaultThreadMode,
        anchor: doc.settings.defaultAnchor,
        autoTension: doc.settings.autoTension,
      });
      doc.connections.push(connection);
      newConnections.push(connection);
    }

    const now = Date.now();
    const filters = {
      folder: options.filters.folder,
      tags: [...options.filters.tags],
      properties: options.filters.properties.map((property) => ({ ...property })),
    };
    let group = doc.imports.find((item) => item.sourcePath === plan.rootPath);
    if (group) {
      group.mode = options.mode;
      group.depth = options.mode === "direct" ? 1 : clamp(options.depth, 1, 4);
      group.limit = clamp(options.limit, 1, 500);
      group.layout = options.layout;
      group.filters = filters;
      group.updatedAt = now;
    } else {
      group = {
        id: uid("imp"),
        sourcePath: plan.rootPath,
        mode: options.mode,
        depth: options.mode === "direct" ? 1 : clamp(options.depth, 1, 4),
        limit: clamp(options.limit, 1, 500),
        layout: options.layout,
        filters,
        createdAt: now,
        updatedAt: now,
      };
      doc.imports.push(group);
    }

    return {
      addedNodes: newNodes.length,
      addedConnections: newConnections.length,
      skippedExisting: plan.files.length - newFiles.length,
      missingLinks: plan.missingLinks,
      truncated: plan.truncated,
      newNodes,
      newConnections,
      group,
      plan,
    };
  }

  private passesFilters(file: TFile, filters: ImportFilters): boolean {
    const folder = filters.folder.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
    if (folder) {
      const target = file.path.toLowerCase();
      const prefix = folder.toLowerCase();
      if (target !== `${prefix}.md` && !target.startsWith(`${prefix}/`)) return false;
    }

    const cache = this.app.metadataCache.getFileCache(file);
    const frontmatter: Record<string, unknown> | undefined = cache?.frontmatter;
    const tags = (cache ? getAllTags(cache) ?? [] : []).map((tag) =>
      tag.replace(/^#/, "").toLowerCase(),
    );

    if (filters.tags.length > 0) {
      const wanted = filters.tags
        .map((tag) => tag.replace(/^#/, "").trim().toLowerCase())
        .filter(Boolean);
      if (wanted.length > 0) {
        const matched = wanted.some((tag) =>
          tags.some((candidate) => candidate === tag || candidate.startsWith(`${tag}/`)),
        );
        if (!matched) return false;
      }
    }

    for (const property of filters.properties) {
      if (!property.key.trim()) continue;
      const value = readProperty(frontmatter, property.key.trim());
      if (!property.value.trim()) {
        if (value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0)) {
          return false;
        }
        continue;
      }
      if (!valueMatches(value, property.value.trim())) return false;
    }

    return true;
  }
}

function readProperty(frontmatter: Record<string, unknown> | undefined, key: string): unknown {
  if (!frontmatter) return undefined;
  if (Object.prototype.hasOwnProperty.call(frontmatter, key)) return frontmatter[key];
  let current: unknown = frontmatter;
  for (const part of key.split(".")) {
    if (typeof current !== "object" || current === null) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function valueMatches(value: unknown, query: string): boolean {
  const needle = query.toLowerCase();
  if (Array.isArray(value)) return value.some((item) => valueMatches(item, query));
  if (typeof value === "string") {
    const text = value.toLowerCase();
    return text === needle || text.includes(needle);
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value).toLowerCase().includes(needle);
  }
  if (value instanceof Date) return value.toISOString().toLowerCase().includes(needle);
  return false;
}
