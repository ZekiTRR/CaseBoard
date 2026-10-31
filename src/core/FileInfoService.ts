import { App, TFile, getAllTags } from "obsidian";
import type { NoteMeta } from "../core/types";

interface ImageInfo {
  src: string | null;
  missing: boolean;
  mtime: number;
}

export class FileInfoService {
  private readonly noteCache = new Map<string, NoteMeta>();
  private readonly notePromises = new Map<string, Promise<NoteMeta>>();
  private readonly imageCache = new Map<string, ImageInfo>();

  constructor(private readonly app: App) {}

  getNoteMeta(path: string): NoteMeta | null {
    return this.noteCache.get(path) ?? null;
  }

  async loadNoteMeta(path: string): Promise<NoteMeta> {
    const cached = this.noteCache.get(path);
    if (cached) return cached;
    const pending = this.notePromises.get(path);
    if (pending) return pending;

    const promise = this.readNoteMeta(path).then((meta) => {
      this.noteCache.set(path, meta);
      this.notePromises.delete(path);
      return meta;
    });
    this.notePromises.set(path, promise);
    return promise;
  }

  getImageInfo(path: string): ImageInfo {
    const cached = this.imageCache.get(path);
    if (cached) return cached;
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      const missing: ImageInfo = { src: null, missing: true, mtime: 0 };
      this.imageCache.set(path, missing);
      return missing;
    }
    const mtime = file.stat?.mtime ?? 0;
    const base = this.app.vault.adapter.getResourcePath(file.path);
    const src = `${base}${base.includes("?") ? "&" : "?"}cb=${mtime}`;
    const info: ImageInfo = { src, missing: false, mtime };
    this.imageCache.set(path, info);
    return info;
  }

  invalidate(path: string): void {
    this.noteCache.delete(path);
    this.notePromises.delete(path);
    this.imageCache.delete(path);
  }

  invalidateAll(): void {
    this.noteCache.clear();
    this.notePromises.clear();
    this.imageCache.clear();
  }

  private async readNoteMeta(path: string): Promise<NoteMeta> {
    const abstract = this.app.vault.getAbstractFileByPath(path);
    if (!(abstract instanceof TFile)) {
      return {
        title: basename(path),
        excerpt: "",
        tags: [],
        icon: "file-warning",
        missing: true,
        mtime: 0,
        path,
      };
    }

    const file = abstract;
    let raw = "";
    try {
      raw = await this.app.vault.cachedRead(file);
    } catch (error) {
      console.warn(`Caseboard: could not read ${path}`, error);
    }

    const cache = this.app.metadataCache.getFileCache(file);
    const tags = (cache ? getAllTags(cache) ?? [] : []).map((tag) => tag.replace(/^#/, ""));
    const frontmatter = cache?.frontmatter as Record<string, unknown> | undefined;
    const title =
      typeof frontmatter?.title === "string" && frontmatter.title.trim()
        ? frontmatter.title.trim()
        : file.basename;

    return {
      title,
      excerpt: excerptFromMarkdown(raw),
      tags,
      icon: pickIcon(file, tags, frontmatter),
      missing: false,
      mtime: file.stat?.mtime ?? 0,
      path,
    };
  }
}

function excerptFromMarkdown(content: string): string {
  let text = content;
  if (text.startsWith("---")) {
    const end = text.indexOf("\n---", 3);
    if (end !== -1) text = text.slice(end + 4);
  }
  text = text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/~~~[\s\S]*?~~~/g, " ")
    .replace(/!\[\[[^\]]*\]\]/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/^\s*>\s?/gm, "")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+\[[ xX-]\]\s*/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/[*_~`]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length > 280) {
    const cut = text.slice(0, 280);
    const lastSpace = cut.lastIndexOf(" ");
    text = `${cut.slice(0, lastSpace > 180 ? lastSpace : 280).trimEnd()}…`;
  }
  return text;
}

function pickIcon(
  file: TFile,
  tags: string[],
  frontmatter: Record<string, unknown> | undefined,
): string {
  const type = typeof frontmatter?.type === "string" ? frontmatter.type.toLowerCase() : "";
  const lowerTags = tags.map((tag) => tag.toLowerCase());
  const has = (value: string): boolean =>
    type === value || lowerTags.some((tag) => tag === value || tag.endsWith(`/${value}`));

  if (has("daily") || has("journal") || /^\d{4}-\d{2}-\d{2}$/.test(file.basename)) {
    return "calendar-days";
  }
  if (has("book") || has("reading")) return "book-open";
  if (has("person") || has("people") || has("character")) return "user-round";
  if (has("place") || has("location")) return "map-pin";
  if (has("project")) return "folder-kanban";
  if (has("idea") || has("concept")) return "lightbulb";
  if (has("question") || has("case") || has("investigation")) return "search";
  if (has("image") || has("photo")) return "image";
  if (has("meeting") || has("log")) return "notebook-pen";
  return "file-text";
}

function basename(path: string): string {
  const name = path.split("/").pop() ?? path;
  return name.replace(/\.md$/i, "");
}
