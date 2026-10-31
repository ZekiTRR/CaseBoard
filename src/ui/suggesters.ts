import { AbstractInputSuggest, App, TFile, TFolder, setIcon } from "obsidian";

export class NoteInputSuggest extends AbstractInputSuggest<TFile> {
  constructor(
    app: App,
    inputEl: HTMLInputElement,
    private readonly onPick?: (file: TFile) => void,
  ) {
    super(app, inputEl);
    this.limit = 30;
  }

  protected override getSuggestions(query: string): TFile[] {
    const needle = query.trim().toLowerCase();
    const files = this.app.vault.getMarkdownFiles();
    const matched = needle
      ? files.filter((file) => {
          const path = file.path.toLowerCase();
          const name = file.basename.toLowerCase();
          return path.includes(needle) || name.includes(needle);
        })
      : files;
    return matched
      .sort((a, b) => {
        const aName = a.basename.toLowerCase();
        const bName = b.basename.toLowerCase();
        const aStarts = aName.startsWith(needle) ? 0 : 1;
        const bStarts = bName.startsWith(needle) ? 0 : 1;
        if (aStarts !== bStarts) return aStarts - bStarts;
        return a.path.length - b.path.length;
      })
      .slice(0, this.limit || 30);
  }

  override renderSuggestion(file: TFile, el: HTMLElement): void {
    const wrap = el.createDiv({ cls: "cb-suggest-row" });
    const icon = wrap.createSpan({ cls: "cb-suggest-icon" });
    setIcon(icon, "file-text");
    const text = wrap.createDiv({ cls: "cb-suggest-text" });
    text.createDiv({ cls: "cb-suggest-title", text: file.basename });
    text.createDiv({ cls: "cb-suggest-path", text: file.path });
  }

  override selectSuggestion(file: TFile): void {
    this.setValue(file.path);
    this.close();
    this.onPick?.(file);
  }
}

export class FolderInputSuggest extends AbstractInputSuggest<TFolder> {
  constructor(app: App, inputEl: HTMLInputElement) {
    super(app, inputEl);
    this.limit = 30;
  }

  protected override getSuggestions(query: string): TFolder[] {
    const needle = query.trim().toLowerCase();
    const folders = this.app.vault.getAllLoadedFiles().filter(
      (file): file is TFolder => file instanceof TFolder,
    );
    return folders
      .filter((folder) => folder.path !== "/" && folder.path.toLowerCase().includes(needle))
      .sort((a, b) => a.path.length - b.path.length)
      .slice(0, this.limit || 30);
  }

  override renderSuggestion(folder: TFolder, el: HTMLElement): void {
    const wrap = el.createDiv({ cls: "cb-suggest-row" });
    setIcon(wrap.createSpan({ cls: "cb-suggest-icon" }), "folder");
    const text = wrap.createDiv({ cls: "cb-suggest-text" });
    text.createDiv({ cls: "cb-suggest-title", text: folder.name });
    text.createDiv({ cls: "cb-suggest-path", text: folder.path });
  }

  override selectSuggestion(folder: TFolder): void {
    this.setValue(folder.path);
    this.close();
  }
}
