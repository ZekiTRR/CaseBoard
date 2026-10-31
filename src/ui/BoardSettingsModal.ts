import { App, Modal, setIcon, TFile } from "obsidian";
import type {
  AnchorKind,
  BackgroundFit,
  BoardDoc,
  BoardSettings,
  ImageFit,
  ThemeId,
  ThreadMode,
} from "../core/types";
import { getThemeList } from "../render/themes";
import { applyThemeTokens } from "../render/ThemeManager";
import { ImagePickerModal, saveImageFromDisk } from "./FilePickers";

export interface BoardSettingsHost {
  getBoard(): BoardDoc;
  setBoardName(name: string): void;
  setTheme(id: ThemeId): void;
  updateBoardSettings(patch: Partial<BoardSettings>): void;
  getAttachmentFolder(): string;
  openPluginSettings(): void;
  resetCamera(): void;
}

export class BoardSettingsModal extends Modal {
  constructor(
    app: App,
    private readonly host: BoardSettingsHost,
  ) {
    super(app);
    const board = host.getBoard();
    this.modalEl.addClass("caseboard-modal", "cb-board-settings-modal");
    applyThemeTokens(this.modalEl, board.theme);
  }

  onOpen(): void {
    const board = this.host.getBoard();
    const content = this.contentEl;
    content.addClass("cb-modal-content");
    content.empty();

    const header = content.createDiv({ cls: "cb-modal-head" });
    const mark = header.createDiv({ cls: "cb-modal-mark" });
    setIcon(mark, "sliders-horizontal");
    const titles = header.createDiv({ cls: "cb-modal-titles" });
    titles.createDiv({ cls: "cb-eyebrow", text: "Board" });
    titles.createDiv({ cls: "cb-modal-title", text: "Investigation settings" });
    titles.createDiv({
      cls: "cb-modal-desc",
      text: "These settings belong to this board only.",
    });

    const body = content.createDiv({ cls: "cb-settings-body" });

    const identity = this.section(body, "Identity");
    const nameField = this.textField(identity, "Board name", "Shown in the tab and the board menu.");
    const nameInput = nameField.control.createEl("input", {
      cls: "cb-text-input",
      attr: { type: "text" },
    });
    nameInput.value = board.name;
    nameInput.addEventListener("change", () => {
      const value = nameInput.value.trim();
      if (!value) {
        nameInput.value = this.host.getBoard().name;
        return;
      }
      this.host.setBoardName(value);
    });

    const themeField = this.textField(identity, "Surface", "Textures, pins and thread palette.");
    const themeSelect = themeField.control.createEl("select", { cls: "cb-select" });
    for (const theme of getThemeList()) {
      themeSelect.createEl("option", { value: theme.id, text: theme.name });
    }
    themeSelect.value = board.theme;
    themeSelect.addEventListener("change", () => {
      const id = themeSelect.value as ThemeId;
      this.host.setTheme(id);
      applyThemeTokens(this.modalEl, id);
    });

    const viewRow = this.textField(identity, "Camera", "Recenter the board in the view.");
    const resetView = viewRow.control.createEl("button", {
      cls: "cb-ghost-button cb-small-button",
      attr: { type: "button" },
    });
    setIcon(resetView.createSpan({ cls: "cb-inline-icon" }), "focus");
    resetView.createSpan({ text: "Center board" });
    resetView.addEventListener("click", () => this.host.resetCamera());

    const background = this.section(body, "Background");
    const path = board.settings.customBackground.trim();
    const exists = path ? this.app.vault.getAbstractFileByPath(path) instanceof TFile : false;
    const row = background.createDiv({ cls: "cb-background-row" });
    const preview = row.createDiv({ cls: "cb-background-preview" });
    if (exists) {
      preview.style.backgroundImage = `url("${this.app.vault.adapter.getResourcePath(path).replace(
        /"/g,
        '\\"',
      )}")`;
      preview.style.backgroundSize =
        board.settings.backgroundFit === "repeat" ? "420px auto" : board.settings.backgroundFit;
      preview.style.backgroundRepeat =
        board.settings.backgroundFit === "repeat" ? "repeat" : "no-repeat";
    } else {
      preview.addClass("is-empty");
      preview.createSpan({ text: path ? "Image missing" : "No image" });
    }
    const info = row.createDiv({ cls: "cb-background-info" });
    info.createDiv({
      cls: "cb-settings-label",
      text: exists ? fileName(path) : "Custom background",
    });
    info.createDiv({
      cls: "cb-settings-desc",
      text: exists ? path : "Use a photograph or texture from your vault as the board surface.",
    });
    const backgroundActions = info.createDiv({ cls: "cb-background-actions" });

    const applyBackground = (next: string): void => {
      this.host.updateBoardSettings({ customBackground: next });
      this.onOpen();
    };

    const fromVault = backgroundActions.createEl("button", {
      cls: "cb-ghost-button cb-small-button",
      text: "Choose from vault…",
      attr: { type: "button" },
    });
    fromVault.addEventListener("click", () => {
      new ImagePickerModal(
        this.app,
        (file) => applyBackground(file.path),
        board.theme,
      ).open();
    });
    const fromDisk = backgroundActions.createEl("button", {
      cls: "cb-ghost-button cb-small-button",
      text: "From disk…",
      attr: { type: "button" },
    });
    fromDisk.addEventListener("click", () => {
      void saveImageFromDisk(this.app, this.host.getAttachmentFolder()).then((file) => {
        if (file) applyBackground(file.path);
      });
    });
    if (path) {
      const clear = backgroundActions.createEl("button", {
        cls: "cb-ghost-button cb-small-button is-danger",
        text: "Remove",
        attr: { type: "button" },
      });
      clear.addEventListener("click", () => applyBackground(""));
    }

    const bgFitField = this.textField(background, "Image fit", "How the picture fills the board.");
    const bgFitSelect = bgFitField.control.createEl("select", { cls: "cb-select" });
    for (const [id, label] of [
      ["cover", "Fill the board"],
      ["contain", "Fit inside"],
      ["repeat", "Tile"],
    ] as Array<[BackgroundFit, string]>) {
      bgFitSelect.createEl("option", { value: id, text: label });
    }
    bgFitSelect.value = board.settings.backgroundFit;
    bgFitSelect.addEventListener("change", () =>
      this.host.updateBoardSettings({ backgroundFit: bgFitSelect.value as BackgroundFit }),
    );

    const dimField = this.textField(
      background,
      "Dim",
      "Darkens the background so cards stay readable.",
    );
    const dimWrap = dimField.control.createDiv({ cls: "cb-settings-range" });
    const dimInput = dimWrap.createEl("input", {
      cls: "cb-settings-range-input",
      attr: {
        type: "range",
        min: "0",
        max: "0.85",
        step: "0.05",
      },
    });
    dimInput.value = String(board.settings.backgroundDim);
    const dimValue = dimWrap.createSpan({
      cls: "cb-settings-range-value",
      text: `${Math.round(board.settings.backgroundDim * 100)}%`,
    });
    dimInput.addEventListener("input", () => {
      const value = Number(dimInput.value);
      dimValue.textContent = `${Math.round(value * 100)}%`;
      this.host.updateBoardSettings({ backgroundDim: value });
    });

    const feel = this.section(body, "Materials");
    this.toggleField(feel, "Show pins", "Metal pins and magnets on cards.", board.settings.showPins, (value) =>
      this.host.updateBoardSettings({ showPins: value }),
    );
    this.toggleField(
      feel,
      "Snap to grid",
      "Align cards while dragging.",
      board.settings.snapToGrid,
      (value) => this.host.updateBoardSettings({ snapToGrid: value }),
    );
    const gridField = this.textField(feel, "Grid size", "Board units between grid lines.");
    const gridInput = gridField.control.createEl("input", {
      cls: "cb-text-input cb-small-input",
      attr: { type: "number", min: "5", max: "200", step: "5" },
    });
    gridInput.value = String(board.settings.gridSize);
    gridInput.addEventListener("change", () => {
      const value = Number(gridInput.value);
      gridInput.value = String(Number.isFinite(value) ? Math.max(5, Math.min(200, value)) : 20);
      this.host.updateBoardSettings({ gridSize: Number(gridInput.value) });
    });

    const fitField = this.textField(feel, "Photo fit", "How new photographs fill their frame.");
    const fitSelect = fitField.control.createEl("select", { cls: "cb-select" });
    for (const [id, label] of [
      ["cover", "Crop to fill"],
      ["contain", "Fit whole photo"],
    ] as Array<[ImageFit, string]>) {
      fitSelect.createEl("option", { value: id, text: label });
    }
    fitSelect.value = board.settings.imageFit;
    fitSelect.addEventListener("change", () =>
      this.host.updateBoardSettings({ imageFit: fitSelect.value as ImageFit }),
    );

    const threadSection = this.section(body, "New threads");
    const modeField = this.textField(threadSection, "Default physics", "Applied to new threads.");
    const modeSelect = modeField.control.createEl("select", { cls: "cb-select" });
    for (const [id, label] of [
      ["taut", "Taut"],
      ["dynamic", "Dynamic"],
      ["static", "Static"],
    ] as Array<[ThreadMode, string]>) {
      modeSelect.createEl("option", { value: id, text: label });
    }
    modeSelect.value = board.settings.defaultThreadMode;
    modeSelect.addEventListener("change", () =>
      this.host.updateBoardSettings({ defaultThreadMode: modeSelect.value as ThreadMode }),
    );

    const anchorField = this.textField(threadSection, "Default attachment", "Where threads meet a card.");
    const anchorSelect = anchorField.control.createEl("select", { cls: "cb-select" });
    for (const [id, label] of [
      ["auto", "Auto edge"],
      ["pin", "Pin"],
      ["tape", "Tape"],
      ["top", "Top"],
      ["right", "Right"],
      ["bottom", "Bottom"],
      ["left", "Left"],
    ] as Array<[AnchorKind, string]>) {
      anchorSelect.createEl("option", { value: id, text: label });
    }
    anchorSelect.value = board.settings.defaultAnchor;
    anchorSelect.addEventListener("change", () =>
      this.host.updateBoardSettings({ defaultAnchor: anchorSelect.value as AnchorKind }),
    );

    this.toggleField(
      threadSection,
      "Auto tension for new threads",
      "New threads take up their own slack.",
      board.settings.autoTension,
      (value) => this.host.updateBoardSettings({ autoTension: value }),
    );

    const stats = this.section(body, "Contents");
    const statsRow = stats.createDiv({ cls: "cb-settings-stats" });
    this.stat(statsRow, String(board.nodes.length), "cards");
    this.stat(statsRow, String(board.connections.length), "threads");
    this.stat(statsRow, String(board.imports.length), "imports");

    const footer = content.createDiv({ cls: "cb-modal-footer" });
    footer.createDiv({ cls: "cb-import-error" });
    const actions = footer.createDiv({ cls: "cb-modal-actions" });
    const pluginSettings = actions.createEl("button", {
      cls: "cb-ghost-button cb-footer-left",
      attr: { type: "button" },
    });
    setIcon(pluginSettings.createSpan({ cls: "cb-inline-icon" }), "settings-2");
    pluginSettings.createSpan({ text: "Plugin settings" });
    pluginSettings.addEventListener("click", () => {
      this.close();
      this.host.openPluginSettings();
    });
    const done = actions.createEl("button", {
      cls: "cb-primary-button",
      text: "Done",
      attr: { type: "button" },
    });
    done.addEventListener("click", () => this.close());
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private section(parent: HTMLElement, title: string): HTMLElement {
    const section = parent.createDiv({ cls: "cb-settings-section" });
    section.createDiv({ cls: "cb-settings-section-title", text: title });
    return section;
  }

  private textField(
    parent: HTMLElement,
    label: string,
    description: string,
  ): { row: HTMLElement; control: HTMLElement } {
    const row = parent.createDiv({ cls: "cb-settings-row" });
    const text = row.createDiv({ cls: "cb-settings-text" });
    text.createDiv({ cls: "cb-settings-label", text: label });
    text.createDiv({ cls: "cb-settings-desc", text: description });
    const control = row.createDiv({ cls: "cb-settings-control" });
    return { row, control };
  }

  private toggleField(
    parent: HTMLElement,
    label: string,
    description: string,
    value: boolean,
    onChange: (value: boolean) => void,
  ): void {
    const row = this.textField(parent, label, description);
    const control = row.control.createEl("label", { cls: "cb-switch" });
    const input = control.createEl("input", { attr: { type: "checkbox" } });
    input.checked = value;
    control.createSpan({ cls: "cb-switch-track" });
    input.addEventListener("change", () => onChange(input.checked));
  }

  private stat(parent: HTMLElement, value: string, label: string): void {
    const stat = parent.createDiv({ cls: "cb-settings-stat" });
    stat.createDiv({ cls: "cb-settings-stat-value", text: value });
    stat.createDiv({ cls: "cb-settings-stat-label", text: label });
  }
}

function fileName(path: string): string {
  return path.split("/").pop() ?? path;
}
