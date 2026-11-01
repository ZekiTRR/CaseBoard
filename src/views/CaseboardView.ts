import {
  ItemView,
  Menu,
  Notice,
  TFile,
  WorkspaceLeaf,
  ViewStateResult,
  normalizePath,
  setIcon,
  setTooltip,
} from "obsidian";
import type {
  AudioBoardNode,
  BoardConnection,
  BoardDoc,
  BoardNode,
  BoardSettings,
  BoardTool,
  TapeBoardNode,
  TextBoardNode,
  ThemeId,
  Vec2,
} from "../core/types";
import type { BoardStore } from "../core/BoardStore";
import { BoardLoadError } from "../core/BoardStore";
import { BoardHistory } from "../core/BoardHistory";
import { CameraManager } from "../core/CameraManager";
import { FileInfoService } from "../core/FileInfoService";
import {
  bringToFront,
  createAudioNode,
  createImageNode,
  createNoteNode,
  createTapeNode,
  createTextNode,
  findNoteNode,
  nextZ,
  patchFilePaths,
  removeNodes,
  sendToBack,
  touch,
  getNode,
} from "../core/BoardModel";
import { AudioPlayback } from "../audio/Playback";
import { isAudioFileName, peaksFromFile, Recorder, type RecordingTake } from "../audio/Recorder";
import { BoardRenderer } from "../render/BoardRenderer";
import { BoardLoupe } from "../render/BoardLoupe";
import type { NodeViewHost } from "../render/NodeView";
import { applyTheme, applyThemeTokens } from "../render/ThemeManager";
import { getTheme, type BoardTheme } from "../render/themes";
import type { InteractionHost, InteractionSelection } from "../interaction/BoardInteraction";
import { BoardInteraction } from "../interaction/BoardInteraction";
import type { ThreadInspectorHost } from "../ui/ThreadInspector";
import { ThreadInspector } from "../ui/ThreadInspector";
import type { TapeInspectorHost, TapeStylePatch } from "../ui/TapeInspector";
import { TapeInspector } from "../ui/TapeInspector";
import { AudioInspector, type AudioInspectorHost, type AudioStylePatch } from "../ui/AudioInspector";
import type { ContextMenuHost } from "../ui/ContextMenus";
import { ContextMenus } from "../ui/ContextMenus";
import { ColorPickerModal } from "../ui/ColorPickerModal";
import { ConfirmModal } from "../ui/ConfirmModal";
import { RecordHud } from "../ui/RecordHud";
import { Toolbar, type ToolbarActions } from "../ui/Toolbar";
import { ThemePicker } from "../ui/ThemePicker";
import { BoardMenu } from "../ui/BoardMenu";
import { ImportModal } from "../ui/ImportModal";
import { PromptModal } from "../ui/PromptModal";
import { BoardSettingsModal } from "../ui/BoardSettingsModal";
import {
  AudioPickerModal,
  ImagePickerModal,
  NotePickerModal,
  saveAudioFromDisk,
  saveBlobToVault,
  saveImageFromDisk,
  saveImageFile,
} from "../ui/FilePickers";
import { GraphImporter, ImportError, type ImportOptions, type ImportApplyContext } from "../graph/GraphImporter";
import { Debouncer } from "../util/debounce";
import {
  clamp,
  formatZoom,
  isHexColor,
  nodeBounds,
  nodesBounds,
  radToDeg,
  rectsIntersect,
} from "../util/math";
import { DEFAULT_NODE_SIZES } from "../core/types";
import { uid } from "../util/uid";
import { isTextEditing } from "../util/dom";
import { normalizeBoard } from "../persistence/BoardSerializer";

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif"]);
const HISTORY_LIMIT = 64;

type SaveState = "saved" | "dirty" | "saving" | "error";

interface Dock {
  collapsed: boolean;
  collapse(): void;
  expand(): void;
}

interface SettingsAppApi {
  setting?: {
    open(): void;
    openTabById(id: string): void;
  };
}

