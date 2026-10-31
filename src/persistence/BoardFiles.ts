import { App, normalizePath } from "obsidian";
import type { BoardDoc } from "../core/types";
import { normalizeFolderSetting } from "../util/paths";
import { parseBoardText, serializeBoard } from "./BoardSerializer";

export interface BoardReadResult {
  doc: BoardDoc | null;
  found: boolean;
  warnings: string[];
  error?: string;
  recovered?: boolean;
}

export class BoardFiles {
  private readonly adapter;
  private readonly defaultDir: string;
  private dir: string;

  constructor(
    app: App,
    pluginDir: string,
  ) {
    this.adapter = app.vault.adapter;
    this.defaultDir = normalizePath(`${pluginDir}/boards`);
    this.dir = this.defaultDir;
  }

  get directory(): string {
    return this.dir;
  }

  resolveDirectory(folder: string): string {
    const trimmed = normalizeFolderSetting(folder);
    return trimmed ? normalizePath(trimmed) : this.defaultDir;
  }

  useFolder(folder: string): void {
    this.dir = this.resolveDirectory(folder);
  }

  async moveBoards(targetFolder: string): Promise<number> {
    const target = this.resolveDirectory(targetFolder);
    const source = this.dir;
    if (source === target) return 0;
    await this.ensureDirectory(target);

    const listing = await this.adapter.list(source).catch(() => null);
    const planned = (listing?.files ?? [])
      .filter((file) => isBoardArtifact(file.split("/").pop() ?? file))
      .map((file) => {
        const name = file.split("/").pop() ?? file;
        return { from: file, to: normalizePath(`${target}/${name}`), name };
      });

    for (const move of planned) {
      if (await this.adapter.exists(move.to)) {
        throw new Error(`A board file named “${move.name}” already exists in the destination folder.`);
      }
    }

    const done: typeof planned = [];
    try {
      for (const move of planned) {
        await this.adapter.rename(move.from, move.to);
        done.push(move);
      }
    } catch (error) {
      for (const move of [...done].reverse()) {
        await this.adapter.rename(move.to, move.from).catch(() => undefined);
      }
      throw error;
    }

    this.dir = target;
    return done.length;
  }

  pathFor(id: string): string {
    return normalizePath(`${this.dir}/${id}.json`);
  }

  async ensureDir(): Promise<void> {
    await this.ensureDirectory(this.dir);
  }

  private async ensureDirectory(path: string): Promise<void> {
    if (!path || (await this.adapter.exists(path))) return;
    const parent = path.slice(0, path.lastIndexOf("/"));
    if (parent && parent !== path) await this.ensureDirectory(parent);
    await this.adapter.mkdir(path).catch(() => undefined);
  }

  async listEntryIds(): Promise<string[]> {
    if (!(await this.adapter.exists(this.dir))) return [];
    const listing = await this.adapter.list(this.dir);
    const ids = new Set<string>();
    for (const file of listing.files) {
      const name = file.split("/").pop() ?? file;
      if (!name.endsWith(".json")) continue;
      if (name.includes(".corrupt-") || name.endsWith(".bak") || name.endsWith(".tmp")) continue;
      ids.add(name.slice(0, -5));
    }
    return [...ids];
  }

  async hasAny(id: string): Promise<boolean> {
    return (
      (await this.adapter.exists(this.pathFor(id))) ||
      (await this.adapter.exists(this.backupPath(id)))
    );
  }

