import { App, Modal, setIcon } from "obsidian";
import type { ImportLayout, ImportMode, PropertyFilter, ThemeId } from "../core/types";
import type { ImportOptions } from "../graph/GraphImporter";
import { resolveNote } from "../graph/LinkResolver";
import { applyThemeTokens } from "../render/ThemeManager";
import { FolderInputSuggest, NoteInputSuggest } from "./suggesters";

export interface ImportDefaults {
  source: string;
  depth: number;
  limit: number;
  layout: ImportLayout;
}

export interface ImportModalOptions {
  theme: ThemeId;
  defaults: ImportDefaults;
  onSubmit: (options: ImportOptions) => string | null;
}

export class ImportModal extends Modal {
  private mode: ImportMode = "direct";
  private readonly sourceInput: HTMLInputElement;
  private readonly depthRow: HTMLElement;
  private readonly depthSelect: HTMLSelectElement;
  private readonly filtersBlock: HTMLElement;
  private readonly folderInput: HTMLInputElement;
  private readonly tagsInput: HTMLInputElement;
  private readonly propertiesInput: HTMLTextAreaElement;
  private readonly limitInput: HTMLInputElement;
  private readonly layoutSelect: HTMLSelectElement;
  private readonly errorEl: HTMLElement;
  private noteSuggest: NoteInputSuggest | null = null;
  private folderSuggest: FolderInputSuggest | null = null;

