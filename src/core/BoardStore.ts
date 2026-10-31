import type { Plugin } from "obsidian";
import type {
  BoardDoc,
  BoardMeta,
  CaseboardSettings,
  PluginData,
  ThemeId,
} from "./types";
import { defaultPluginData } from "./defaults";
import { createBoardDoc, patchFilePaths, touch } from "./BoardModel";
import { BoardFiles } from "../persistence/BoardFiles";
import {
  normalizeBoardMeta,
  normalizeSettings,
  serializeBoard,
} from "../persistence/BoardSerializer";
import { Debouncer } from "../util/debounce";
import { uid } from "../util/uid";

export class BoardLoadError extends Error {
  constructor(
    message: string,
    public readonly boardId: string,
    public readonly warnings: string[] = [],
  ) {
    super(message);
    this.name = "BoardLoadError";
  }
}

export interface LoadedBoard {
  doc: BoardDoc;
  warnings: string[];
}

type Listener = () => void;

export class BoardStore {
  private data: PluginData = defaultPluginData();
  private readonly dataDebouncer: Debouncer;
  private dataWriting: Promise<void> = Promise.resolve();
  private readonly writeQueues = new Map<string, Promise<void>>();
  private readonly listeners = new Set<Listener>();
  private initialized = false;

  constructor(
    private readonly plugin: Plugin,
    private readonly files: BoardFiles,
  ) {
    this.dataDebouncer = new Debouncer(() => {
      void this.persistNow().catch((error) => {
        console.error("Caseboard: could not save plugin data", error);
      });
    }, 280);
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    const raw = await this.plugin.loadData();
    this.data = normalizePluginData(raw);

    this.files.useFolder(this.data.settings.boardFolder);
    await this.files.ensureDir();
    const fileIds = await this.files.listEntryIds();
    const knownIds = new Set(this.data.boards.map((board) => board.id));

    for (const id of fileIds) {
      if (knownIds.has(id)) continue;
      const result = await this.files.readBoard(id);
      if (result.doc) {
        const meta = metaFromDoc(result.doc);
        this.data.boards.push(meta);
        knownIds.add(id);
      } else {
        console.warn(`Caseboard: ignored unreadable board file "${id}": ${result.error ?? ""}`);
      }
    }

    const kept: BoardMeta[] = [];
    for (const meta of this.data.boards) {
      if (await this.files.hasAny(meta.id)) kept.push(meta);
      else console.warn(`Caseboard: board "${meta.name}" has no file and was removed from the index.`);
    }
    this.data.boards = kept;

    if (
      !this.data.lastBoardId ||
      !this.data.boards.some((board) => board.id === this.data.lastBoardId)
    ) {
      this.data.lastBoardId = this.data.boards[0]?.id ?? null;
    }

    this.initialized = true;
    await this.persistNow();
  }

  getSettings(): CaseboardSettings {
    return this.data.settings;
  }

  getBoardDirectory(): string {
    return this.files.directory;
  }

  async updateSettings(patch: Partial<CaseboardSettings>): Promise<void> {
    if (patch.boardFolder !== undefined) {
      await this.setBoardFolder(patch.boardFolder);
      return;
    }
    this.data.settings = normalizeSettings({ ...this.data.settings, ...patch });
    this.schedulePersistData();
    this.emit();
  }

  async setBoardFolder(folder: string): Promise<number> {
    const normalized = normalizeSettings({ ...this.data.settings, boardFolder: folder })
      .boardFolder;
    if (normalized === this.data.settings.boardFolder) return 0;
    const moved = await this.files.moveBoards(normalized);
    this.data.settings = { ...this.data.settings, boardFolder: normalized };
    await this.persistNow();
    this.emit();
    return moved;
  }