  async readBoard(id: string): Promise<BoardReadResult> {
    const path = this.pathFor(id);
    const backupPath = this.backupPath(id);
    const warnings: string[] = [];

    const mainExists = await this.adapter.exists(path);
    const backupExists = await this.adapter.exists(backupPath);
    if (!mainExists && !backupExists) {
      return { doc: null, found: false, warnings, error: "The board file was not found." };
    }

    let mainText: string | null = null;
    let mainReadError: string | null = null;
    if (mainExists) {
      try {
        mainText = await this.adapter.read(path);
      } catch (error) {
        mainReadError = error instanceof Error ? error.message : String(error);
      }
    }

    if (mainText !== null) {
      const parsed = parseBoardText(mainText);
      if (parsed.ok) {
        return { doc: parsed.doc, found: true, warnings: parsed.warnings };
      }
      if (parsed.reason === "version") {
        return { doc: null, found: true, warnings, error: parsed.error };
      }
      warnings.push(`The board file could not be read: ${parsed.error}`);
    } else if (mainReadError) {
      warnings.push(`The board file could not be read: ${mainReadError}`);
    }

    let backupText: string | null = null;
    if (backupExists) {
      try {
        backupText = await this.adapter.read(backupPath);
      } catch (error) {
        warnings.push(
          `The backup could not be read: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    if (backupText !== null) {
      const parsedBackup = parseBoardText(backupText);
      if (parsedBackup.ok) {
        if (mainText !== null) {
          await this.preserveCorruptCopy(id, mainText);
        }
        try {
          await this.adapter.write(path, serializeBoard(parsedBackup.doc));
          warnings.push("The board was restored from its last good backup.");
          return {
            doc: parsedBackup.doc,
            found: true,
            warnings: [...warnings, ...parsedBackup.warnings],
            recovered: true,
          };
        } catch (error) {
          warnings.push(
            `The backup was loaded but could not be written back: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
          return {
            doc: parsedBackup.doc,
            found: true,
            warnings: [...warnings, ...parsedBackup.warnings],
            recovered: true,
          };
        }
      }
      warnings.push(`The backup is damaged too: ${parsedBackup.error}`);
    }

    return {
      doc: null,
      found: true,
      warnings,
      error:
        warnings.join(" ") ||
        "The board file is damaged and no usable backup exists.",
    };
  }

  async writeSerialized(id: string, text: string): Promise<void> {
    await this.ensureDir();
    const path = this.pathFor(id);
    const backupPath = this.backupPath(id);
    const tempPath = `${path}.tmp`;

    await this.adapter.write(tempPath, text);

    let movedOriginal = false;
    try {
      if (await this.adapter.exists(path)) {
        if (await this.adapter.exists(backupPath)) {
          await this.adapter.remove(backupPath).catch(() => undefined);
        }
        await this.adapter.rename(path, backupPath);
        movedOriginal = true;
      }
      await this.adapter.rename(tempPath, path);
    } catch (error) {
      if (movedOriginal) {
        await this.adapter.rename(backupPath, path).catch(() => undefined);
      }
      await this.adapter.remove(tempPath).catch(() => undefined);
      throw error;
    }
  }

  async save(doc: BoardDoc): Promise<void> {
    await this.writeSerialized(doc.id, serializeBoard(doc));
  }

  async remove(id: string): Promise<void> {
    await this.ensureDir();
    const main = this.pathFor(id);
    if (await this.adapter.exists(main)) {
      const movedToTrash = await this.adapter.trashSystem(main).catch(() => false);
      if (!movedToTrash) {
        await this.adapter.remove(main).catch(() => undefined);
      }
    }

    const listing = await this.adapter.list(this.dir).catch(() => null);
    if (listing) {
      for (const file of listing.files) {
        const name = file.split("/").pop() ?? file;
        if (
          name.startsWith(`${id}.`) &&
          (name.endsWith(".bak") || name.endsWith(".tmp") || name.includes(".corrupt-"))
        ) {
          await this.adapter.remove(file).catch(() => undefined);
        }
      }
    }
  }

  private backupPath(id: string): string {
    return `${this.pathFor(id)}.bak`;
  }

  private async preserveCorruptCopy(id: string, text: string): Promise<void> {
    try {
      const path = normalizePath(`${this.dir}/${id}.corrupt-${Date.now()}.json`);
      await this.adapter.write(path, text);
    } catch (error) {
      console.warn("Caseboard: could not preserve a copy of the damaged board", error);
    }
  }
}

function isBoardArtifact(name: string): boolean {
  return name.endsWith(".json") || name.endsWith(".json.bak") || name.endsWith(".json.tmp");
}
