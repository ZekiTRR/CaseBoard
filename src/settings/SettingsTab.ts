import { App, Notice, Plugin, PluginSettingTab, Setting } from "obsidian";
import type { AnchorKind, ImportLayout, ThemeId, ThreadMode } from "../core/types";
import type { BoardStore } from "../core/BoardStore";
import { getThemeList } from "../render/themes";
import { FolderPickerModal } from "../ui/FilePickers";

export interface SettingsTabHost {
  openBoard(): void;
  createBoard(): void;
}

export class CaseboardSettingsTab extends PluginSettingTab {
  constructor(
    app: App,
    private readonly caseboardPlugin: Plugin,
    private readonly store: BoardStore,
    private readonly host: SettingsTabHost,
  ) {
    super(app, caseboardPlugin);
  }

  display(): void {
    const { containerEl } = this;
    const settings = this.store.getSettings();
    containerEl.empty();
    containerEl.addClass("caseboard-settings");

    const intro = containerEl.createDiv({ cls: "caseboard-settings-intro" });
    intro.createDiv({ cls: "caseboard-settings-kicker", text: "Caseboard" });
    intro.createDiv({
      cls: "caseboard-settings-lead",
      text: "Pin notes, photographs and evidence to a textured board, then connect them with red thread.",
    });

    new Setting(containerEl).setName("Defaults").setHeading();

    new Setting(containerEl)
      .setName("Default board surface")
      .setDesc("Applied when a new investigation is opened.")
      .addDropdown((dropdown) => {
        for (const theme of getThemeList()) dropdown.addOption(theme.id, theme.name);
        dropdown.setValue(settings.defaultTheme).onChange(async (value) => {
          await this.store.updateSettings({ defaultTheme: value as ThemeId });
        });
      });

    new Setting(containerEl)
      .setName("Show pins on new boards")
      .setDesc("Pins and magnets on cards.")
      .addToggle((toggle) =>
        toggle.setValue(settings.showPinsByDefault).onChange(async (value) => {
          await this.store.updateSettings({ showPinsByDefault: value });
        }),
      );

    new Setting(containerEl)
      .setName("Snap to grid on new boards")
      .setDesc("Cards align to a grid while dragged.")
      .addToggle((toggle) =>
        toggle.setValue(settings.snapToGridByDefault).onChange(async (value) => {
          await this.store.updateSettings({ snapToGridByDefault: value });
        }),
      );

    new Setting(containerEl)
      .setName("Grid size")
      .setDesc("Distance between grid lines, in board units.")
      .addSlider((slider) =>
        slider
          .setLimits(5, 100, 5)
          .setValue(settings.gridSize)
          .setDynamicTooltip()
          .onChange(async (value) => {
            await this.store.updateSettings({ gridSize: value });
          }),
      );

    new Setting(containerEl)
      .setName("Autosave delay")
      .setDesc("How quickly board changes are written to disk.")
      .addSlider((slider) =>
        slider
          .setLimits(300, 3000, 100)
          .setValue(settings.autosaveDelay)
          .setDynamicTooltip()
          .onChange(async (value) => {
            await this.store.updateSettings({ autosaveDelay: value });
          }),
      );

    new Setting(containerEl)
      .setName("Confirm before deleting a board")
      .setDesc("A board and its threads are removed from the vault. Source notes are never deleted.")
      .addToggle((toggle) =>
        toggle.setValue(settings.confirmDeleteBoard).onChange(async (value) => {
          await this.store.updateSettings({ confirmDeleteBoard: value });
        }),
      );

    new Setting(containerEl).setName("New threads").setHeading();

    new Setting(containerEl)
      .setName("Default physics")
      .setDesc("Taut is recommended: it looks natural and stays cheap.")
      .addDropdown((dropdown) => {
        dropdown.addOption("taut", "Taut");
        dropdown.addOption("dynamic", "Dynamic");
        dropdown.addOption("static", "Static");
        dropdown.setValue(settings.defaultThreadMode).onChange(async (value) => {
          await this.store.updateSettings({ defaultThreadMode: value as ThreadMode });
        });
      });

    new Setting(containerEl)
      .setName("Default attachment")
      .setDesc("Where a new thread meets a card.")
      .addDropdown((dropdown) => {
        dropdown.addOption("auto", "Auto edge");
        dropdown.addOption("pin", "Pin");
        dropdown.addOption("top", "Top");
        dropdown.addOption("right", "Right");
        dropdown.addOption("bottom", "Bottom");
        dropdown.addOption("left", "Left");
        dropdown.setValue(settings.defaultAnchor).onChange(async (value) => {
          await this.store.updateSettings({ defaultAnchor: value as AnchorKind });
        });
      });

    new Setting(containerEl)
      .setName("Auto tension for new threads")
      .setDesc("Threads take up slack automatically when cards move.")
      .addToggle((toggle) =>
        toggle.setValue(settings.defaultAutoTension).onChange(async (value) => {
          await this.store.updateSettings({ defaultAutoTension: value });
        }),
      );

    new Setting(containerEl).setName("Importer").setHeading();

    new Setting(containerEl)
      .setName("Default depth")
      .setDesc("How many levels of links to follow in the import dialog.")
      .addDropdown((dropdown) => {
        for (let depth = 1; depth <= 4; depth++) {
          dropdown.addOption(String(depth), depth === 1 ? "1 level (direct)" : `${depth} levels`);
        }
        dropdown.setValue(String(settings.importDepth)).onChange(async (value) => {
          await this.store.updateSettings({ importDepth: Number(value) });
        });
      });

    new Setting(containerEl)
      .setName("Default card limit")
      .setDesc("A safety stop for large vaults.")
      .addSlider((slider) =>
        slider
          .setLimits(10, 300, 10)
          .setValue(settings.importLimit)
          .setDynamicTooltip()
          .onChange(async (value) => {
            await this.store.updateSettings({ importLimit: value });
          }),
      );

    new Setting(containerEl)
      .setName("Default layout")
      .setDesc("Organic is looser; Tidy tree keeps clear rings.")
      .addDropdown((dropdown) => {
        dropdown.addOption("organic", "Organic");
        dropdown.addOption("tree", "Tidy tree");
        dropdown.setValue(settings.importLayout).onChange(async (value) => {
          await this.store.updateSettings({ importLayout: value as ImportLayout });
        });
      });

    let imageFolderInput: HTMLInputElement | null = null;
    new Setting(containerEl)
      .setName("Attachment folder")
      .setDesc(
        "Where photos added from disk, pasted images and custom board backgrounds are saved. Leave empty to use Obsidian's attachment settings.",
      )
      .addText((text) => {
        imageFolderInput = text.inputEl;
        text
          .setPlaceholder("Caseboard assets")
          .setValue(settings.imageFolder)
          .onChange(async (value) => {
            await this.store.updateSettings({ imageFolder: value.trim() });
          });
      })
      .addButton((button) =>
        button.setButtonText("Choose…").onClick(() => {
          new FolderPickerModal(
            this.app,
            (path) => {
              if (imageFolderInput) imageFolderInput.value = path;
              void this.store.updateSettings({ imageFolder: path });
              new Notice(
                path ? `Caseboard: attachments will be saved to ${path}.` : "Caseboard: using Obsidian's attachment settings.",
              );
            },
            settings.defaultTheme,
          ).open();
        }),
      );

    let boardFolderInput: HTMLInputElement | null = null;
    let pendingBoardFolder = settings.boardFolder;
    const pluginDir =
      this.caseboardPlugin.manifest.dir ?? `${this.app.vault.configDir}/plugins/caseboard`;
    const defaultBoardFolder = `${pluginDir}/boards`;
    new Setting(containerEl)
      .setName("Board folder")
      .setDesc(
        `Where board files are stored. Leave empty for ${defaultBoardFolder}. Use “Move boards” after changing the path.`,
      )
      .addText((text) => {
        boardFolderInput = text.inputEl;
        text
          .setPlaceholder(defaultBoardFolder)
          .setValue(settings.boardFolder)
          .onChange(async (value) => {
            pendingBoardFolder = value.trim();
          });
      })
      .addButton((button) =>
        button.setButtonText("Choose…").onClick(() => {
          new FolderPickerModal(
            this.app,
            (path) => {
              pendingBoardFolder = path;
              if (boardFolderInput) boardFolderInput.value = path;
              void this.applyBoardFolder(path);
            },
            settings.defaultTheme,
          ).open();
        }),
      )
      .addButton((button) =>
        button.setButtonText("Move boards").setCta().onClick(async () => {
          await this.applyBoardFolder(pendingBoardFolder);
        }),
      );

    new Setting(containerEl).setName("Investigations").setHeading();

    const boards = this.store.getBoards();
    new Setting(containerEl)
      .setName("Boards")
      .setDesc(
        `${boards.length} board${boards.length === 1 ? "" : "s"} stored in ${this.store.getBoardDirectory()}.`,
      )
      .addButton((button) =>
        button.setButtonText("Open the board").onClick(() => this.host.openBoard()),
      )
      .addButton((button) =>
        button
          .setButtonText("New board")
          .setCta()
          .onClick(() => this.host.createBoard()),
      );

    const footer = containerEl.createDiv({ cls: "caseboard-settings-footer" });
    footer.setText(
      `Caseboard ${this.caseboardPlugin.manifest.version} · boards are stored separately from your notes.`,
    );
  }

  private async applyBoardFolder(folder: string): Promise<void> {
    try {
      const moved = await this.store.setBoardFolder(folder);
      new Notice(
        moved > 0
          ? `Caseboard: board folder changed · ${moved} file${moved === 1 ? "" : "s"} moved to ${this.store.getBoardDirectory()}.`
          : `Caseboard: board folder set to ${this.store.getBoardDirectory()}.`,
      );
      this.display();
    } catch (error) {
      new Notice(
        `Caseboard: boards were not moved. ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