  getBoards(): BoardMeta[] {
    return [...this.data.boards].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  getBoardMeta(id: string): BoardMeta | null {
    const meta = this.data.boards.find((board) => board.id === id);
    return meta ? { ...meta } : null;
  }

  getLastBoardId(): string | null {
    return this.data.lastBoardId;
  }

  setLastBoardId(id: string): void {
    if (this.data.lastBoardId === id) return;
    this.data.lastBoardId = id;
    this.schedulePersistData();
  }

  async createBoard(name?: string, theme?: ThemeId): Promise<BoardDoc> {
    const finalName = this.uniqueBoardName(name?.trim() || "Untitled Case");
    const doc = createBoardDoc(
      uid("board"),
      finalName,
      theme ?? this.data.settings.defaultTheme,
      this.data.settings,
    );
    await this.files.save(doc);
    this.data.boards.push(metaFromDoc(doc));
    this.data.lastBoardId = doc.id;
    await this.persistNow();
    this.emit();
    return doc;
  }

  async loadBoard(id: string): Promise<LoadedBoard> {
    const result = await this.files.readBoard(id);
    if (!result.doc) {
      throw new BoardLoadError(
        result.error ?? "The board file could not be loaded.",
        id,
        result.warnings,
      );
    }

    const doc = result.doc;
    if (doc.id !== id) {
      doc.id = id;
    }
    this.data.lastBoardId = id;

    let meta = this.data.boards.find((board) => board.id === id);
    if (!meta) {
      meta = metaFromDoc(doc);
      this.data.boards.push(meta);
    } else {
      meta.name = doc.name;
      meta.theme = doc.theme;
      meta.updatedAt = Math.max(meta.updatedAt, doc.updatedAt);
    }

    this.schedulePersistData();
    return { doc, warnings: result.warnings };
  }

  async ensureInitialBoard(): Promise<LoadedBoard> {
    if (this.data.boards.length === 0) {
      const doc = await this.createBoard();
      return { doc, warnings: [] };
    }
    const preferred =
      (this.data.lastBoardId &&
        this.data.boards.find((board) => board.id === this.data.lastBoardId)?.id) ||
      this.getBoards()[0]?.id;
    if (!preferred) {
      const doc = await this.createBoard();
      return { doc, warnings: [] };
    }
    return this.loadBoard(preferred);
  }

  async saveBoard(doc: BoardDoc): Promise<void> {
    doc.schemaVersion = 1;
    doc.updatedAt = Math.max(doc.updatedAt, Date.now());
    const text = serializeBoard(doc);
    const previous = this.writeQueues.get(doc.id) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(() => this.files.writeSerialized(doc.id, text));
    this.writeQueues.set(doc.id, next);
    try {
      await next;
    } finally {
      if (this.writeQueues.get(doc.id) === next) this.writeQueues.delete(doc.id);
    }

    let meta = this.data.boards.find((board) => board.id === doc.id);
    if (!meta) {
      meta = metaFromDoc(doc);
      this.data.boards.push(meta);
    } else {
      meta.name = doc.name;
      meta.theme = doc.theme;
      meta.createdAt = doc.createdAt;
      meta.updatedAt = doc.updatedAt;
    }
    this.data.lastBoardId = doc.id;
    this.schedulePersistData();
  }

  async renameBoard(id: string, name: string): Promise<void> {
    const trimmed = name.trim();
    if (!trimmed) return;
    const meta = this.data.boards.find((board) => board.id === id);
    if (!meta) return;
    const result = await this.files.readBoard(id);
    if (!result.doc) throw new BoardLoadError(result.error ?? "The board could not be renamed.", id);
    const doc = result.doc;
    doc.name = trimmed;
    touch(doc);
    await this.files.writeSerialized(id, serializeBoard(doc));
    meta.name = trimmed;
    meta.updatedAt = doc.updatedAt;
    this.schedulePersistData();
    this.emit();
  }

  async deleteBoard(id: string): Promise<BoardMeta | null> {
    const pending = this.writeQueues.get(id);
    if (pending) await pending.catch(() => undefined);
    await this.files.remove(id);
    this.data.boards = this.data.boards.filter((board) => board.id !== id);
    if (this.data.lastBoardId === id) {
      this.data.lastBoardId = this.getBoards()[0]?.id ?? null;
    }
    await this.persistNow();
    this.emit();
    return this.data.lastBoardId
      ? (this.data.boards.find((board) => board.id === this.data.lastBoardId) ?? null)
      : null;
  }

  async patchClosedBoardFiles(
    oldPath: string,
    newPath: string,
    openBoardIds: Set<string>,
  ): Promise<number> {
    let patched = 0;
    for (const meta of this.data.boards) {
      if (openBoardIds.has(meta.id)) continue;
      try {
        const result = await this.files.readBoard(meta.id);
        if (!result.doc) continue;
        const doc = result.doc;
        if (!patchFilePaths(doc, oldPath, newPath)) continue;
        touch(doc);
        await this.files.writeSerialized(doc.id, serializeBoard(doc));
        meta.updatedAt = doc.updatedAt;
        meta.name = doc.name;
        patched++;
      } catch (error) {
        console.warn(`Caseboard: could not update file paths in board ${meta.id}`, error);
      }
    }
    if (patched > 0) {
      this.schedulePersistData();
      this.emit();
    }
    return patched;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async flush(): Promise<void> {
    this.dataDebouncer.flush();
    await this.dataWriting.catch(() => undefined);
    await Promise.all([...this.writeQueues.values()].map((promise) => promise.catch(() => undefined)));
  }

  dispose(): void {
    this.dataDebouncer.dispose();
    this.listeners.clear();
  }

  private uniqueBoardName(base: string): string {
    const names = new Set(this.data.boards.map((board) => board.name.toLowerCase()));
    if (!names.has(base.toLowerCase())) return base;
    let index = 2;
    while (names.has(`${base} ${index}`.toLowerCase())) index++;
    return `${base} ${index}`;
  }

  private schedulePersistData(): void {
    this.dataDebouncer.schedule();
  }

  private persistNow(): Promise<void> {
    const snapshot = JSON.parse(JSON.stringify(this.data)) as PluginData;
    this.dataWriting = this.dataWriting
      .catch(() => undefined)
      .then(() => this.plugin.saveData(snapshot));
    return this.dataWriting;
  }

  private emit(): void {
    for (const listener of [...this.listeners]) {
      try {
        listener();
      } catch (error) {
        console.error("Caseboard: store listener failed", error);
      }
    }
  }
}

function metaFromDoc(doc: BoardDoc): BoardMeta {
  return {
    id: doc.id,
    name: doc.name,
    theme: doc.theme,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function normalizePluginData(raw: unknown): PluginData {
  const data = defaultPluginData();
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return data;
  const record = raw as Record<string, unknown>;
  data.settings = normalizeSettings(record.settings);

  if (Array.isArray(record.boards)) {
    const seen = new Set<string>();
    for (const item of record.boards) {
      const meta = normalizeBoardMeta(item);
      if (!meta || seen.has(meta.id)) continue;
      seen.add(meta.id);
      data.boards.push(meta);
    }
  }

  const last = typeof record.lastBoardId === "string" ? record.lastBoardId : null;
  data.lastBoardId = last && data.boards.some((board) => board.id === last) ? last : null;
  return data;
}
