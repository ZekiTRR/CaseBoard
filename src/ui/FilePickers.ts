import {
  App,
  FuzzyMatch,
  FuzzySuggestModal,
  Notice,
  TAbstractFile,
  TFile,
  TFolder,
  normalizePath,
  setIcon,
} from "obsidian";
import type { ThemeId } from "../core/types";
import { applyThemeTokens } from "../render/ThemeManager";

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif"]);

export class NotePickerModal extends FuzzySuggestModal<TFile> {
  constructor(
    app: App,
    private readonly onChoose: (file: TFile) => void,
    private readonly isPinned: (file: TFile) => boolean,
    theme: ThemeId,
  ) {
    super(app);
    this.setPlaceholder("Pin a note to the board…");
    this.emptyStateText = "No matching notes.";
    this.limit = 50;
    this.modalEl.addClass("caseboard-suggest-modal");
    applyThemeTokens(this.modalEl, theme);
  }

  getItems(): TFile[] {
    return this.app.vault
      .getMarkdownFiles()
      .sort((a, b) => a.basename.localeCompare(b.basename));
  }

  getItemText(file: TFile): string {
    return file.path;
  }

  override renderSuggestion(item: FuzzyMatch<TFile>, el: HTMLElement): void {
    const row = el.createDiv({ cls: "cb-suggest-row" });
    setIcon(row.createSpan({ cls: "cb-suggest-icon" }), "file-text");
    const text = row.createDiv({ cls: "cb-suggest-text" });
    text.createDiv({ cls: "cb-suggest-title", text: item.item.basename });
    text.createDiv({ cls: "cb-suggest-path", text: item.item.path });
    if (this.isPinned(item.item)) {
      row.createSpan({ cls: "cb-suggest-badge", text: "On board" });
    }
  }

  onChooseItem(file: TFile): void {
    this.onChoose(file);
  }
}

export class ImagePickerModal extends FuzzySuggestModal<TFile> {
  constructor(
    app: App,
    private readonly onChoose: (file: TFile) => void,
    theme: ThemeId,
  ) {
    super(app);
    this.setPlaceholder("Choose a photograph from the vault…");
    this.emptyStateText = "No image files found.";
    this.limit = 60;
    this.modalEl.addClass("caseboard-suggest-modal");
    applyThemeTokens(this.modalEl, theme);
  }

  getItems(): TFile[] {
    return this.app.vault
      .getFiles()
      .filter((file) => IMAGE_EXTENSIONS.has(file.extension.toLowerCase()))
      .sort((a, b) => a.path.localeCompare(b.path));
  }

  getItemText(file: TFile): string {
    return file.path;
  }

  override renderSuggestion(item: FuzzyMatch<TFile>, el: HTMLElement): void {
    const row = el.createDiv({ cls: "cb-suggest-row" });
    setIcon(row.createSpan({ cls: "cb-suggest-icon" }), "image");
    const text = row.createDiv({ cls: "cb-suggest-text" });
    text.createDiv({ cls: "cb-suggest-title", text: item.item.basename });
    text.createDiv({ cls: "cb-suggest-path", text: item.item.path });
  }

  onChooseItem(file: TFile): void {
    this.onChoose(file);
  }
}

export class FolderPickerModal extends FuzzySuggestModal<TAbstractFile> {
  constructor(
    app: App,
    private readonly onChoose: (path: string) => void,
    theme: ThemeId,
  ) {
    super(app);
    this.setPlaceholder("Choose a vault folder…");
    this.emptyStateText = "No matching folders.";
    this.limit = 80;
    this.modalEl.addClass("caseboard-suggest-modal");
    applyThemeTokens(this.modalEl, theme);
  }

  getItems(): TAbstractFile[] {
    const root = { path: "", name: "Vault root" } as unknown as TFolder;
    const folders = this.app.vault
      .getAllLoadedFiles()
      .filter((item): item is TFolder => item instanceof TFolder && item.path !== "/");
    return [root as TAbstractFile, ...folders.sort((a, b) => a.path.localeCompare(b.path))];
  }

  getItemText(item: TAbstractFile): string {
    return item.path || "Vault root";
  }

  override renderSuggestion(item: FuzzyMatch<TAbstractFile>, el: HTMLElement): void {
    const row = el.createDiv({ cls: "cb-suggest-row" });
    setIcon(row.createSpan({ cls: "cb-suggest-icon" }), "folder");
    const text = row.createDiv({ cls: "cb-suggest-text" });
    text.createDiv({ cls: "cb-suggest-title", text: item.item.name });
    text.createDiv({ cls: "cb-suggest-path", text: item.item.path || "Vault root" });
  }

  onChooseItem(item: TAbstractFile): void {
    this.onChoose(item.path);
  }
}

export async function saveImageFromDisk(app: App, folder: string): Promise<TFile | null> {
  const file = await chooseFile();
  if (!file) return null;
  return saveImageFile(app, file, folder);
}

export async function saveImageFile(app: App, file: File, folder: string): Promise<TFile | null> {
  if (!file.type.startsWith("image/")) {
    new Notice("Caseboard: only image files can be pinned.");
    return null;
  }
  if (file.size > 40 * 1024 * 1024) {
    new Notice("Caseboard: this image is larger than 40 MB.");
    return null;
  }

  try {
    const buffer = await file.arrayBuffer();
    const path = await targetPath(app, file.name, folder);
    return await app.vault.createBinary(path, buffer);
  } catch (error) {
    console.error("Caseboard: could not save image", error);
    new Notice("Caseboard: the image could not be saved to the vault.");
    return null;
  }
}

async function targetPath(app: App, originalName: string, folder: string): Promise<string> {
  const safeName = sanitizeName(originalName);
  const trimmedFolder = folder.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");

  if (!trimmedFolder) {
    const path = await app.fileManager.getAvailablePathForAttachment(safeName, "");
    await ensureFolder(app, parentOf(path));
    return path;
  }

  await ensureFolder(app, trimmedFolder);
  const dot = safeName.lastIndexOf(".");
  const stem = dot > 0 ? safeName.slice(0, dot) : safeName;
  const extension = dot > 0 ? safeName.slice(dot) : "";
  let candidate = normalizePath(`${trimmedFolder}/${safeName}`);
  let index = 1;
  while (app.vault.getAbstractFileByPath(candidate)) {
    candidate = normalizePath(`${trimmedFolder}/${stem} ${index}${extension}`);
    index++;
  }
  return candidate;
}

async function ensureFolder(app: App, path: string): Promise<void> {
  if (!path) return;
  const parts = path.split("/");
  let current = "";
  for (const part of parts) {
    if (!part) continue;
    current = current ? `${current}/${part}` : part;
    if (!app.vault.getAbstractFileByPath(current)) {
      await app.vault.createFolder(current).catch(() => undefined);
    }
  }
}

function parentOf(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? "" : path.slice(0, index);
}

function sanitizeName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "-").trim() || "image";
}

function chooseFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.style.display = "none";
    document.body.appendChild(input);
    let settled = false;
    const finish = (file: File | null): void => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(file);
    };
    input.addEventListener("change", () => finish(input.files?.[0] ?? null));
    input.addEventListener("cancel", () => finish(null));
    input.click();
  });
}