  constructor(
    app: App,
    private readonly options: ImportModalOptions,
  ) {
    super(app);
    this.modalEl.addClass("caseboard-modal", "cb-import-modal");
    applyThemeTokens(this.modalEl, options.theme);

    const content = this.contentEl;
    content.addClass("cb-modal-content");
    content.empty();

    const header = content.createDiv({ cls: "cb-modal-head" });
    const mark = header.createDiv({ cls: "cb-modal-mark" });
    setIcon(mark, "search");
    const titles = header.createDiv({ cls: "cb-modal-titles" });
    titles.createDiv({ cls: "cb-eyebrow", text: "Import evidence" });
    titles.createDiv({ cls: "cb-modal-title", text: "Trace a chain of notes" });
    titles.createDiv({
      cls: "cb-modal-desc",
      text: "Pull a note and its links onto the board. Existing cards are never moved.",
    });

    const form = content.createEl("form", { cls: "cb-import-form" });

    const sourceField = this.field(form, "Source note", "The note whose links will be followed.");
    this.sourceInput = sourceField.content.createEl("input", {
      cls: "cb-text-input",
      attr: {
        type: "text",
        placeholder: "Folder / Note name",
        spellcheck: "false",
      },
    });
    this.sourceInput.value = options.defaults.source;
    this.noteSuggest = new NoteInputSuggest(app, this.sourceInput);

    const modeField = this.field(
      form,
      "Import mode",
      "Choose how far the thread should travel from the source note.",
    );
    const modes = modeField.content.createDiv({ cls: "cb-mode-grid" });
    const modeDefs: Array<{ id: ImportMode; title: string; desc: string; icon: string }> = [
      { id: "direct", title: "Direct", desc: "Only notes linked from the source.", icon: "arrow-right" },
      { id: "recursive", title: "Recursive", desc: "Follow links down several levels.", icon: "git-branch" },
      { id: "filtered", title: "Filtered", desc: "Recursive, narrowed by folder, tags or properties.", icon: "filter" },
    ];
    const modeButtons: HTMLButtonElement[] = [];
    for (const def of modeDefs) {
      const button = modes.createEl("button", {
        cls: "cb-mode-card",
        attr: { type: "button", role: "radio", "aria-checked": String(def.id === this.mode) },
      });
      setIcon(button.createSpan({ cls: "cb-mode-icon" }), def.icon);
      button.createDiv({ cls: "cb-mode-title", text: def.title });
      button.createDiv({ cls: "cb-mode-desc", text: def.desc });
      button.classList.toggle("is-active", def.id === this.mode);
      button.addEventListener("click", () => {
        this.mode = def.id;
        for (const item of modeButtons) {
          item.classList.toggle("is-active", item === button);
          item.setAttribute("aria-checked", String(item === button));
        }
        this.updateVisibility();
      });
      modeButtons.push(button);
    }

    const grid = form.createDiv({ cls: "cb-import-grid" });
    const depthField = this.field(grid, "Depth", "How many link levels to follow.", "cb-depth-row");
    this.depthSelect = depthField.content.createEl("select", { cls: "cb-select" });
    for (let depth = 1; depth <= 4; depth++) {
      this.depthSelect.createEl("option", {
        value: String(depth),
        text: depth === 1 ? "1 — direct links" : `${depth} levels`,
      });
    }
    this.depthSelect.value = String(Math.max(1, Math.min(4, options.defaults.depth)));
    this.depthRow = depthField.wrap;

    const limitField = this.field(grid, "Max new cards", "A safety stop for large vaults.");
    this.limitInput = limitField.content.createEl("input", {
      cls: "cb-text-input",
      attr: { type: "number", min: "1", max: "500", step: "1" },
    });
    this.limitInput.value = String(options.defaults.limit);

    const layoutField = this.field(grid, "Layout", "How new cards are arranged.");
    this.layoutSelect = layoutField.content.createEl("select", { cls: "cb-select" });
    this.layoutSelect.createEl("option", { value: "organic", text: "Organic" });
    this.layoutSelect.createEl("option", { value: "tree", text: "Tidy tree" });
    this.layoutSelect.value = options.defaults.layout;

    this.filtersBlock = form.createDiv({ cls: "cb-filters" });
    this.filtersBlock.createDiv({ cls: "cb-form-divider" });
    const filtersHead = this.filtersBlock.createDiv({ cls: "cb-filters-head" });
    filtersHead.createDiv({ cls: "cb-eyebrow", text: "Filters" });
    filtersHead.createDiv({
      cls: "cb-field-desc",
      text: "Only matching notes are pulled in. The source note is always included.",
    });

    const folderField = this.field(this.filtersBlock, "Folder", "A vault folder or any folder inside it.");
    this.folderInput = folderField.content.createEl("input", {
      cls: "cb-text-input",
      attr: { type: "text", placeholder: "06 - Daily Notes" },
    });
    this.folderSuggest = new FolderInputSuggest(app, this.folderInput);

    const tagField = this.field(this.filtersBlock, "Tags", "Comma separated. Any match is accepted.");
    this.tagsInput = tagField.content.createEl("input", {
      cls: "cb-text-input",
      attr: { type: "text", placeholder: "project, research, case" },
    });

    const propsField = this.field(
      this.filtersBlock,
      "Properties",
      "One per line, key: value. All must match. Leave the value empty to require the key.",
    );
    this.propertiesInput = propsField.content.createEl("textarea", {
      cls: "cb-text-area",
      attr: { rows: "3", placeholder: "type: book\nstatus: active" },
    });

    const footer = form.createDiv({ cls: "cb-modal-footer" });
    this.errorEl = footer.createDiv({ cls: "cb-import-error", attr: { "aria-live": "polite" } });
    const actions = footer.createDiv({ cls: "cb-modal-actions" });
    const cancel = actions.createEl("button", {
      cls: "cb-ghost-button",
      text: "Cancel",
      attr: { type: "button" },
    });
    cancel.addEventListener("click", () => this.close());
    const submit = actions.createEl("button", {
      cls: "cb-primary-button",
      attr: { type: "submit" },
    });
    setIcon(submit.createSpan({ cls: "cb-inline-icon" }), "git-branch");
    submit.createSpan({ text: "Import notes" });

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      this.trySubmit();
    });

    this.updateVisibility();
    window.setTimeout(() => this.sourceInput.focus(), 40);
  }

  onClose(): void {
    this.noteSuggest?.close();
    this.folderSuggest?.close();
    this.noteSuggest = null;
    this.folderSuggest = null;
    this.contentEl.empty();
  }

  private trySubmit(): void {
    const source = this.sourceInput.value.trim();
    if (!source) {
      this.showError("Choose a source note first.");
      return;
    }
    if (!resolveNote(this.app, source)) {
      this.showError(`Could not find the note "${source}".`);
      return;
    }
    const limit = Math.max(1, Math.min(500, Number(this.limitInput.value) || 80));
    const depth = this.mode === "direct" ? 1 : Math.max(1, Math.min(4, Number(this.depthSelect.value) || 1));
    const filterMode = this.mode === "filtered";
    const options: ImportOptions = {
      source,
      mode: this.mode,
      depth,
      limit,
      layout: this.layoutSelect.value as ImportLayout,
      filters: {
        folder: filterMode ? this.folderInput.value.trim() : "",
        tags: filterMode ? parseTags(this.tagsInput.value) : [],
        properties: filterMode ? parseProperties(this.propertiesInput.value) : [],
      },
    };

    this.errorEl.textContent = "";
    const error = this.options.onSubmit(options);
    if (error) {
      this.showError(error);
      return;
    }
    this.close();
  }

  private updateVisibility(): void {
    this.depthRow.style.display = this.mode === "direct" ? "none" : "";
    this.filtersBlock.style.display = this.mode === "filtered" ? "" : "none";
    if (this.mode === "direct") this.depthSelect.value = "1";
  }

  private showError(message: string): void {
    this.errorEl.textContent = message;
  }

  private field(
    parent: HTMLElement,
    label: string,
    description: string,
    extraClass = "",
  ): { wrap: HTMLElement; content: HTMLElement } {
    const wrap = parent.createDiv({ cls: `cb-form-field ${extraClass}`.trim() });
    const labelEl = wrap.createEl("label", { cls: "cb-field-label", text: label });
    const content = wrap.createDiv({ cls: "cb-field-content" });
    wrap.createDiv({ cls: "cb-field-desc", text: description });
    labelEl.htmlFor = "";
    return { wrap, content };
  }
}

function parseTags(value: string): string[] {
  return value
    .split(/[,\n]+/)
    .map((tag) => tag.replace(/^#/, "").trim())
    .filter(Boolean);
}

function parseProperties(value: string): PropertyFilter[] {
  const filters: PropertyFilter[] = [];
  for (const rawLine of value.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    const colon = line.indexOf(":");
    if (colon === -1) {
      filters.push({ key: line, value: "" });
    } else {
      const key = line.slice(0, colon).trim();
      if (!key) continue;
      filters.push({ key, value: line.slice(colon + 1).trim() });
    }
  }
  return filters;
}