export class CaseboardView
  extends ItemView
  implements
    InteractionHost,
    ThreadInspectorHost,
    TapeInspectorHost,
    AudioInspectorHost,
    ContextMenuHost,
    ToolbarActions,
    NodeViewHost
{
  private readonly store: BoardStore;
  private readonly fileInfo: FileInfoService;
  private readonly importer: GraphImporter;

  private board: BoardDoc | null = null;
  private boardId: string | null = null;
  private pendingBoardId: string | null = null;
  private initialized = false;
  private loading = false;
  private closing = false;

  private root!: HTMLElement;
  private stage!: HTMLElement;
  private surface!: HTMLElement;
  private boardImage!: HTMLElement;
  private cameraEl!: HTMLElement;
  private nodesLayer!: HTMLElement;
  private overlayLayer!: HTMLElement;
  private threadsSvg!: SVGSVGElement;
  private topbar!: HTMLElement;
  private boardTitleButton!: HTMLButtonElement;
  private boardTitleText!: HTMLElement;
  private saveStateEl!: HTMLElement;
  private saveLabel!: HTMLElement;
  private zoomLabel!: HTMLButtonElement;
  private zoomLabelText = "100%";
  private zoomControlsEl!: HTMLElement;
  private emptyEl!: HTMLElement;
  private loadingEl!: HTMLElement;
  private errorEl!: HTMLElement;
  private errorMessageEl!: HTMLElement;
  private toolHintEl!: HTMLElement;
  private toolHintText!: HTMLElement;
  private toastEl!: HTMLElement;

  private camera: CameraManager | null = null;
  private renderer: BoardRenderer | null = null;
  private loupe: BoardLoupe | null = null;
  private interaction: BoardInteraction | null = null;
  private toolbar: Toolbar | null = null;
  private themePicker: ThemePicker | null = null;
  private boardMenu: BoardMenu | null = null;
  private inspector: ThreadInspector | null = null;
  private tapeInspector: TapeInspector | null = null;
  private audioInspector: AudioInspector | null = null;
  private contextMenus: ContextMenus | null = null;
  private history: BoardHistory | null = null;
  private recorder: Recorder | null = null;
  private recordHud: RecordHud | null = null;
  private recordGhost: HTMLElement | null = null;
  private recordClient: Vec2 | null = null;
  private recordWorldHint: Vec2 | null = null;
  private recording = false;
  private readonly playback = new AudioPlayback({
    onProgress: (nodeId, ratio) => this.renderer?.getNodeView(nodeId)?.updateAudioProgress(ratio),
    onStopped: (nodeId) => this.handleAudioStopped(nodeId),
    onError: (nodeId) => this.handleAudioError(nodeId),
  });

  private saveDebouncer!: Debouncer;
  private fileRefreshDebouncer!: Debouncer;
  private readonly pendingFilePaths = new Set<string>();
  private savingPromise: Promise<void> | null = null;
  private dirty = false;
  private saveState: SaveState = "saved";
  private cameraReady = false;
  private suppressCameraSave = false;

  private tool: BoardTool = "select";
  private selection: InteractionSelection = { nodes: new Set(), connection: null };
  private threadPending = false;
  private editingNodeId: string | null = null;
  private liveThreadEdit = false;
  private liveTapeEdit = false;
  private liveStampEdit = false;
  private liveAudioEdit = false;

  private focusMode = false;
  private leftWasCollapsed = false;
  private rightWasCollapsed = false;
  private errorBoardId: string | null = null;
  private toastTimer: number | null = null;

  constructor(leaf: WorkspaceLeaf, store: BoardStore) {
    super(leaf);
    this.store = store;
    this.fileInfo = new FileInfoService(this.app);
    this.importer = new GraphImporter(this.app);
    this.icon = "pin";
    this.navigation = false;
  }

  getViewType(): string {
    return "caseboard-view";
  }

  getDisplayText(): string {
    return this.board?.name ?? "Caseboard";
  }

  getState(): Record<string, unknown> {
    return { boardId: this.board?.id ?? this.boardId ?? undefined };
  }

  override async setState(state: unknown, _result: ViewStateResult): Promise<void> {
    const boardId =
      typeof state === "object" && state !== null && typeof (state as { boardId?: unknown }).boardId === "string"
        ? (state as { boardId: string }).boardId
        : null;
    if (!boardId) return;
    this.pendingBoardId = boardId;
    if (this.initialized && boardId !== this.board?.id) {
      await this.switchBoard(boardId);
    }
  }

  protected override async onOpen(): Promise<void> {
    this.buildShell();
    this.saveDebouncer = new Debouncer(
      () => void this.performSave(),
      this.store.getSettings().autosaveDelay,
    );
    this.fileRefreshDebouncer = new Debouncer(() => this.flushFileRefresh(), 350);
    this.history = new BoardHistory(HISTORY_LIMIT, () => this.updateHistoryButtons());
    await this.store.init();

    const viewState = this.leaf.getViewState().state;
    const stateBoardId = typeof viewState?.boardId === "string" ? viewState.boardId : null;
    const desired = this.pendingBoardId ?? stateBoardId;
    this.initialized = true;
    await this.openBoardInternal(desired, true);
    this.bindEvents();
    this.root.focus({ preventScroll: true });
  }

  protected override async onClose(): Promise<void> {
    this.endInlineEdits();
    this.exitFocusMode();
    this.cancelRecording();
    this.playback.destroy();
    await this.flushSave();
    this.closing = true;
    if (this.toastTimer !== null) window.clearTimeout(this.toastTimer);
    this.saveDebouncer?.dispose();
    this.fileRefreshDebouncer?.dispose();
    this.interaction?.destroy();
    this.interaction = null;
    this.boardMenu?.destroy();
    this.themePicker?.destroy();
    this.inspector?.destroy();
    this.tapeInspector?.destroy();
    this.audioInspector?.destroy();
    this.loupe?.destroy();
    this.renderer?.destroy();
    this.camera?.destroy();
    this.toolbar?.destroy();
    this.recordHud?.destroy();
    this.recordHud = null;
    this.root?.empty();
    this.contentEl.removeClass("caseboard-content");
    document.body.classList.remove("caseboard-focus-mode");
  }

  // ---------------------------------------------------------------- shell

  private buildShell(): void {
    this.contentEl.empty();
    this.contentEl.addClass("caseboard-content");
    this.root = this.contentEl.createDiv({ cls: "caseboard-root" });
    this.root.tabIndex = 0;
    this.root.dataset.tool = this.tool;

    this.stage = this.root.createDiv({ cls: "cb-stage" });
    this.surface = this.stage.createDiv({ cls: "cb-surface" });
    this.boardImage = this.stage.createDiv({ cls: "cb-board-image" });
    this.boardImage.hidden = true;
    this.cameraEl = this.stage.createDiv({ cls: "cb-camera" });
    this.threadsSvg = createSvg("svg");
    this.threadsSvg.setAttribute("class", "cb-threads");
    this.threadsSvg.setAttribute("width", "10");
    this.threadsSvg.setAttribute("height", "10");
    this.cameraEl.appendChild(this.threadsSvg);
    this.nodesLayer = this.cameraEl.createDiv({ cls: "cb-nodes" });
    this.overlayLayer = this.cameraEl.createDiv({ cls: "cb-overlay" });
    this.stage.createDiv({ cls: "cb-vignette" });
    this.stage.createDiv({ cls: "cb-light" });

    this.topbar = this.root.createDiv({ cls: "cb-topbar" });
    const brandBlock = this.topbar.createDiv({ cls: "cb-brand-block" });
    const brand = brandBlock.createDiv({ cls: "cb-brand" });
    brand.createSpan({ cls: "cb-brand-dot" });
    brand.createSpan({ cls: "cb-brand-text", text: "CASEBOARD" });

    this.boardTitleButton = brandBlock.createEl("button", {
      cls: "cb-board-title",
      attr: { type: "button", "aria-label": "Switch board" },
    });
    this.boardTitleText = this.boardTitleButton.createSpan({ cls: "cb-board-title-text", text: "Loading…" });
    setIcon(this.boardTitleButton.createSpan({ cls: "cb-board-title-chevron" }), "chevron-down");
    this.boardTitleButton.addEventListener("click", (event) => {
      event.stopPropagation();
      this.boardMenu?.toggle(this.boardTitleButton);
    });

    this.saveStateEl = this.topbar.createDiv({ cls: "cb-save-state is-saved" });
    this.saveStateEl.createSpan({ cls: "cb-save-dot" });
    this.saveLabel = this.saveStateEl.createSpan({ cls: "cb-save-label", text: "Saved" });
    setTooltip(this.saveStateEl, "Board state is stored apart from your notes.");

    this.buildZoomControls();
    this.buildEmptyState();
    this.buildToolHint();
    this.buildToast();
    this.buildErrorScreen();
    this.buildLoading();

    this.toolbar = new Toolbar(this.root, this);
    this.toolbar.setFocusMode(false);
    this.recordHud = new RecordHud(this.root, {
      onStop: () => void this.stopRecording(),
      onCancel: () => this.cancelRecording(),
    });
    this.themePicker = new ThemePicker(this.root, (id) => this.setBoardTheme(id));
    this.boardMenu = new BoardMenu(this.root, {
      getBoards: () => this.getBoardsForMenu(),
      getCurrentBoardId: () => this.board?.id ?? this.boardId,
      getImportCount: () => this.board?.imports.length ?? 0,
      switchBoard: (id) => void this.switchBoard(id),
      createBoard: () => void this.createBoardAction(),
      renameCurrentBoard: () => this.renameCurrentBoard(),
      deleteCurrentBoard: () => this.deleteCurrentBoard(),
      refreshImports: () => void this.refreshImports(),
      openBoardSettings: () => this.openBoardSettings(),
    });
    this.inspector = new ThreadInspector(this.root, this);
    this.tapeInspector = new TapeInspector(this.root, this);
    this.audioInspector = new AudioInspector(this.root, this);
    this.contextMenus = new ContextMenus(this);

    applyTheme(this.root, "cork");
    this.updateSaveState("saved");
  }

  private buildZoomControls(): void {
    const zoom = this.root.createDiv({ cls: "cb-zoom-controls" });
    this.zoomControlsEl = zoom;
    const out = zoom.createEl("button", {
      cls: "cb-zoom-button",
      attr: { type: "button", "aria-label": "Zoom out" },
    });
    setIcon(out, "minus");
    out.addEventListener("click", () => this.camera?.zoomBy(1 / 1.2));
    this.zoomLabel = zoom.createEl("button", {
      cls: "cb-zoom-value",
      text: "100%",
      attr: { type: "button", "aria-label": "Reset zoom" },
    });
    setTooltip(this.zoomLabel, "Reset to 100%");
    this.zoomLabel.addEventListener("click", () => {
      if (!this.camera) return;
      const rect = this.stage.getBoundingClientRect();
      this.camera.zoomAt(1, rect.left + rect.width / 2, rect.top + rect.height / 2);
    });
    const inButton = zoom.createEl("button", {
      cls: "cb-zoom-button",
      attr: { type: "button", "aria-label": "Zoom in" },
    });
    setIcon(inButton, "plus");
    inButton.addEventListener("click", () => this.camera?.zoomBy(1.2));
    zoom.createDiv({ cls: "cb-zoom-separator" });
    const fit = zoom.createEl("button", {
      cls: "cb-zoom-button",
      attr: { type: "button", "aria-label": "Zoom to fit" },
    });
    setIcon(fit, "maximize-2");
    setTooltip(fit, "Zoom to fit (Shift 1)");
    fit.addEventListener("click", () => this.zoomToFit());
    const selectionFit = zoom.createEl("button", {
      cls: "cb-zoom-button",
      attr: { type: "button", "aria-label": "Zoom to selection" },
    });
    setIcon(selectionFit, "scan");
    setTooltip(selectionFit, "Zoom to selection (Shift 2)");
    selectionFit.addEventListener("click", () => this.zoomToSelection());
  }

  private buildEmptyState(): void {
    this.emptyEl = this.root.createDiv({ cls: "cb-empty" });
    const mark = this.emptyEl.createDiv({ cls: "cb-empty-mark" });
    setIcon(mark, "pin");
    this.emptyEl.createDiv({ cls: "cb-eyebrow", text: "Investigation desk" });
    this.emptyEl.createEl("h2", { cls: "cb-empty-title", text: "The board is bare" });
    this.emptyEl.createEl("p", {
      cls: "cb-empty-desc",
      text: "Pin a note, add a photograph, or pull a chain of linked notes out of your vault.",
    });
    const actions = this.emptyEl.createDiv({ cls: "cb-empty-actions" });
    const addNote = actions.createEl("button", {
      cls: "cb-primary-button",
      attr: { type: "button" },
    });
    setIcon(addNote.createSpan({ cls: "cb-inline-icon" }), "sticky-note");
    addNote.createSpan({ text: "Pin a note" });
    addNote.addEventListener("click", () => this.addNote());
    const importBtn = actions.createEl("button", {
      cls: "cb-ghost-button",
      attr: { type: "button" },
    });
    setIcon(importBtn.createSpan({ cls: "cb-inline-icon" }), "download");
    importBtn.createSpan({ text: "Import a chain" });
    importBtn.addEventListener("click", () => this.openImport());
    this.emptyEl.createDiv({
      cls: "cb-empty-hints",
      text: "Drag or scroll to pan · Ctrl + scroll to zoom · Right-click for actions",
    });
    this.emptyEl.toggleAttribute("hidden", true);
  }

  private buildToolHint(): void {
    this.toolHintEl = this.root.createDiv({ cls: "cb-tool-hint" });
    this.toolHintEl.createSpan({ cls: "cb-tool-hint-dot" });
    this.toolHintText = this.toolHintEl.createSpan({ cls: "cb-tool-hint-text" });
    this.toolHintEl.toggleAttribute("hidden", true);
  }

  private buildToast(): void {
    this.toastEl = this.root.createDiv({ cls: "cb-toast", attr: { "aria-live": "polite" } });
    this.toastEl.toggleAttribute("hidden", true);
  }

  private buildLoading(): void {
    this.loadingEl = this.root.createDiv({ cls: "cb-loading" });
    this.loadingEl.createDiv({ cls: "cb-loading-spinner" });
    this.loadingEl.createDiv({ cls: "cb-loading-text", text: "Opening the case file…" });
    this.loadingEl.toggleAttribute("hidden", true);
  }

  private buildErrorScreen(): void {
    this.errorEl = this.root.createDiv({ cls: "cb-error" });
    const mark = this.errorEl.createDiv({ cls: "cb-error-mark" });
    setIcon(mark, "file-warning");
    this.errorEl.createDiv({ cls: "cb-eyebrow", text: "Caseboard" });
    this.errorEl.createEl("h2", { cls: "cb-error-title", text: "This board could not be opened" });
    this.errorMessageEl = this.errorEl.createDiv({ cls: "cb-error-message" });
    this.errorEl.createDiv({
      cls: "cb-error-hint",
      text: "The damaged file is preserved. A backup is used automatically when one exists.",
    });
    const actions = this.errorEl.createDiv({ cls: "cb-error-actions" });
    const retry = actions.createEl("button", { cls: "cb-primary-button", text: "Retry" });
    retry.addEventListener("click", () => {
      if (this.errorBoardId) void this.openBoardInternal(this.errorBoardId, true);
    });
    const newBoard = actions.createEl("button", { cls: "cb-ghost-button", text: "New board" });
    newBoard.addEventListener("click", () => void this.createBoardAction());
    const boards = actions.createEl("button", {
      cls: "cb-ghost-button",
      text: "Other boards",
    });
    boards.addEventListener("click", () => this.boardMenu?.toggle(this.boardTitleButton));
    this.errorEl.toggleAttribute("hidden", true);
  }

  // --------------------------------------------------------------- events

  private bindEvents(): void {
    this.registerDomEvent(this.root, "keydown", this.onKeyDown);
    this.registerDomEvent(this.root, "keyup", this.onRootKeyUp);
    this.registerDomEvent(window, "keyup", this.onWindowKeyUp);
    this.registerDomEvent(window, "blur", () => this.interaction?.setSpaceHeld(false));
    this.registerDomEvent(this.stage, "pointerdown", () => {
      const active = document.activeElement;
      if (active instanceof HTMLElement && active.isContentEditable) return;
      this.root.focus({ preventScroll: true });
    });
    this.registerDomEvent(this.stage, "dragover", this.onDragOver);
    this.registerDomEvent(this.stage, "dragleave", this.onDragLeave);
    this.registerDomEvent(this.stage, "drop", this.onDrop);
    this.registerDomEvent(this.stage, "pointermove", this.onStagePointerMove);

    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (file instanceof TFile) this.queueFileRefresh(file.path);
      }),
    );
    this.registerEvent(
      this.app.vault.on("create", (file) => {
        if (file instanceof TFile) this.queueFileRefresh(file.path);
      }),
    );
    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        this.queueFileRefresh(file.path);
      }),
    );
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", (leaf) => {
        if (this.focusMode && leaf !== this.leaf) this.exitFocusMode();
      }),
    );
    this.registerInterval(
      window.setInterval(() => {
        if (this.dirty && !this.loading) void this.performSave();
      }, 12000),
    );
  }

  private onRootKeyUp = (event: KeyboardEvent): void => {
    if (event.code === "Space") this.interaction?.setSpaceHeld(false);
  };

  private onWindowKeyUp = (event: KeyboardEvent): void => {
    if (event.code === "Space") this.interaction?.setSpaceHeld(false);
  };

  private onKeyDown = (event: KeyboardEvent): void => {
    if (!this.board || this.loading || this.closing) return;
    if (event.defaultPrevented) return;
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (
      isTextEditing(target) ||
      (target &&
        target.closest(
          "input, textarea, select, [contenteditable='true'], [contenteditable='plaintext-only']",
        ))
    ) {
      return;
    }

    const mod = event.ctrlKey || event.metaKey;
    const key = event.key;
    const code = event.code;

    if (event.code === "Space" && !mod) {
      if (target?.closest("button")) return;
      event.preventDefault();
      event.stopPropagation();
      this.interaction?.setSpaceHeld(true);
      return;
    }

    if (key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (this.recording) {
        this.cancelRecording();
        return;
      }
      if (this.loupe?.isActive) {
        this.toggleLoupe();
        return;
      }
      if (this.threadPending || this.tool === "thread" || this.tool === "tape") {
        this.interaction?.cancelPending();
        this.setTool("select");
        return;
      }
      if (this.focusMode) {
        this.exitFocusMode();
        return;
      }
      if (this.selection.nodes.size > 0 || this.selection.connection) {
        this.setSelection([], null);
        return;
      }
    }

    if (mod) {
      if (event.repeat) return;
      const lower = physicalLetter(code) ?? key.toLowerCase();
      if (lower === "z") {
        event.preventDefault();
        event.stopPropagation();
        if (event.shiftKey) this.redo();
        else this.undo();
        return;
      }
      if (lower === "y") {
        event.preventDefault();
        event.stopPropagation();
        this.redo();
        return;
      }
      if (lower === "a") {
        event.preventDefault();
        event.stopPropagation();
        this.setSelection(
          this.board.nodes.map((node) => node.id),
          null,
        );
        return;
      }
      if (lower === "s") {
        event.preventDefault();
        event.stopPropagation();
        this.saveNow();
        return;
      }
      if (lower === "d") {
        event.preventDefault();
        event.stopPropagation();
        this.duplicateSelection();
        return;
      }
      return;
    }

    const buttonFocused = Boolean(target?.closest("button"));

    if ((key === "Delete" || key === "Backspace") && !buttonFocused) {
      event.preventDefault();
      event.stopPropagation();
      this.deleteSelection();
      return;
    }
    if (key === "Enter") {
      if (!buttonFocused && this.selection.nodes.size === 1) {
        event.preventDefault();
        event.stopPropagation();
        this.openNode([...this.selection.nodes][0]);
      }
      return;
    }
    if (key === "ArrowLeft" || key === "ArrowRight" || key === "ArrowUp" || key === "ArrowDown") {
      if (buttonFocused || this.selection.nodes.size === 0) return;
      event.preventDefault();
      event.stopPropagation();
      const step = event.shiftKey ? 10 : 1;
      const dx = key === "ArrowLeft" ? -step : key === "ArrowRight" ? step : 0;
      const dy = key === "ArrowUp" ? -step : key === "ArrowDown" ? step : 0;
      this.nudgeSelection(dx, dy);
      return;
    }
    if (code === "Digit1" && event.shiftKey) {
      event.preventDefault();
      this.zoomToFit();
      return;
    }
    if (code === "Digit2" && event.shiftKey) {
      event.preventDefault();
      this.zoomToSelection();
      return;
    }
    if (code === "Digit0") {
      event.preventDefault();
      if (this.camera) {
        const rect = this.stage.getBoundingClientRect();
        this.camera.zoomAt(1, rect.left + rect.width / 2, rect.top + rect.height / 2);
      }
      return;
    }
    if (code === "Equal" || code === "NumpadAdd" || key === "+" || key === "=") {
      event.preventDefault();
      if (this.loupe?.isActive) this.loupe.adjustZoom(1.2);
      else this.camera?.zoomBy(1.2);
      return;
    }
    if (code === "Minus" || code === "NumpadSubtract" || key === "-") {
      event.preventDefault();
      if (this.loupe?.isActive) this.loupe.adjustZoom(1 / 1.2);
      else this.camera?.zoomBy(1 / 1.2);
      return;
    }
    const lower = physicalLetter(code) ?? key.toLowerCase();
    if (lower === "v") {
      event.preventDefault();
      this.setTool("select");
      return;
    }
    if (lower === "h") {
      event.preventDefault();
      this.setTool("pan");
      return;
    }
    if (lower === "g") {
      event.preventDefault();
      this.setTool("tape");
      return;
    }
    if (lower === "c") {
      event.preventDefault();
      this.setTool("thread");
      return;
    }
    if (lower === "n") {
      event.preventDefault();
      this.addNote();
      return;
    }
    if (lower === "t") {
      event.preventDefault();
      this.addText();
      return;
    }
    if (lower === "i") {
      event.preventDefault();
      this.addImageFromVault();
      return;
    }
    if (lower === "z") {
      event.preventDefault();
      this.toggleLoupe();
      return;
    }
    if (lower === "r") {
      event.preventDefault();
      this.toggleRecord();
      return;
    }
    if (lower === "f") {
      event.preventDefault();
      this.toggleFocus();
    }
  };

  // ---------------------------------------------------------------- board

  private async openBoardInternal(boardId: string | null, initial: boolean): Promise<void> {
    this.setLoading(true);
    this.endInlineEdits();
    try {
      const loaded = boardId
        ? await this.store.loadBoard(boardId)
        : await this.store.ensureInitialBoard();
      await this.applyLoadedBoard(loaded.doc, loaded.warnings, initial);
    } catch (error) {
      this.setLoading(false);
      if (!initial && this.board) {
        const message = error instanceof Error ? error.message : "The board could not be opened.";
        new Notice(`Caseboard: ${message}`);
        this.setSaveState(this.dirty ? "dirty" : "saved");
        return;
      }
      this.showLoadError(error, boardId);
    }
  }

  private async applyLoadedBoard(doc: BoardDoc, warnings: string[], initial: boolean): Promise<void> {
    this.closePopovers();
    this.cancelRecording();
    this.playback.stop();
    this.board = doc;
    this.boardId = doc.id;
    this.store.setLastBoardId(doc.id);
    this.fileInfo.invalidateAll();
    this.repairMissingPaths(doc);
    applyTheme(this.root, doc.theme);
    this.updateBoardTitle();
    this.updateBoardBackground();

    this.ensureScene();
    this.cameraReady = false;
    this.suppressCameraSave = true;
    if (!this.camera) throw new Error("Caseboard: camera was not initialised.");
    this.camera.set(doc.camera, { notify: false });
    if (doc.nodes.length === 0 && doc.camera.x === 0 && doc.camera.y === 0) {
      const size = this.camera.viewportSize();
      if (size.width > 0 && size.height > 0) {
        this.camera.set(
          { x: size.width / 2, y: size.height / 2, zoom: doc.camera.zoom || 1 },
          { notify: false },
        );
        doc.camera = this.camera.value;
      }
    }
    this.cameraReady = true;
    this.suppressCameraSave = false;
    this.updateZoomLabel(this.camera.zoom);

    this.dirty = false;
    this.saveDebouncer.setDelay(this.store.getSettings().autosaveDelay);
    this.saveDebouncer.cancel();
    this.setSaveState("saved");

    this.endInlineEdits();
    this.selection = { nodes: new Set(), connection: null };
    this.threadPending = false;
    this.setToolInternal("select");
    this.toolbar?.updateHistory(false, false);
    this.history?.clear();
    this.inspector?.setConnection(null);
    this.tapeInspector?.setTape(null);
    this.audioInspector?.setAudio(null);

    this.renderer?.setBoard(doc);
    if (!this.renderer) throw new Error("Caseboard: renderer was not initialised.");
    this.renderer.refreshSelection(new Set(), null);
    this.ensureInteraction();

    this.errorEl.toggleAttribute("hidden", true);
    this.root.classList.remove("is-error");
    this.stage.classList.remove("is-disabled");
    this.toolbar?.el.removeAttribute("hidden");
    this.zoomControlsEl.removeAttribute("hidden");
    this.root.classList.add("has-board");
    this.root.classList.remove("has-selection");
    this.setLoading(false);
    this.updateEmptyState();
    this.updateToolHint();
    this.root.focus({ preventScroll: true });

    if (warnings.length > 0) {
      new Notice(`Caseboard: ${warnings.join(" ")}`, 9000);
    }
    if (warnings.length > 0) this.showToast(warnings[0], "warn");
    if (!initial && this.board) {
      // A short grounding beat when a different case is opened.
      this.renderer.wakeAnimation();
    }
    this.updateHistoryButtons();
  }

  private ensureScene(): void {
    if (!this.camera) {
      this.camera = new CameraManager(
        {
          stage: this.stage,
          camera: this.cameraEl,
          surface: this.surface,
          root: this.root,
        },
        this.board?.camera ?? { x: 0, y: 0, zoom: 1 },
        (zoom) => this.onCameraChanged(zoom),
      );
    }
    if (!this.renderer) {
      this.renderer = new BoardRenderer({
        camera: this.cameraEl,
        nodes: this.nodesLayer,
        threads: this.threadsSvg,
        overlay: this.overlayLayer,
        getBoard: () => this.board,
        fileInfo: this.fileInfo,
        nodeHost: this,
      });
    }
  }

  private ensureInteraction(): void {
    if (this.interaction) {
      this.interaction.handleToolChanged();
      return;
    }
    this.interaction = new BoardInteraction(this.stage, this);
    this.interaction.setSpaceHeld(false);
    this.interaction.handleToolChanged();
  }

  private showLoadError(error: unknown, boardId: string | null): void {
    this.errorBoardId = boardId ?? this.boardId;
    this.board = null;
    this.boardId = this.errorBoardId;
    this.dirty = false;
    this.saveDebouncer?.cancel();
    this.renderer?.clear();
    this.camera?.cancelTween();
    this.selection = { nodes: new Set(), connection: null };
    this.history?.clear();
    this.root.classList.add("is-error");
    this.toolbar?.el.toggleAttribute("hidden", true);
    this.zoomControlsEl?.toggleAttribute("hidden", true);
    this.emptyEl?.toggleAttribute("hidden", true);
    this.inspector?.setConnection(null);
    this.tapeInspector?.setTape(null);
    this.audioInspector?.setAudio(null);
    this.closePopovers();
    this.applyErrorTheme();
    this.root.classList.remove("has-board", "has-selection");
    this.stage.classList.add("is-disabled");
    const meta = boardId ? this.store.getBoardMeta(boardId) : null;
    this.boardTitleText.textContent = meta?.name ?? "Board unavailable";
    setTooltip(this.boardTitleButton, "Unavailable board");
    const message =
      error instanceof BoardLoadError
        ? [error.message, ...error.warnings].join(" ")
        : error instanceof Error
          ? error.message
          : "The board file could not be read.";
    this.errorMessageEl.textContent = message;
    this.errorEl.removeAttribute("hidden");
    this.loadingEl.toggleAttribute("hidden", true);
    this.setSaveState("error");
    this.updateToolHint();
  }

  private applyErrorTheme(): void {
    const meta = this.errorBoardId ? this.store.getBoardMeta(this.errorBoardId) : null;
    applyTheme(this.root, meta?.theme ?? "cork");
  }

  private setLoading(visible: boolean): void {
    this.loading = visible;
    this.loadingEl.toggleAttribute("hidden", !visible);
  }

  async switchBoard(boardId: string): Promise<void> {
    if (this.board?.id === boardId) return;
    if (!this.initialized) {
      this.pendingBoardId = boardId;
      return;
    }
    this.endInlineEdits();
    await this.flushSave();
    await this.openBoardInternal(boardId, false);
  }

  private repairMissingPaths(doc: BoardDoc): boolean {
    let changed = false;
    for (const node of doc.nodes) {
      if (node.type !== "note" && node.type !== "image") continue;
      if (this.app.vault.getAbstractFileByPath(node.file)) continue;
      const name = node.file.split("/").pop() ?? node.file;
      const resolved = this.app.metadataCache.getFirstLinkpathDest(name, "");
      if (resolved instanceof TFile && resolved.path !== node.file) {
        node.file = resolved.path;
        changed = true;
      }
    }
    for (const group of doc.imports) {
      if (this.app.vault.getAbstractFileByPath(group.sourcePath)) continue;
      const name = (group.sourcePath.split("/").pop() ?? group.sourcePath).replace(/\.md$/i, "");
      const resolved = this.app.metadataCache.getFirstLinkpathDest(name, "");
      if (resolved instanceof TFile && resolved.extension === "md") {
        group.sourcePath = resolved.path;
        changed = true;
      }
    }
    if (changed) {
      touch(doc);
      this.markDirty();
    }
    return changed;
  }

  // -------------------------------------------------------------- chrome

  private updateBoardTitle(): void {
    if (!this.board) {
      this.boardTitleText.textContent = "Caseboard";
      return;
    }
    this.boardTitleText.textContent = this.board.name;
    setTooltip(this.boardTitleButton, "Switch board");
    this.root.dataset.boardId = this.board.id;
  }

  private updateEmptyState(): void {
    const visible = Boolean(this.board && this.board.nodes.length === 0 && !this.loading);
    this.emptyEl?.toggleAttribute("hidden", !visible);
    this.root.classList.toggle("is-empty", visible);
  }

  private updateSaveState(state: SaveState): void {
    const labels: Record<SaveState, string> = {
      saved: "Saved",
      dirty: "Unsaved",
      saving: "Saving…",
      error: "Save failed",
    };
    this.saveState = state;
    this.saveStateEl.classList.remove("is-saved", "is-dirty", "is-saving", "is-error");
    this.saveStateEl.classList.add(`is-${state}`);
    this.saveLabel.textContent = labels[state];
  }

  private setSaveState(state: SaveState): void {
    if (this.saveState === state) return;
    this.updateSaveState(state);
  }

  private onCameraChanged(zoom: number): void {
    this.updateZoomLabel(zoom);
    this.loupe?.syncCamera();
    if (!this.cameraReady || this.suppressCameraSave || !this.board) return;
    this.board.camera = this.camera?.value ?? this.board.camera;
    this.markDirty();
  }

  private updateZoomLabel(zoom: number): void {
    if (!this.zoomLabel) return;
    const next = formatZoom(zoom);
    if (next === this.zoomLabelText) return;
    this.zoomLabelText = next;
    this.zoomLabel.textContent = next;
  }

  private updateHistoryButtons(): void {
    this.toolbar?.updateHistory(this.history?.canUndo ?? false, this.history?.canRedo ?? false);
  }

  private updateToolHint(): void {
    if (!this.toolHintEl) return;
    if (this.recording) {
      this.toolHintEl.removeAttribute("hidden");
      this.toolHintText.textContent = "Recording · move the card where it should land · R stops, Esc discards";
      return;
    }
    const visible =
      Boolean(this.board) && (this.tool === "thread" || this.tool === "pan" || this.tool === "tape");
    this.toolHintEl.toggleAttribute("hidden", !visible);
    if (!visible) return;
    this.toolHintText.textContent =
      this.tool === "tape"
        ? "Drag to lay a tape strip · click for a short piece · Esc to finish"
        : this.tool === "pan"
          ? "Drag to move around the board · Ctrl + scroll to zoom"
          : this.threadPending
            ? "Choose the second card to tie the thread · Esc to cancel"
            : "Choose the first card for the thread · Esc to cancel";
  }

  private showToast(message: string, tone: "info" | "success" | "warn" | "error" = "success"): void {
    if (!this.toastEl) return;
    this.toastEl.textContent = message;
    this.toastEl.classList.remove("is-info", "is-success", "is-warn", "is-error");
    this.toastEl.classList.add(`is-${tone}`);
    this.toastEl.removeAttribute("hidden");
    if (this.toastTimer !== null) window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      this.toastEl.setAttribute("hidden", "true");
      this.toastTimer = null;
    }, 3200);
  }

  private closePopovers(): void {
    this.boardMenu?.close();
    this.themePicker?.close();
  }

  private getBoardsForMenu(): ReturnType<BoardStore["getBoards"]> {
    const boards = this.store.getBoards();
    if (!this.board) return boards;
    const index = boards.findIndex((board) => board.id === this.board?.id);
    const current = {
      id: this.board.id,
      name: this.board.name,
      theme: this.board.theme,
      createdAt: this.board.createdAt,
      updatedAt: this.board.updatedAt,
    };
    if (index === -1) return [current, ...boards];
    boards[index] = current;
    return boards.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  // -------------------------------------------------------------- saving

  markDirty(): void {
    if (!this.board || this.closing) return;
    this.dirty = true;
    this.saveDebouncer.setDelay(this.store.getSettings().autosaveDelay);
    this.saveDebouncer.schedule();
    this.setSaveState("dirty");
  }

  private async performSave(): Promise<void> {
    if (this.savingPromise) return this.savingPromise;
    if (!this.board || !this.dirty) return;
    const board = this.board;
    this.dirty = false;
    this.setSaveState("saving");
    this.toolbar?.setSaving(true);
    this.savingPromise = (async () => {
      try {
        await this.store.saveBoard(board);
        if (this.board?.id === board.id) {
          this.setSaveState(this.dirty ? "dirty" : "saved");
        }
      } catch (error) {
        console.error("Caseboard: save failed", error);
        this.dirty = true;
        this.setSaveState("error");
        new Notice("Caseboard: the board could not be saved.");
      } finally {
        this.toolbar?.setSaving(false);
        this.savingPromise = null;
      }
    })();
    await this.savingPromise;
    if (this.dirty && !this.closing) {
      this.saveDebouncer.schedule();
    }
  }

  private async flushSave(): Promise<void> {
    this.saveDebouncer.cancel();
    await this.performSave();
    this.saveDebouncer.cancel();
    await this.performSave();
  }

  async flushForUnload(): Promise<void> {
    this.endInlineEdits();
    await this.flushSave();
  }

  getBoardId(): string | null {
    return this.boardId;
  }

  saveNow(): void {
    this.saveDebouncer.cancel();
    void this.performSave().then(() => {
      if (!this.dirty && this.board) this.showToast("Board saved", "success");
      this.root.focus({ preventScroll: true });
    });
  }

  // ----------------------------------------------------------- board meta

  private async createBoardAction(): Promise<void> {
    this.endInlineEdits();
    await this.flushSave();
    try {
      const doc = await this.store.createBoard();
      await this.openBoardInternal(doc.id, false);
      this.showToast("A new investigation is open", "success");
    } catch (error) {
      new Notice(
        `Caseboard: could not create a board. ${error instanceof Error ? error.message : ""}`.trim(),
      );
    }
  }

  private renameCurrentBoard(): void {
    if (!this.board) return;
    new PromptModal(this.app, {
      title: "Rename investigation",
      description: "Give this case a name. It is stored with the board, not in your notes.",
      value: this.board.name,
      cta: "Rename",
      theme: this.board.theme,
      placeholder: "The Vanishing Archive",
      onSave: (value) => {
        if (!this.board) return "The board is not loaded.";
        if (value === this.board.name) return null;
        this.board.name = value;
        touch(this.board);
        this.updateBoardTitle();
        this.markDirty();
        this.saveDebouncer.cancel();
        void this.performSave();
        return null;
      },
    }).open();
  }

  private deleteCurrentBoard(): void {
    if (!this.board) return;
    const board = this.board;
    const proceed = async (): Promise<void> => {
      this.saveDebouncer.cancel();
      this.dirty = false;
      this.endInlineEdits();
      try {
        const next = await this.store.deleteBoard(board.id);
        this.board = null;
        await this.openBoardInternal(next?.id ?? null, false);
        new Notice(`Caseboard: “${board.name}” was moved to the trash.`);
      } catch (error) {
        this.dirty = true;
        new Notice(
          `Caseboard: the board could not be deleted. ${
            error instanceof Error ? error.message : ""
          }`.trim(),
        );
      }
    };

    if (!this.store.getSettings().confirmDeleteBoard) {
      void proceed();
      return;
    }
    const modal = new ConfirmModal(
      this.app,
      {
        heading: "Delete this board?",
        body: `“${board.name}” and its threads will be removed. Source notes are not touched.`,
        confirmText: "Delete board",
        cancelText: "Cancel",
        destructive: true,
      },
      () => {
        void proceed();
      },
    );
    modal.modalEl.addClass("caseboard-modal", "cb-confirm-modal");
    applyThemeTokens(modal.modalEl, board.theme);
    modal.open();
  }

  setBoardName(name: string): void {
    if (!this.board) return;
    const value = name.trim();
    if (!value) return;
    this.board.name = value;
    touch(this.board);
    this.updateBoardTitle();
    this.markDirty();
  }

  setBoardTheme(id: ThemeId): void {
    if (!this.board || this.board.theme === id) return;
    this.board.theme = id;
    applyTheme(this.root, id);
    touch(this.board);
    this.markDirty();
    this.toolbar?.setSaving(false);
  }

  updateBoardSettings(patch: Partial<BoardSettings>): void {
    if (!this.board) return;
    this.board.settings = { ...this.board.settings, ...patch };
    if (patch.showPins !== undefined) this.renderer?.refreshPins(patch.showPins);
    if (
      patch.customBackground !== undefined ||
      patch.backgroundFit !== undefined ||
      patch.backgroundDim !== undefined
    ) {
      this.updateBoardBackground();
      this.loupe?.refresh();
    }
    touch(this.board);
    this.markDirty();
  }

  private updateBoardBackground(): void {
    const settings = this.board?.settings;
    const path = settings?.customBackground?.trim() ?? "";
    const file = path ? this.app.vault.getAbstractFileByPath(path) : null;
    if (!settings || !(file instanceof TFile)) {
      this.boardImage.setCssProps({ "--cb-bg-src": "none" });
      this.boardImage.hidden = true;
      this.root.classList.remove("has-background-image");
      return;
    }
    const src = this.app.vault.adapter.getResourcePath(path);
    this.boardImage.setCssProps({ "--cb-bg-src": `url("${src.replace(/"/g, '\\"')}")` });
    this.boardImage.removeClass("is-cover", "is-contain", "is-repeat");
    this.boardImage.addClass(`is-${settings.backgroundFit}`);
    this.root.style.setProperty("--cb-bg-dim", String(settings.backgroundDim));
    this.boardImage.hidden = false;
    this.root.classList.add("has-background-image");
  }

  resetCamera(): void {
    this.zoomToFit();
  }

  openBoardSettings(): void {
    if (!this.board) return;
    new BoardSettingsModal(this.app, {
      getBoard: () => this.requireBoard(),
      setBoardName: (name) => this.setBoardName(name),
      setTheme: (id) => this.setBoardTheme(id),
      updateBoardSettings: (patch) => this.updateBoardSettings(patch),
      getAttachmentFolder: () => this.getAttachmentFolder(),
      openPluginSettings: () => this.openPluginSettings(),
      resetCamera: () => this.resetCamera(),
    }).open();
  }

  private openPluginSettings(): void {
    const api = (this.app as unknown as SettingsAppApi).setting;
    if (!api) {
      new Notice("Caseboard: open Obsidian settings → Community plugins → Caseboard.");
      return;
    }
    api.open();
    api.openTabById("caseboard");
  }

  // ------------------------------------------------------------- toolbar

  getTool(): BoardTool {
    return this.tool;
  }

  setTool(tool: BoardTool): void {
    if (tool === this.tool) return;
    this.endInlineEdits();
    this.setToolInternal(tool);
    this.root.focus({ preventScroll: true });
  }

  private setToolInternal(tool: BoardTool): void {
    this.tool = tool;
    this.root.dataset.tool = tool;
    this.toolbar?.updateTool(tool);
    this.interaction?.handleToolChanged();
    this.updateToolHint();
  }

  addNote(): void {
    if (!this.board) return;
    new NotePickerModal(
      this.app,
      (file) => this.addNoteFromPath(file.path),
      (file) => Boolean(this.board?.nodes.some((node) => node.type === "note" && node.file === file.path)),
      this.board.theme,
    ).open();
  }

  addText(): void {
    this.addTextAt();
  }

  addImage(event: MouseEvent): void {
    const menu = new Menu();
    menu.addItem((item) =>
      item
        .setTitle("From vault…")
        .setIcon("image")
        .onClick(() => this.addImageFromVault()),
    );
    menu.addItem((item) =>
      item
        .setTitle("From disk…")
        .setIcon("upload")
        .onClick(() => void this.addImageFromDisk()),
    );
    menu.showAtMouseEvent(event);
  }

  openImport(): void {
    if (!this.board) return;
    this.openImportDialog();
  }

  openThemePicker(anchor: HTMLElement): void {
    if (!this.board) return;
    this.themePicker?.toggle(anchor, this.board.theme);
  }

  undo(): void {
    if (!this.board || !this.history) return;
    this.endInlineEdits();
    this.playback.stop();
    this.interaction?.cancelActive();
    const entry = this.history.undo();
    if (!entry) return;
    this.applyHistorySnapshot(entry.before);
    this.updateHistoryButtons();
  }

  redo(): void {
    if (!this.board || !this.history) return;
    this.endInlineEdits();
    this.playback.stop();
    this.interaction?.cancelActive();
    const entry = this.history.redo();
    if (!entry) return;
    this.applyHistorySnapshot(entry.after);
    this.updateHistoryButtons();
  }

  canUndo(): boolean {
    return this.history?.canUndo ?? false;
  }

  canRedo(): boolean {
    return this.history?.canRedo ?? false;
  }

  toggleFocus(): void {
    if (this.focusMode) this.exitFocusMode();
    else this.enterFocusMode();
  }

  toggleLoupe(): void {
    if (!this.camera) return;
    if (!this.loupe) {
      this.loupe = new BoardLoupe(
        this.stage,
        this.cameraEl,
        this.surface,
        this.root,
        this.camera,
      );
    }
    const active = this.loupe.toggle();
    this.toolbar?.setLoupe(active);
    if (active) {
      this.showToast("Loupe · scroll to change magnification · move to inspect · Z to hide", "info");
    }
  }

  private enterFocusMode(): void {
    if (this.focusMode) return;
    this.focusMode = true;
    const left = this.app.workspace.leftSplit as unknown as Dock;
    const right = this.app.workspace.rightSplit as unknown as Dock;
    this.leftWasCollapsed = left?.collapsed ?? true;
    this.rightWasCollapsed = right?.collapsed ?? true;
    left?.collapse();
    right?.collapse();
    document.body.classList.add("caseboard-focus-mode");
    this.root.classList.add("is-focus");
    this.toolbar?.setFocusMode(true);
    this.showToast("Focus mode · Esc to leave", "info");
    this.root.focus({ preventScroll: true });
  }

  exitFocusMode(): void {
    if (!this.focusMode) return;
    this.focusMode = false;
    const left = this.app.workspace.leftSplit as unknown as Dock;
    const right = this.app.workspace.rightSplit as unknown as Dock;
    if (this.leftWasCollapsed) left?.collapse();
    else left?.expand();
    if (this.rightWasCollapsed) right?.collapse();
    else right?.expand();
    document.body.classList.remove("caseboard-focus-mode");
    this.root?.classList.remove("is-focus");
    this.toolbar?.setFocusMode(false);
  }

  // --------------------------------------------------------- interaction

  getBoard(): BoardDoc {
    return this.board as BoardDoc;
  }

  getCamera(): CameraManager {
    if (!this.camera) throw new Error("Caseboard: camera is not ready.");
    return this.camera;
  }

  getRenderer(): BoardRenderer {
    if (!this.renderer) throw new Error("Caseboard: renderer is not ready.");
    return this.renderer;
  }

  getSelection(): InteractionSelection {
    return { nodes: new Set(this.selection.nodes), connection: this.selection.connection };
  }

  setSelection(nodeIds: Iterable<string>, connection: string | null): void {
    if (!this.board) return;
    const nodes = new Set<string>();
    for (const id of nodeIds) {
      if (this.board.nodes.some((node) => node.id === id)) nodes.add(id);
    }
    const validConnection =
      connection && this.board.connections.some((item) => item.id === connection) ? connection : null;
    this.selection = { nodes, connection: validConnection };
    this.renderer?.refreshSelection(nodes, validConnection);
    const connectionObject = validConnection ? this.getConnection(validConnection) : null;
    this.inspector?.setConnection(connectionObject);
    const single = connectionObject ? null : this.getSelectedAudio();
    this.tapeInspector?.setTape(connectionObject ? null : this.getSelectedTape());
    this.audioInspector?.setAudio(single);
    this.root.classList.toggle("has-selection", nodes.size > 0 || Boolean(validConnection));
  }

  getDefaultThreadColor(): string {
    return this.getTheme().threadPalette[0] ?? "#a62b2f";
  }

  beginHistory(label: string): void {
    if (!this.board) return;
    this.history?.begin(label, JSON.stringify(this.board));
  }

  commitHistory(label?: string): void {
    if (!this.board) return;
    const changed = this.history?.commit(JSON.stringify(this.board), label) ?? false;
    if (changed) {
      touch(this.board);
      this.markDirty();
      this.updateEmptyState();
    }
    this.updateHistoryButtons();
  }

  cancelHistory(): void {
    this.history?.cancel();
    this.updateHistoryButtons();
  }

  onBoardChanged(): void {
    if (!this.board) return;
    touch(this.board);
    this.markDirty();
    this.updateEmptyState();
    this.tapeInspector?.setTape(this.getSelectedTape());
    this.audioInspector?.setAudio(this.getSelectedAudio());
    this.toolbar?.updateHistory(this.history?.canUndo ?? false, this.history?.canRedo ?? false);
  }

  createTextCard(point: Vec2): void {
    this.addTextAt(point);
  }

  connectionCreated(connectionId: string): void {
    this.setSelection([], connectionId);
    this.setToolInternal("select");
    this.showToast("Thread tied", "success");
    this.root.focus({ preventScroll: true });
  }

  onPendingThreadChange(pending: boolean): void {
    this.threadPending = pending;
    this.updateToolHint();
  }

  getTapeToolColor(): string {
    return this.getTheme().tapeColor;
  }

  createTapeStrip(start: Vec2, end: Vec2): void {
    if (!this.board) return;
    const distance = Math.hypot(end.x - start.x, end.y - start.y);
    const dragging = distance >= 4;
    const width = dragging ? Math.max(24, distance) : DEFAULT_NODE_SIZES.tape.width;
    const center = dragging
      ? { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }
      : start;
    const rotation = dragging ? radToDeg(Math.atan2(end.y - start.y, end.x - start.x)) : 0;
    this.history?.begin("Lay tape", JSON.stringify(this.board));
    const tape = createTapeNode({
      position: center,
      accent: this.getTapeToolColor(),
      rotation,
      size: { width, height: DEFAULT_NODE_SIZES.tape.height },
    });
    tape.z = nextZ(this.board);
    this.board.nodes.push(tape);
    this.renderer?.addNode(tape);
    this.setSelection([tape.id], null);
    this.setToolInternal("select");
    this.commitHistory("Lay tape");
    this.root.focus({ preventScroll: true });
  }

  adjustLoupeZoom(factor: number): boolean {
    if (!this.loupe?.isActive) return false;
    this.loupe.adjustZoom(factor);
    return true;
  }

  onNodeContextMenu(nodeId: string, event: MouseEvent): void {
    this.contextMenus?.showNodeMenu(nodeId, event);
  }

  onConnectionContextMenu(connectionId: string, event: MouseEvent): void {
    this.contextMenus?.showConnectionMenu(connectionId, event);
  }

  onBoardContextMenu(point: Vec2, event: MouseEvent): void {
    this.contextMenus?.showBoardMenu(point, event);
  }

  startThreadFrom(nodeId: string): void {
    if (!this.board) return;
    this.setTool("thread");
    this.interaction?.startThreadFrom(nodeId);
    this.showToast("Choose the second card", "info");
  }

  // ------------------------------------------------------------- history

  private applyHistorySnapshot(snapshot: string): void {
    if (!this.board) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(snapshot);
    } catch {
      new Notice("Caseboard: the history entry could not be restored.");
      return;
    }
    const normalized = normalizeBoard(parsed);
    if (!normalized.ok) {
      new Notice("Caseboard: the history entry is invalid.");
      return;
    }
    const previous = this.board;
    const doc = normalized.doc;
    doc.camera = previous.camera;
    doc.name = previous.name;
    doc.theme = previous.theme;
    doc.settings = previous.settings;
    this.board = doc;
    this.fileInfo.invalidateAll();
    applyTheme(this.root, doc.theme);
    this.updateBoardTitle();
    this.renderer?.setBoard(doc);
    this.setSelection([], null);
    this.camera?.set(doc.camera, { notify: false });
    this.updateZoomLabel(this.camera?.zoom ?? doc.camera.zoom);
    this.updateEmptyState();
    this.touchAndSave();
  }

  private touchAndSave(): void {
    if (!this.board) return;
    touch(this.board);
    this.markDirty();
    this.saveDebouncer.cancel();
    void this.performSave();
  }

  private nudgeSelection(dx: number, dy: number): void {
    if (!this.board || this.selection.nodes.size === 0) return;
    this.endInlineEdits();
    const nodes = this.board.nodes.filter(
      (node) => this.selection.nodes.has(node.id) && !node.locked,
    );
    if (nodes.length === 0) return;
    this.history?.begin("Nudge cards", JSON.stringify(this.board));
    for (const node of nodes) {
      node.x += dx;
      node.y += dy;
    }
    this.renderer?.markNodesMoved(nodes.map((node) => node.id));
    this.commitHistory("Nudge cards");
    this.renderer?.wakeAnimation();
  }

  // ---------------------------------------------------------- node actions

  openNode(nodeId: string): void {
    if (!this.board) return;
    const node = getNode(this.board, nodeId);
    if (!node) return;
    if (node.type === "text") {
      this.setSelection([node.id], null);
      this.renderer?.getNodeView(node.id)?.startEditing();
      return;
    }
    if (node.type === "tape") return;
    if (node.type === "audio") {
      this.onAudioToggle(node.id);
      return;
    }
    const file = this.app.vault.getAbstractFileByPath(node.file);
    if (!(file instanceof TFile)) {
      new Notice("Caseboard: the source file could not be found.");
      return;
    }
    void this.app.workspace.openLinkText(node.file, "", true);
  }

  duplicateSelection(): void {
    if (!this.board || this.selection.nodes.size === 0) return;
    this.endInlineEdits();
    const source = this.board.nodes.filter((node) => this.selection.nodes.has(node.id));
    if (source.length === 0) return;
    this.history?.begin("Duplicate cards", JSON.stringify(this.board));
    let z = nextZ(this.board);
    const clones: BoardNode[] = [];
    for (const node of source) {
      const clone = JSON.parse(JSON.stringify(node)) as BoardNode;
      clone.id = uid("n");
      clone.x += 36;
      clone.y += 36;
      clone.z = z++;
      clone.locked = false;
      clone.createdAt = Date.now();
      this.board.nodes.push(clone);
      clones.push(clone);
    }
    this.commitHistory("Duplicate cards");
    for (const clone of clones) this.renderer?.addNode(clone);
    this.setSelection(
      clones.map((node) => node.id),
      null,
    );
    this.clearEditingNode();
    this.showToast(clones.length === 1 ? "Card duplicated" : `${clones.length} cards duplicated`);
    this.root.focus({ preventScroll: true });
  }

  deleteSelection(): void {
    if (!this.board) return;
    this.endInlineEdits();
    if (this.selection.connection) {
      this.deleteConnection(this.selection.connection);
      return;
    }
    if (this.selection.nodes.size === 0) return;
    const ids = new Set(this.selection.nodes);
    const playing = this.playback.activeNode;
    if (playing && ids.has(playing)) this.playback.stop();
    const count = ids.size;
    this.history?.begin(count > 1 ? "Remove cards" : "Remove card", JSON.stringify(this.board));
    removeNodes(this.board, ids);
    for (const id of ids) this.renderer?.removeNode(id);
    this.renderer?.syncConnections();
    this.setSelection([], null);
    this.inspector?.setConnection(null);
    this.commitHistory(count > 1 ? "Remove cards" : "Remove card");
    this.renderer?.wakeAnimation();
    this.updateEmptyState();
    this.showToast(count > 1 ? `${count} cards removed` : "Card removed", "info");
    this.root.focus({ preventScroll: true });
  }

  toggleLockSelection(): void {
    if (!this.board || this.selection.nodes.size === 0) return;
    const nodes = this.board.nodes.filter((node) => this.selection.nodes.has(node.id));
    const makeLocked = !nodes.every((node) => node.locked);
    this.runNodeMutation(makeLocked ? "Lock cards" : "Unlock cards", () => {
      for (const node of nodes) node.locked = makeLocked;
      for (const node of nodes) this.renderer?.refreshNode(node.id);
    });
    this.renderer?.refreshSelection(this.selection.nodes, null);
  }

  bringSelectionToFront(): void {
    if (!this.board || this.selection.nodes.size === 0) return;
    this.runNodeMutation("Bring to front", () => {
      bringToFront(this.board as BoardDoc, this.selection.nodes);
      for (const id of this.selection.nodes) this.renderer?.refreshNode(id);
    });
  }

  sendSelectionToBack(): void {
    if (!this.board || this.selection.nodes.size === 0) return;
    this.runNodeMutation("Send to back", () => {
      sendToBack(this.board as BoardDoc, this.selection.nodes);
      for (const id of this.selection.nodes) this.renderer?.refreshNode(id);
    });
  }

  setVariantForSelection(variant: string): void {
    if (!this.board || this.selection.nodes.size === 0) return;
    this.runNodeMutation("Change card style", () => {
      for (const node of this.board?.nodes ?? []) {
        if (!this.selection.nodes.has(node.id)) continue;
        node.variant = variant;
        this.renderer?.refreshNode(node.id);
      }
    });
  }

  setTextScaleForSelection(scale: number): void {
    if (!this.board || this.selection.nodes.size === 0) return;
    const value = clamp(scale, 0.7, 1.8);
    this.runNodeMutation("Change text size", () => {
      for (const node of this.board?.nodes ?? []) {
        if (!this.selection.nodes.has(node.id)) continue;
        if (node.type !== "note" && node.type !== "text") continue;
        node.fontScale = value;
        this.renderer?.refreshNode(node.id);
      }
    });
  }

  setAccentForSelection(color: string): void {
    if (!this.board || this.selection.nodes.size === 0) return;
    this.runNodeMutation("Change pin colour", () => {
      for (const node of this.board?.nodes ?? []) {
        if (!this.selection.nodes.has(node.id)) continue;
        node.accent = color;
        this.renderer?.refreshNode(node.id);
      }
    });
  }

  replaceImageFromVault(nodeId: string): void {
    if (!this.board) return;
    new ImagePickerModal(
      this.app,
      (file) => this.replaceImage(nodeId, file.path),
      this.board.theme,
    ).open();
  }

  replaceImageFromDisk(nodeId: string): void {
    if (!this.board) return;
    void saveImageFromDisk(this.app, this.store.getSettings().imageFolder).then((file) => {
      if (file) this.replaceImage(nodeId, file.path);
    });
  }

  private replaceImage(nodeId: string, filePath: string): void {
    if (!this.board) return;
    const node = getNode(this.board, nodeId);
    if (!node || node.type !== "image") return;
    this.runNodeMutation("Replace photo", () => {
      node.file = filePath;
      node.caption = filePath.split("/").pop()?.replace(/\.[^.]+$/, "") ?? "";
      this.renderer?.refreshNode(nodeId, true);
    });
    this.root.focus({ preventScroll: true });
  }

  copyPath(nodeId: string): void {
    if (!this.board) return;
    const node = getNode(this.board, nodeId);
    if (!node || (node.type !== "note" && node.type !== "image" && node.type !== "audio")) return;
    void navigator.clipboard.writeText(node.file).then(
      () => new Notice("Caseboard: vault path copied."),
      () => new Notice("Caseboard: could not copy the path."),
    );
  }

  private runNodeMutation(label: string, mutate: () => void): void {
    this.endInlineEdits();
    this.history?.begin(label, JSON.stringify(this.board));
    mutate();
    this.commitHistory(label);
    this.root.focus({ preventScroll: true });
  }

  // ------------------------------------------------------------ add cards

  private addNoteFromPath(filePath: string, at?: Vec2): void {
    if (!this.board) return;
    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (!(file instanceof TFile) || file.extension !== "md") {
      new Notice("Caseboard: the note could not be found.");
      return;
    }
    const existing = findNoteNode(this.board, filePath);
    if (existing) {
      this.setSelection([existing.id], null);
      this.camera?.centerOn({ x: existing.x, y: existing.y }, Math.max(this.camera.zoom, 0.7));
      this.showToast("This note is already on the board", "info");
      return;
    }

    const theme = this.getTheme();
    const position = this.findFreePlacement(280, 209, at ?? this.camera?.worldCenter() ?? { x: 0, y: 0 });
    this.history?.begin("Pin note", JSON.stringify(this.board));
    const node = createNoteNode(filePath, { position, accent: theme.pinColor });
    node.z = nextZ(this.board);
    this.board.nodes.push(node);
    this.commitHistory("Pin note");
    this.renderer?.addNode(node);
    this.setSelection([node.id], null);
    this.renderer?.wakeAnimation();
    this.root.focus({ preventScroll: true });
  }

  addTextAt(point?: Vec2): void {
    if (!this.board) return;
    this.endInlineEdits();
    const theme = this.getTheme();
    const desired = point ?? this.camera?.worldCenter() ?? { x: 0, y: 0 };
    const position = this.findFreePlacement(260, 180, desired);
    this.history?.begin("Add text", JSON.stringify(this.board));
    const node = createTextNode("", { position, accent: theme.pinColor });
    node.z = nextZ(this.board);
    this.board.nodes.push(node);
    this.commitHistory("Add text");
    this.renderer?.addNode(node);
    this.setSelection([node.id], null);
    this.updateEmptyState();
    window.requestAnimationFrame(() => {
      this.renderer?.getNodeView(node.id)?.startEditing();
    });
  }

  addImageAt(filePath: string, point?: Vec2): void {
    if (!this.board) return;
    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (!(file instanceof TFile)) {
      new Notice("Caseboard: the image could not be found.");
      return;
    }
    const theme = this.getTheme();
    const desired = point ?? this.camera?.worldCenter() ?? { x: 0, y: 0 };
    const position = this.findFreePlacement(320, 260, desired);
    this.endInlineEdits();
    this.history?.begin("Add photo", JSON.stringify(this.board));
    const caption = file.basename;
    const node = createImageNode(file.path, caption, this.board.settings.imageFit, {
      position,
      accent: theme.pinColor,
    });
    node.z = nextZ(this.board);
    this.board.nodes.push(node);
    this.commitHistory("Add photo");
    this.renderer?.addNode(node);
    this.setSelection([node.id], null);
    this.updateEmptyState();
    this.root.focus({ preventScroll: true });
  }

  addImageFromVault(point?: Vec2): void {
    if (!this.board) return;
    new ImagePickerModal(
      this.app,
      (file) => this.addImageAt(file.path, point),
      this.board.theme,
    ).open();
  }

  addImageFromDisk(point?: Vec2): void {
    if (!this.board) return;
    this.showToast("Choose a photo…", "info");
    void saveImageFromDisk(this.app, this.store.getSettings().imageFolder).then((file) => {
      if (file) this.addImageAt(file.path, point);
    });
  }

  private findFreePlacement(width: number, height: number, desired: Vec2): Vec2 {
    if (!this.board) return desired;
    const test = (center: Vec2): boolean => {
      const rect = {
        x: center.x - width / 2,
        y: center.y - height / 2,
        width,
        height,
      };
      return !this.board?.nodes.some((node) => rectsIntersect(nodeBounds(node), rect, 24));
    };
    if (test(desired)) return desired;
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 1; i < 120; i++) {
      const radius = 70 * Math.sqrt(i);
      const angle = i * golden;
      const candidate = {
        x: desired.x + Math.cos(angle) * radius,
        y: desired.y + Math.sin(angle) * radius,
      };
      if (test(candidate)) return candidate;
    }
    return desired;
  }

  private clearEditingNode(): void {
    this.editingNodeId = null;
  }

  // -------------------------------------------------------------- import

  openImportDialog(sourceOverride?: string): void {
    if (!this.board) return;
    this.endInlineEdits();
    const settings = this.store.getSettings();
    const selectedNote = this.getSingleSelectedNote();
    const activeFile = this.app.workspace.getActiveFile();
    const source =
      sourceOverride ??
      selectedNote?.file ??
      (activeFile && activeFile.extension === "md" ? activeFile.path : "") ??
      "";
    new ImportModal(this.app, {
      theme: this.board.theme,
      defaults: {
        source,
        depth: settings.importDepth,
        limit: settings.importLimit,
        layout: settings.importLayout,
      },
      onSubmit: (options) => this.importNotes(options),
    }).open();
  }

  private getSingleSelectedNote(): { file: string } | null {
    if (!this.board || this.selection.nodes.size !== 1) return null;
    const node = getNode(this.board, [...this.selection.nodes][0]);
    return node?.type === "note" ? { file: node.file } : null;
  }

  private importNotes(options: ImportOptions): string | null {
    if (!this.board) return "The board is not ready.";
    this.endInlineEdits();
    const theme = this.getTheme();
    const context: ImportApplyContext = {
      viewCenter: this.camera?.worldCenter() ?? { x: 0, y: 0 },
      pinColor: theme.pinColor,
      threadColor: theme.threadPalette[0] ?? "#a62b2f",
    };
    this.history?.begin("Import chain", JSON.stringify(this.board));
    let outcome;
    try {
      outcome = this.importer.importIntoBoard(this.board, options, context);
    } catch (error) {
      this.cancelHistory();
      if (error instanceof ImportError) return error.message;
      console.error("Caseboard: import failed", error);
      return "The import could not be completed.";
    }

    this.commitHistory("Import chain");
    this.renderer?.setBoard(this.board);
    if (outcome.newNodes.length > 0) {
      this.setSelection(
        outcome.newNodes.map((node) => node.id),
        null,
      );
      const bounds = nodesBounds(outcome.newNodes);
      if (bounds) this.camera?.fitTo(bounds, 150, 170);
    } else {
      this.setSelection([], null);
    }
    this.updateEmptyState();
    this.renderer?.wakeAnimation();
    this.fileInfo.invalidateAll();

    const parts: string[] = [];
    if (outcome.addedNodes > 0) parts.push(`${outcome.addedNodes} card${outcome.addedNodes === 1 ? "" : "s"}`);
    if (outcome.addedConnections > 0) {
      parts.push(`${outcome.addedConnections} thread${outcome.addedConnections === 1 ? "" : "s"}`);
    }
    let summary: string;
    if (parts.length > 0) {
      summary = `Imported ${parts.join(" and ")}`;
    } else if (outcome.plan.files.length <= 1) {
      summary = "No linked notes were found";
    } else {
      summary = "Everything in this chain is already on the board";
    }
    if (outcome.truncated) summary += " · card limit reached";
    if (outcome.missingLinks > 0 && outcome.addedNodes > 0) {
      summary += ` · ${outcome.missingLinks} unresolved link${outcome.missingLinks === 1 ? "" : "s"} skipped`;
    }
    new Notice(`Caseboard: ${summary}.`, 6000);
    this.showToast(summary, outcome.addedNodes > 0 ? "success" : "info");
    this.root.focus({ preventScroll: true });
    return null;
  }

  async refreshImports(): Promise<void> {
    if (!this.board) return;
    if (this.board.imports.length === 0) {
      new Notice("Caseboard: this board has no imported chains.");
      return;
    }
    this.endInlineEdits();
    const theme = this.getTheme();
    const context: ImportApplyContext = {
      viewCenter: this.camera?.worldCenter() ?? { x: 0, y: 0 },
      pinColor: theme.pinColor,
      threadColor: theme.threadPalette[0] ?? "#a62b2f",
    };
    const groups = [...this.board.imports];
    this.history?.begin("Refresh imports", JSON.stringify(this.board));
    let addedNodes = 0;
    let addedConnections = 0;
    const failures: string[] = [];
    const fresh: BoardNode[] = [];
    for (const group of groups) {
      try {
        const outcome = this.importer.importIntoBoard(
          this.board,
          {
            source: group.sourcePath,
            mode: group.mode,
            depth: group.depth,
            limit: group.limit,
            layout: group.layout,
            filters: group.filters,
          },
          context,
        );
        addedNodes += outcome.addedNodes;
        addedConnections += outcome.addedConnections;
        fresh.push(...outcome.newNodes);
      } catch (error) {
        failures.push(error instanceof Error ? error.message : String(error));
      }
    }
    this.commitHistory("Refresh imports");
    this.renderer?.setBoard(this.board);
    this.setSelection([], null);
    this.updateEmptyState();
    if (addedNodes + addedConnections === 0) {
      new Notice(
        failures.length > 0
          ? `Caseboard: nothing new was added. ${failures[0]}`
          : "Caseboard: imported chains are already up to date.",
      );
    } else {
      const notice = `Caseboard: refreshed chains — ${addedNodes} new card${
        addedNodes === 1 ? "" : "s"
      }, ${addedConnections} new thread${addedConnections === 1 ? "" : "s"}.`;
      new Notice(notice, 6000);
      this.showToast(notice.replace("Caseboard: ", ""), "success");
      const bounds = nodesBounds(fresh);
      if (bounds) this.camera?.fitTo(bounds, 150, 170);
    }
    this.root.focus({ preventScroll: true });
  }

  // ---------------------------------------------------------- connections

  getConnection(id: string): BoardConnection | null {
    return this.board?.connections.find((connection) => connection.id === id) ?? null;
  }

  getTheme(): BoardTheme {
    return getTheme(this.board?.theme ?? "cork");
  }

  getAttachmentFolder(): string {
    return this.store.getSettings().imageFolder;
  }

  getNodeLabel(nodeId: string): string {
    const node = this.board ? getNode(this.board, nodeId) : null;
    if (!node) return "?";
    if (node.type === "tape") return "Tape";
    if (node.type === "note") {
      const meta = this.fileInfo.getNoteMeta(node.file);
      return meta?.title ?? node.file.split("/").pop()?.replace(/\.md$/i, "") ?? node.file;
    }
    if (node.type === "image") {
      return node.caption || node.file.split("/").pop() || "Photo";
    }
    if (node.type === "audio") {
      return node.caption || node.file.split("/").pop() || "Recording";
    }
    const firstLine = node.text.split("\n").find((line) => line.trim());
    return firstLine ? firstLine.slice(0, 24) : "Text block";
  }

  getSelectedTape(): TapeBoardNode | null {
    if (!this.board || this.selection.nodes.size !== 1) return null;
    const node = getNode(this.board, [...this.selection.nodes][0]);
    return node?.type === "tape" ? node : null;
  }

  beginTapeLiveEdit(label: string): void {
    if (!this.board || this.liveTapeEdit) return;
    this.history?.begin(label, JSON.stringify(this.board));
    this.liveTapeEdit = true;
  }

  updateTapeLive(patch: TapeStylePatch): void {
    const tape = this.getSelectedTape();
    if (!tape) return;
    this.applyTapePatch(tape, patch);
    this.markDirty();
  }

  endTapeLiveEdit(): void {
    if (!this.liveTapeEdit) return;
    this.liveTapeEdit = false;
    this.touchAndSave();
    this.commitHistory();
    this.updateHistoryButtons();
    this.tapeInspector?.setTape(this.getSelectedTape());
  }

  changeTapeStyle(patch: TapeStylePatch, label: string): void {
    if (!this.board) return;
    if (this.liveTapeEdit) this.endTapeLiveEdit();
    const tape = this.getSelectedTape();
    if (!tape) return;
    this.history?.begin(label, JSON.stringify(this.board));
    this.applyTapePatch(tape, patch);
    this.commitHistory(label);
    this.tapeInspector?.setTape(tape);
  }

  deleteSelectedTape(): void {
    this.deleteSelection();
  }

  closeTapeInspector(): void {
    this.setSelection([], null);
  }

  openPinColorPicker(): void {
    if (!this.board || this.selection.nodes.size === 0) return;
    const nodes = this.board.nodes.filter(
      (node) => this.selection.nodes.has(node.id) && node.type !== "tape",
    );
    if (nodes.length === 0) return;
    new ColorPickerModal(this.app, {
      title: "Pin colour",
      description: "Pick any colour for the pins on the selected cards.",
      initial: nodes[0].accent,
      theme: this.board.theme,
      onPick: (color) => this.setAccentForSelection(color),
    }).open();
  }

  private applyTapePatch(tape: TapeBoardNode, patch: TapeStylePatch): void {
    if (patch.accent && isHexColor(patch.accent)) tape.accent = patch.accent;
    if (patch.width !== undefined) tape.width = clamp(patch.width, 24, 2400);
    if (patch.height !== undefined) tape.height = clamp(patch.height, 8, 160);
    this.renderer?.refreshNode(tape.id);
    this.renderer?.markNodeGeometryChanged(tape.id);
  }

  beginLiveEdit(label: string): void {
    if (!this.board || this.liveThreadEdit) return;
    this.finishTextEditing();
    this.history?.begin(label, JSON.stringify(this.board));
    this.liveThreadEdit = true;
  }  updateConnectionLive(id: string, patch: Partial<BoardConnection>): void {
    if (!this.board) return;
    const connection = this.getConnection(id);
    if (!connection) return;
    if (patch.from) {
      if (!getNode(this.board, patch.from.nodeId)) return;
      connection.from = { ...patch.from };
    }
    if (patch.to) {
      if (!getNode(this.board, patch.to.nodeId)) return;
      connection.to = { ...patch.to };
    }
    const { from: _from, to: _to, ...rest } = patch;
    Object.assign(connection, rest);
    this.renderer?.refreshConnection(id);
    this.markDirty();
  }

  endLiveEdit(): void {
    if (!this.liveThreadEdit) return;
    this.liveThreadEdit = false;
    this.touchAndSave();
    this.commitHistory();
    this.updateHistoryButtons();
    const connection = this.selection.connection
      ? this.getConnection(this.selection.connection)
      : null;
    if (connection) this.inspector?.setConnection(connection);
  }

  changeConnection(id: string, patch: Partial<BoardConnection>, label: string): void {
    if (!this.board) return;
    if (this.liveThreadEdit) this.endLiveEdit();
    const connection = this.getConnection(id);
    if (!connection) return;
    this.history?.begin(label, JSON.stringify(this.board));
    if (patch.from) {
      if (!getNode(this.board, patch.from.nodeId)) {
        this.cancelHistory();
        return;
      }
      connection.from = { ...patch.from };
    }
    if (patch.to) {
      if (!getNode(this.board, patch.to.nodeId)) {
        this.cancelHistory();
        return;
      }
      connection.to = { ...patch.to };
    }
    const { from: _from, to: _to, ...rest } = patch;
    Object.assign(connection, rest);
    this.touchAndSave();
    this.commitHistory(label);
    this.renderer?.refreshConnection(id);
    const fresh = this.getConnection(id);
    if (fresh && this.selection.connection === id) this.inspector?.setConnection(fresh);
  }

  deleteConnection(id: string): void {
    if (!this.board) return;
    const connection = this.getConnection(id);
    if (!connection) return;
    if (this.liveThreadEdit) this.endLiveEdit();
    this.history?.begin("Remove thread", JSON.stringify(this.board));
    this.board.connections = this.board.connections.filter((item) => item.id !== id);
    this.renderer?.syncConnections();
    this.setSelection([], null);
    this.inspector?.setConnection(null);
    this.commitHistory("Remove thread");
    this.updateEmptyState();
    this.showToast("Thread removed", "info");
    this.root.focus({ preventScroll: true });
  }

  deselectThread(): void {
    this.setSelection([], null);
    this.root.focus({ preventScroll: true });
  }

  // ---------------------------------------------------------------- audio

  toggleRecord(): void {
    if (this.recording) void this.stopRecording();
    else void this.startRecording();
  }

  private async startRecording(point?: Vec2): Promise<void> {
    if (!this.board || this.recording) return;
    if (!Recorder.supported()) {
      new Notice("Caseboard: this Obsidian build has no microphone recording support.");
      return;
    }
    this.endInlineEdits();
    this.playback.stop();
    const recorder = new Recorder();
    this.recorder = recorder;
    this.recording = true;
    this.recordWorldHint = point ?? null;
    this.root.classList.add("is-recording");
    this.toolbar?.setRecording(true);
    this.showRecordGhost();
    this.updateToolHint();
    this.recordHud?.begin();
    try {
      await recorder.start((level) => this.recordHud?.setLevel(level));
    } catch (error) {
      this.teardownRecording();
      this.recorder = null;
      const denied = error instanceof DOMException && error.name === "NotAllowedError";
      new Notice(
        denied
          ? "Caseboard: microphone access was declined."
          : "Caseboard: the recorder could not be started.",
      );
    }
  }

  private async stopRecording(): Promise<void> {
    const recorder = this.recorder;
    if (!recorder || !this.recording) return;
    const client = this.recordClient;
    const hint = this.recordWorldHint;
    this.teardownRecording();

    let take: RecordingTake | null = null;
    let peaks: number[] = [];
    let duration = 0;
    try {
      take = await recorder.stop();
      duration = (await recorder.durationOf(take)) ?? take.duration;
      peaks = (await recorder.peaks(take)) ?? [];
    } catch {
      take = null;
    } finally {
      recorder.dispose();
      this.recorder = null;
    }

    if (!take || take.blob.size === 0) {
      new Notice("Caseboard: nothing was recorded.");
      return;
    }

    const name = `caseboard-rec-${fileStamp(Date.now())}`;
    const saved = await saveBlobToVault(
      this.app,
      take.blob,
      name,
      take.extension,
      this.getAttachmentFolder(),
    );
    if (!saved) return;

    const point =
      (client ? this.camera?.screenToWorld(client.x, client.y) : undefined) ?? hint ?? undefined;
    this.addAudioCard(saved.path, duration, peaks, "", point, true);
    this.showToast("Recording pinned", "success");
  }

  private cancelRecording(): void {
    if (!this.recording) return;
    this.teardownRecording();
    this.recorder?.cancel();
    this.recorder?.dispose();
    this.recorder = null;
    this.showToast("Recording discarded", "info");
  }

  private teardownRecording(): void {
    this.recording = false;
    this.recordClient = null;
    this.recordWorldHint = null;
    this.root.classList.remove("is-recording");
    this.toolbar?.setRecording(false);
    this.recordHud?.end();
    this.hideRecordGhost();
    this.updateToolHint();
  }

  private showRecordGhost(): void {
    if (this.recordGhost) return;
    const rect = this.stage.getBoundingClientRect();
    const client = this.recordWorldHint
      ? this.camera?.worldToScreen(this.recordWorldHint.x, this.recordWorldHint.y)
      : undefined;
    this.recordClient = client ?? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    const ghost = this.stage.createDiv({ cls: "cb-rec-ghost", text: "Recording lands here" });
    this.recordGhost = ghost;
    this.moveRecordGhost(this.recordClient);
  }

  private hideRecordGhost(): void {
    this.recordGhost?.remove();
    this.recordGhost = null;
  }

  private moveRecordGhost(client: Vec2): void {
    if (!this.recordGhost) return;
    const rect = this.stage.getBoundingClientRect();
    this.recordGhost.setCssProps({
      "--cb-rec-ghost-x": `${client.x - rect.left}px`,
      "--cb-rec-ghost-y": `${client.y - rect.top}px`,
    });
  }

  private onStagePointerMove = (event: PointerEvent): void => {
    if (!this.recording) return;
    this.recordClient = { x: event.clientX, y: event.clientY };
    this.moveRecordGhost(this.recordClient);
  };

  addAudioCard(
    file: string,
    duration: number,
    peaks: number[],
    caption: string,
    point?: Vec2,
    precise = false,
  ): void {
    if (!this.board) return;
    const theme = this.getTheme();
    const size = DEFAULT_NODE_SIZES.audio;
    const desired = point ?? this.camera?.worldCenter() ?? { x: 0, y: 0 };
    const position = precise ? desired : this.findFreePlacement(size.width, size.height, desired);
    this.endInlineEdits();
    this.history?.begin("Add recording", JSON.stringify(this.board));
    const node = createAudioNode(file, duration, peaks, caption, {
      position,
      accent: theme.pinColor,
    });
    node.z = nextZ(this.board);
    this.board.nodes.push(node);
    this.commitHistory("Add recording");
    this.renderer?.addNode(node);
    this.setSelection([node.id], null);
    this.updateEmptyState();
    this.root.focus({ preventScroll: true });
  }

  /** Drops and vault picks land here: the trace is decoded once, then stored in the board. */
  addAudioAt(filePath: string, point?: Vec2): void {
    if (!this.board) return;
    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (!(file instanceof TFile)) {
      new Notice("Caseboard: the recording could not be found.");
      return;
    }
    void this.attachAudioFile(file, point);
  }

  addAudioFromVault(point?: Vec2): void {
    if (!this.board) return;
    new AudioPickerModal(this.app, (file) => this.addAudioAt(file.path, point), this.board.theme).open();
  }

  addAudioFromDisk(point?: Vec2): void {
    if (!this.board) return;
    this.showToast("Choose a recording…", "info");
    void saveAudioFromDisk(this.app, this.getAttachmentFolder()).then((file) => {
      if (file) this.addAudioAt(file.path, point);
    });
  }

  private async attachAudioFile(file: TFile, point?: Vec2): Promise<void> {
    let peaks: number[] = [];
    let duration = 0;
    try {
      const buffer = await this.app.vault.readBinary(file);
      const decoded = await peaksFromFile(buffer);
      if (decoded) {
        peaks = decoded.peaks;
        duration = decoded.duration;
      }
    } catch {
      // Unreadable media still gets a card; the trace falls back to a placeholder.
    }
    this.addAudioCard(file.path, duration, peaks, "", point);
    this.showToast("Recording pinned", "success");
  }

  onAudioToggle(nodeId: string): void {
    if (!this.board) return;
    const node = getNode(this.board, nodeId);
    if (!node || node.type !== "audio") return;

    if (this.playback.playingNode === nodeId) {
      this.playback.pause();
      this.markAudioState(nodeId, "paused");
      return;
    }
    if (this.playback.activeNode === nodeId) {
      this.playback.play(nodeId, this.audioSource(node), 0, node.duration);
      this.markAudioState(nodeId, "playing");
      return;
    }
    const info = this.fileInfo.getImageInfo(node.file);
    if (info.missing || !info.src) {
      this.markAudioMissing(nodeId, true);
      new Notice("Caseboard: the recording could not be found.");
      return;
    }
    this.playback.play(nodeId, info.src, 0, node.duration);
    this.markAudioState(nodeId, "playing");
  }

  onAudioSeek(nodeId: string, ratio: number): void {
    if (!this.board) return;
    const node = getNode(this.board, nodeId);
    if (!node || node.type !== "audio") return;

    if (this.playback.activeNode === nodeId) {
      this.playback.seek(ratio);
      this.markAudioState(nodeId, this.playback.playingNode ? "playing" : "paused");
      return;
    }
    const info = this.fileInfo.getImageInfo(node.file);
    if (info.missing || !info.src) {
      this.markAudioMissing(nodeId, true);
      new Notice("Caseboard: the recording could not be found.");
      return;
    }
    this.playback.play(nodeId, info.src, ratio, node.duration);
    this.markAudioState(nodeId, "playing");
  }

  isAudioPlaying(nodeId: string): boolean {
    return this.playback.playingNode === nodeId;
  }

  recordFromBoardMenu(point?: Vec2): void {
    if (this.recording) void this.stopRecording();
    else void this.startRecording(point);
  }

  onAudioStamp(nodeId: string, scale: number, commit: boolean): void {
    if (!this.board) return;
    if (commit) {
      this.endStampEdit();
      return;
    }
    const node = getNode(this.board, nodeId);
    if (!node || node.type !== "audio") return;
    if (!this.liveStampEdit) {
      this.history?.begin("Resize the date", JSON.stringify(this.board));
      this.liveStampEdit = true;
    }
    node.stampScale = clamp(scale, 0.7, 3);
    touch(this.board);
    this.renderer?.refreshNode(nodeId);
    this.markDirty();
  }

  private endStampEdit(): void {
    if (!this.liveStampEdit) return;
    this.liveStampEdit = false;
    this.touchAndSave();
    this.commitHistory();
    this.updateHistoryButtons();
  }

  getSelectedAudio(): AudioBoardNode | null {
    if (!this.board || this.selection.nodes.size !== 1) return null;
    const node = getNode(this.board, [...this.selection.nodes][0]);
    return node?.type === "audio" ? node : null;
  }

  beginAudioLiveEdit(label: string): void {
    if (!this.board || this.liveAudioEdit) return;
    this.history?.begin(label, JSON.stringify(this.board));
    this.liveAudioEdit = true;
  }

  /** Scale grows the box and the drawing together; the date only changes its own type size. */
  updateAudioLive(patch: AudioStylePatch): void {
    const audio = this.getSelectedAudio();
    if (!audio) return;
    if (!this.liveAudioEdit) this.beginAudioLiveEdit("Scale card");
    if (patch.scale !== undefined) {
      const next = clamp(patch.scale, 0.6, 3);
      const applied = next / audio.scale;
      audio.scale = next;
      audio.width = clamp(audio.width * applied, 200, 1600);
      audio.height = clamp(audio.height * applied, 110, 900);
    }
    if (patch.stampScale !== undefined) {
      audio.stampScale = clamp(patch.stampScale, 0.7, 3);
    }
    touch(this.board!);
    this.renderer?.refreshNode(audio.id);
    this.renderer?.markNodeGeometryChanged(audio.id);
    this.markDirty();
  }

  endAudioLiveEdit(): void {
    if (!this.liveAudioEdit) return;
    this.liveAudioEdit = false;
    this.touchAndSave();
    this.commitHistory();
    this.updateHistoryButtons();
    this.audioInspector?.setAudio(this.getSelectedAudio());
  }

  closeAudioInspector(): void {
    this.setSelection([], null);
  }

  editAudioCaption(nodeId: string): void {
    if (!this.board) return;
    const node = getNode(this.board, nodeId);
    if (!node || node.type !== "audio") return;
    const audio = node;
    const board = this.board;
    const theme = board.theme;
    new PromptModal(this.app, {
      title: "Recording caption",
      description: "One line for the case file. The audio itself is never modified.",
      value: audio.caption,
      cta: "Save caption",
      theme,
      placeholder: "What does this recording say?",
      onSave: (value) => {
        const next = value.trim();
        if (next.length > 280) return "Keep the caption under 280 characters.";
        this.history?.begin("Edit caption", JSON.stringify(board));
        audio.caption = next;
        touch(board);
        this.commitHistory("Edit caption");
        this.renderer?.refreshNode(audio.id);
        return null;
      },
    }).open();
  }

  private audioSource(node: AudioBoardNode): string {
    const info = this.fileInfo.getImageInfo(node.file);
    return info.src ?? this.app.vault.adapter.getResourcePath(node.file);
  }

  private markAudioState(nodeId: string, state: "idle" | "playing" | "paused"): void {
    this.renderer?.getNodeView(nodeId)?.updateAudioState(state);
  }

  private markAudioMissing(nodeId: string, missing: boolean): void {
    this.renderer?.getNodeView(nodeId)?.updateAudioMissing(missing);
  }

  private handleAudioStopped(nodeId: string | null): void {
    if (!nodeId) return;
    this.markAudioState(nodeId, "idle");
    this.renderer?.getNodeView(nodeId)?.updateAudioProgress(0);
  }

  private handleAudioError(nodeId: string): void {
    this.markAudioMissing(nodeId, true);
    this.markAudioState(nodeId, "idle");
    new Notice("Caseboard: the browser refused to play that recording.");
  }

  // ----------------------------------------------------------- text edits

  onTextInput(node: TextBoardNode, text: string): void {
    if (!this.board || this.board.id !== this.boardId) return;
    node.text = text;
    this.markDirty();
  }

  onTextEditingChange(node: TextBoardNode, editing: boolean): void {
    if (!this.board) return;
    if (editing) {
      if (this.liveThreadEdit) this.endLiveEdit();
      this.editingNodeId = node.id;
      this.history?.begin("Edit text", JSON.stringify(this.board));
      this.updateEmptyState();
    } else {
      if (this.editingNodeId !== node.id) return;
      this.editingNodeId = null;
      this.commitHistory("Edit text");
      this.markDirty();
    }
  }

  onTextAutoGrow(node: TextBoardNode, desiredHeight: number): void {
    if (!this.board) return;
    const height = clamp(desiredHeight, node.height, 1400);
    if (height <= node.height + 1) return;
    node.height = height;
    this.renderer?.markNodeGeometryChanged(node.id);
    this.markDirty();
  }

  finishTextEditing(): void {
    const editor = this.renderer?.getAnyEditingNode();
    if (editor) editor.stopEditing();
    this.editingNodeId = null;
  }

  private endInlineEdits(): void {
    this.finishTextEditing();
    if (this.liveThreadEdit) this.endLiveEdit();
    if (this.liveStampEdit) this.endStampEdit();
  }

  // --------------------------------------------------------------- add/zoom

  private requireBoard(): BoardDoc {
    if (!this.board) throw new Error("Caseboard: board is not loaded.");
    return this.board;
  }

  zoomToFit(): void {
    if (!this.board) return;
    const bounds = nodesBounds(this.board.nodes);
    if (!bounds) {
      this.camera?.reset();
      return;
    }
    this.camera?.fitTo(bounds, 130, 160);
  }

  zoomToSelection(): void {
    if (!this.board) return;
    const nodes = this.board.nodes.filter((node) => this.selection.nodes.has(node.id));
    if (nodes.length === 0 && this.selection.connection) {
      const connection = this.getConnection(this.selection.connection);
      if (connection) {
        const ids = new Set([connection.from.nodeId, connection.to.nodeId]);
        const selected = this.board.nodes.filter((node) => ids.has(node.id));
        const bounds = nodesBounds(selected);
        if (bounds) this.camera?.fitTo(bounds, 160, 190);
      }
      return;
    }
    const bounds = nodesBounds(nodes);
    if (bounds) this.camera?.fitTo(bounds, 150, 180);
    else this.zoomToFit();
  }

  // ----------------------------------------------------------- vault files

  private queueFileRefresh(path: string): void {
    this.pendingFilePaths.add(path);
    this.fileRefreshDebouncer.schedule();
  }

  private flushFileRefresh(): void {
    if (!this.renderer) {
      this.pendingFilePaths.clear();
      return;
    }
    for (const path of this.pendingFilePaths) {
      this.renderer.refreshFile(path);
    }
    this.pendingFilePaths.clear();
  }

  handleVaultRename(oldPath: string, newPath: string): void {
    if (!this.board) return;
    const changed = patchFilePaths(this.board, oldPath, newPath);
    if (!changed) return;
    this.finishTextEditing();
    this.fileInfo.invalidate(oldPath);
    this.fileInfo.invalidate(newPath);
    touch(this.board);
    this.history?.clear();
    this.updateHistoryButtons();
    this.renderer?.setBoard(this.board);
    this.setSelection([], null);
    this.markDirty();
    this.saveDebouncer.cancel();
    void this.performSave();
  }

  // ------------------------------------------------------------ drag/drop

  private onDragOver = (event: DragEvent): void => {
    if (!this.board || this.loading) return;
    if (!event.dataTransfer) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    this.stage.classList.add("is-drop-target");
  };

  private onDragLeave = (event: DragEvent): void => {
    const related = event.relatedTarget;
    if (related instanceof Node && this.stage.contains(related)) return;
    this.stage.classList.remove("is-drop-target");
  };

  private onDrop = (event: DragEvent): void => {
    if (!this.board) return;
    event.preventDefault();
    this.stage.classList.remove("is-drop-target");
    const point = this.camera?.screenToWorld(event.clientX, event.clientY);
    const transfer = event.dataTransfer;
    if (!transfer || !point) return;

    if (transfer.files.length > 0) {
      const files = Array.from(transfer.files);
      const images = files.filter((file) => file.type.startsWith("image/"));
      const audio = files.filter((file) => !file.type.startsWith("image/") && isAudioFileName(file.name));
      if (images.length + audio.length === 0) {
        new Notice("Caseboard: drop image files, recordings or notes from the vault.");
        return;
      }
      void this.importDroppedFiles(images, audio, point);
      return;
    }

    const raw = (transfer.getData("text/plain") || transfer.getData("text/uri-list")).trim();
    if (!raw) return;
    let path = raw;
    if (raw.startsWith("obsidian://")) {
      try {
        const url = new URL(raw);
        path = url.searchParams.get("file") ?? "";
      } catch {
        return;
      }
    }
    path = decodeURIComponent(path);
    if (path.startsWith("[[") && path.endsWith("]]")) path = path.slice(2, -2);
    const target = this.app.vault.getAbstractFileByPath(normalizePath(path));
    if (!(target instanceof TFile)) return;
    if (target.extension === "md") {
      this.addNoteFromPath(target.path, point);
      return;
    }
    if (IMAGE_EXTENSIONS.has(target.extension.toLowerCase())) {
      this.addImageAt(target.path, point);
      return;
    }
    if (isAudioFileName(target.name)) {
      this.addAudioAt(target.path, point);
    }
  };

  private async importDroppedFiles(images: File[], audio: File[], point: Vec2): Promise<void> {
    const folder = this.store.getSettings().imageFolder;
    const step = (index: number): Vec2 => ({ x: point.x + index * 34, y: point.y + index * 28 });
    let placed = 0;

    for (const file of images) {
      const saved = await saveImageFile(this.app, file, folder);
      if (!saved) continue;
      this.addImageAt(saved.path, step(placed));
      placed++;
    }

    for (const file of audio) {
      const dot = file.name.lastIndexOf(".");
      const base = dot > 0 ? file.name.slice(0, dot) : file.name;
      const extension = dot > 0 ? file.name.slice(dot + 1).toLowerCase() : "webm";
      const saved = await saveBlobToVault(this.app, file, base, extension, folder);
      if (!saved) continue;
      this.addAudioAt(saved.path, step(placed));
      placed++;
    }

    if (placed > 0) {
      this.showToast(placed === 1 ? "Pinned to the board" : `${placed} cards pinned`, "success");
      this.root.focus({ preventScroll: true });
    }
  }
}

function physicalLetter(code: string): string | null {
  return /^Key[A-Z]$/.test(code) ? code.slice(3).toLowerCase() : null;
}

/** 2026-11-01-1432 — sortable, filesystem-safe recording names. */
function fileStamp(timestamp: number): string {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    "-",
    pad(date.getHours()),
    pad(date.getMinutes()),
  ].join("");
}
