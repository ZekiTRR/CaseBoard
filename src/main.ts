import { Notice, Plugin, TAbstractFile, WorkspaceLeaf } from "obsidian";
import { VIEW_TYPE } from "./core/types";
import { BoardFiles } from "./persistence/BoardFiles";
import { BoardStore } from "./core/BoardStore";
import { CaseboardView } from "./views/CaseboardView";
import { CaseboardSettingsTab } from "./settings/SettingsTab";

export default class CaseboardPlugin extends Plugin {
  store!: BoardStore;
  private files!: BoardFiles;

  async onload(): Promise<void> {
    const pluginDir = this.manifest.dir ?? `${this.app.vault.configDir}/plugins/caseboard`;
    this.files = new BoardFiles(this.app, pluginDir);
    this.store = new BoardStore(this, this.files);
    await this.store.init();

    this.registerView(VIEW_TYPE, (leaf) => new CaseboardView(leaf, this.store));

    this.addRibbonIcon("pin", "Open the board", () => {
      void this.openCaseboard();
    });

    this.addCommand({
      id: "open",
      name: "Open the board",
      callback: () => {
        void this.openCaseboard();
      },
    });

    this.addCommand({
      id: "create",
      name: "Create a new board",
      callback: () => {
        void this.createAndOpenBoard();
      },
    });

    this.addCommand({
      id: "import-linked-notes",
      name: "Import linked notes into the board",
      checkCallback: (checking) => {
        const activeView = this.getActiveView();
        const activeFile = this.app.workspace.getActiveFile();
        const available = Boolean(activeView || (activeFile && activeFile.extension === "md"));
        if (!available) return false;
        if (!checking) {
          void (async () => {
            const view = await this.openCaseboard();
            if (!view) return;
            const file = this.app.workspace.getActiveFile();
            view.openImportDialog(file?.extension === "md" ? file.path : undefined);
          })();
        }
        return true;
      },
    });

    this.addCommand({
      id: "toggle-focus-mode",
      name: "Toggle focus mode",
      checkCallback: (checking) => {
        const view = this.getActiveView();
        if (!view) return false;
        if (!checking) view.toggleFocus();
        return true;
      },
    });

    this.addCommand({
      id: "save",
      name: "Save the board",
      checkCallback: (checking) => {
        const view = this.getActiveView();
        if (!view) return false;
        if (!checking) view.saveNow();
        return true;
      },
    });

    this.addCommand({
      id: "refresh-imported-chains",
      name: "Refresh imported chains",
      checkCallback: (checking) => {
        const view = this.getActiveView();
        if (!view) return false;
        if (!checking) void view.refreshImports();
        return true;
      },
    });

    this.addCommand({
      id: "record-voice-note",
      name: "Record a voice note",
      checkCallback: (checking) => {
        const view = this.getActiveView();
        if (!view) return false;
        if (!checking) view.recordFromBoardMenu();
        return true;
      },
    });

    this.addSettingTab(
      new CaseboardSettingsTab(this.app, this, this.store, {
        openBoard: () => {
          void this.openCaseboard();
        },
        createBoard: () => {
          void this.createAndOpenBoard();
        },
      }),
    );

    this.registerEvent(
      this.app.vault.on("rename", (file: TAbstractFile, oldPath: string) => {
        void this.handleRename(file, oldPath);
      }),
    );

    this.registerEvent(
      this.app.workspace.on("quit", (tasks) => {
        tasks.add(async () => {
          for (const view of this.getViews()) {
            await view.flushForUnload();
          }
        });
        tasks.add(() => this.store.flush());
      }),
    );
  }

  onunload(): void {
    void this.store?.flush();
    this.store?.dispose();
  }

  getViews(): CaseboardView[] {
    const views: CaseboardView[] = [];
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      if (leaf.view instanceof CaseboardView) views.push(leaf.view);
    }
    return views;
  }

  getActiveView(): CaseboardView | null {
    const active = this.app.workspace.getActiveViewOfType(CaseboardView);
    if (active) return active;
    return null;
  }

  async openCaseboard(boardId?: string): Promise<CaseboardView | null> {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE);
    if (existing.length > 0) {
      const leaf = existing[0];
      await this.app.workspace.revealLeaf(leaf);
      if (leaf.view instanceof CaseboardView) {
        if (boardId && leaf.view.getBoardId() !== boardId) {
          await leaf.view.switchBoard(boardId);
        }
        return leaf.view;
      }
    }

    const leaf: WorkspaceLeaf = this.app.workspace.getLeaf("tab");
    await leaf.setViewState({
      type: VIEW_TYPE,
      active: true,
      state: boardId ? { boardId } : {},
    });
    await this.app.workspace.revealLeaf(leaf);
    return leaf.view instanceof CaseboardView ? leaf.view : null;
  }

  async createAndOpenBoard(): Promise<CaseboardView | null> {
    try {
      const doc = await this.store.createBoard();
      const view = await this.openCaseboard(doc.id);
      return view;
    } catch (error) {
      new Notice(
        `Caseboard: could not create a board. ${
          error instanceof Error ? error.message : ""
        }`.trim(),
      );
      return null;
    }
  }

  private async handleRename(file: TAbstractFile, oldPath: string): Promise<void> {
    const newPath = file.path;
    if (oldPath === newPath) return;

    const openBoardIds = new Set<string>();
    for (const view of this.getViews()) {
      const boardId = view.getBoardId();
      if (boardId) openBoardIds.add(boardId);
      view.handleVaultRename(oldPath, newPath);
    }

    try {
      await this.store.patchClosedBoardFiles(oldPath, newPath, openBoardIds);
    } catch (error) {
      console.warn("Caseboard: could not update renamed paths in closed boards", error);
    }
  }
}
