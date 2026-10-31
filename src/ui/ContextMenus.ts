import { App, Menu } from "obsidian";
import type { BoardConnection, BoardDoc, BoardNode, Vec2 } from "../core/types";
import type { BoardTheme } from "../render/themes";
import type { InteractionSelection } from "../interaction/BoardInteraction";

export interface ContextMenuHost {
  app: App;
  getBoard(): BoardDoc;
  getSelection(): InteractionSelection;
  getTheme(): BoardTheme;
  openNode(nodeId: string): void;
  startThreadFrom(nodeId: string): void;
  duplicateSelection(): void;
  deleteSelection(): void;
  toggleLockSelection(): void;
  bringSelectionToFront(): void;
  sendSelectionToBack(): void;
  setVariantForSelection(variant: string): void;
  setTextScaleForSelection(scale: number): void;
  setAccentForSelection(color: string): void;
  openPinColorPicker(): void;
  replaceImageFromVault(nodeId: string): void;
  replaceImageFromDisk(nodeId: string): void;
  copyPath(nodeId: string): void;
  addNote(): void;
  addTextAt(point?: Vec2): void;
  addImageFromVault(point?: Vec2): void;
  addImageFromDisk(point?: Vec2): void;
  openImport(): void;
  zoomToFit(): void;
  openBoardSettings(): void;
  toggleFocus(): void;
  changeConnection(id: string, patch: Partial<BoardConnection>, label: string): void;
  deleteConnection(id: string): void;
}

const VARIANTS: Record<BoardNode["type"], Array<{ id: string; label: string }>> = {
  note: [
    { id: "paper", label: "Case paper" },
    { id: "index", label: "Index card" },
    { id: "aged", label: "Aged paper" },
    { id: "grid", label: "Graph paper" },
    { id: "kraft", label: "Kraft" },
    { id: "night", label: "Black paper" },
    { id: "bare", label: "Bare" },
  ],
  text: [
    { id: "sticky", label: "Sticky note" },
    { id: "index", label: "Index card" },
    { id: "aged", label: "Aged paper" },
    { id: "grid", label: "Graph paper" },
    { id: "kraft", label: "Kraft" },
    { id: "night", label: "Dark note" },
    { id: "bare", label: "Bare" },
  ],
  image: [
    { id: "polaroid", label: "Polaroid" },
    { id: "plain", label: "Plain print" },
    { id: "taped", label: "Taped photo" },
    { id: "bare", label: "Bare" },
  ],
  tape: [],
};

const TEXT_STEP = 0.15;

export class ContextMenus {
  constructor(private readonly host: ContextMenuHost) {}

  showNodeMenu(nodeId: string, event: MouseEvent): void {
    const board = this.host.getBoard();
    const selection = this.host.getSelection();
    const target = board.nodes.find((node) => node.id === nodeId);
    if (!target) return;
    const nodes = selection.nodes.has(nodeId)
      ? board.nodes.filter((node) => selection.nodes.has(node.id))
      : [target];
    const single = nodes.length === 1 ? nodes[0] : null;
    const allSameType = nodes.every((node) => node.type === nodes[0]?.type);
    const menu = new Menu();

    menu.addItem((item) => {
      item.setTitle(
        single
          ? single.type === "note" || single.type === "image"
            ? single.file
            : single.type === "text"
              ? "Text block"
              : "Tape strip"
          : `${nodes.length} cards`,
      );
      item.setIsLabel(true);
    });
    menu.addSeparator();

    if (single) {
      if (single.type === "note") {
        menu.addItem((item) =>
          item
            .setTitle("Open source note")
            .setIcon("file-text")
            .onClick(() => this.host.openNode(single.id)),
        );
      } else if (single.type === "image") {
        menu.addItem((item) =>
          item
            .setTitle("Open image")
            .setIcon("image")
            .onClick(() => this.host.openNode(single.id)),
        );
      } else if (single.type === "text") {
        menu.addItem((item) =>
          item
            .setTitle("Edit text")
            .setIcon("pencil")
            .onClick(() => this.host.openNode(single.id)),
        );
      }

      menu.addItem((item) =>
        item
          .setTitle("Tie a thread from here")
          .setIcon("git-branch")
          .onClick(() => this.host.startThreadFrom(single.id)),
      );
    }

    menu.addItem((item) =>
      item
        .setTitle(nodes.length > 1 ? `Duplicate ${nodes.length} cards` : "Duplicate")
        .setIcon("copy")
        .onClick(() => this.host.duplicateSelection()),
    );

    const allLocked = nodes.every((node) => node.locked);
    menu.addItem((item) =>
      item
        .setTitle(allLocked ? "Unlock position" : "Lock position")
        .setIcon(allLocked ? "unlock" : "lock")
        .onClick(() => this.host.toggleLockSelection()),
    );

    menu.addItem((item) =>
      item
        .setTitle("Bring to front")
        .setIcon("chevrons-up")
        .onClick(() => this.host.bringSelectionToFront()),
    );
    menu.addItem((item) =>
      item
        .setTitle("Send to back")
        .setIcon("chevrons-down")
        .onClick(() => this.host.sendSelectionToBack()),
    );

    if (allSameType) {
      const type = nodes[0].type;
      const variants = VARIANTS[type];
      if (variants.length > 0) {
        menu.addSeparator();
        for (const variant of variants) {
          menu.addItem((item) => {
            item
              .setTitle(variant.label)
              .setChecked(nodes.every((node) => node.variant === variant.id))
              .onClick(() => this.host.setVariantForSelection(variant.id));
          });
        }
      }

      if (type === "note" || type === "text") {
        menu.addSeparator();
        const scales = nodes.map((node) =>
          node.type === "note" || node.type === "text" ? node.fontScale : 1,
        );
        const current = scales.every((scale) => Math.abs(scale - scales[0]) < 0.01)
          ? scales[0]
          : null;
        menu.addItem((item) =>
          item
            .setTitle(
              current !== null ? `Text size · ${Math.round(current * 100)}%` : "Text size · mixed",
            )
            .setIsLabel(true),
        );
        menu.addItem((item) =>
          item
            .setTitle("Smaller text")
            .onClick(() =>
              this.host.setTextScaleForSelection(
                Math.max(0.7, Math.round(((current ?? 1) - TEXT_STEP) * 100) / 100),
              ),
            ),
        );
        menu.addItem((item) =>
          item
            .setTitle("Larger text")
            .onClick(() =>
              this.host.setTextScaleForSelection(
                Math.min(1.8, Math.round(((current ?? 1) + TEXT_STEP) * 100) / 100),
              ),
            ),
        );
      }

      if (type !== "tape") {
        menu.addSeparator();
        menu.addItem((item) => item.setTitle("Pin colour").setIsLabel(true));
        const theme = this.host.getTheme();
        const colors = unique([
          theme.pinColor,
          ...theme.threadPalette,
          ...nodes.map((node) => node.accent),
        ]);
        for (const color of colors) {
          menu.addItem((item) => {
            item
              .setTitle(colorFragment(color))
              .setChecked(nodes.every((node) => node.accent.toLowerCase() === color.toLowerCase()))
              .onClick(() => this.host.setAccentForSelection(color));
          });
        }
        menu.addItem((item) =>
          item
            .setTitle("Custom pin colour…")
            .setIcon("pipette")
            .onClick(() => this.host.openPinColorPicker()),
        );
      }
    }

    if (single?.type === "image") {
      menu.addSeparator();
      menu.addItem((item) =>
        item
          .setTitle("Replace photo from vault…")
          .setIcon("image-plus")
          .onClick(() => this.host.replaceImageFromVault(single.id)),
      );
      menu.addItem((item) =>
        item
          .setTitle("Replace photo from disk…")
          .setIcon("upload")
          .onClick(() => this.host.replaceImageFromDisk(single.id)),
      );
    }

    if (single && (single.type === "note" || single.type === "image")) {
      menu.addItem((item) =>
        item
          .setTitle("Copy vault path")
          .setIcon("clipboard")
          .onClick(() => this.host.copyPath(single.id)),
      );
    }

    menu.addSeparator();
    menu.addItem((item) =>
      item
        .setTitle(nodes.length > 1 ? `Remove ${nodes.length} cards` : "Remove from board")
        .setIcon("trash-2")
        .setWarning(true)
        .onClick(() => this.host.deleteSelection()),
    );

    menu.showAtMouseEvent(event);
  }

  showConnectionMenu(connectionId: string, event: MouseEvent): void {
    const board = this.host.getBoard();
    const connection = board.connections.find((item) => item.id === connectionId);
    if (!connection) return;
    const menu = new Menu();
    menu.addItem((item) => {
      item.setTitle("Thread").setIsLabel(true);
    });
    menu.addSeparator();

    for (const [mode, label] of [
      ["dynamic", "Dynamic"],
      ["taut", "Taut"],
      ["static", "Static"],
    ] as const) {
      menu.addItem((item) =>
        item
          .setTitle(label)
          .setChecked(connection.physics === mode)
          .onClick(() => this.host.changeConnection(connectionId, { physics: mode }, "Thread physics")),
      );
    }
    menu.addSeparator();

    menu.addItem((item) =>
      item
        .setTitle("Auto tension")
        .setChecked(connection.autoTension)
        .onClick(() =>
          this.host.changeConnection(
            connectionId,
            { autoTension: !connection.autoTension },
            "Auto tension",
          ),
        ),
    );
    menu.addItem((item) =>
      item
        .setTitle("Sway")
        .setChecked(connection.animated)
        .setDisabled(connection.physics !== "taut")
        .onClick(() =>
          this.host.changeConnection(connectionId, { animated: !connection.animated }, "Thread sway"),
        ),
    );
    menu.addSeparator();

    for (const width of [1, 1.5, 2.4, 3.5, 5]) {
      menu.addItem((item) =>
        item
          .setTitle(`Thickness ${width} px`)
          .setChecked(Math.abs(connection.width - width) < 0.05)
          .onClick(() => this.host.changeConnection(connectionId, { width }, "Thread thickness")),
      );
    }
    menu.addSeparator();

    const theme = this.host.getTheme();
    const colors = unique([...theme.threadPalette, connection.color]);
    for (const color of colors) {
      menu.addItem((item) => {
        item
          .setTitle(colorFragment(color))
          .setChecked(connection.color.toLowerCase() === color.toLowerCase())
          .onClick(() => this.host.changeConnection(connectionId, { color }, "Thread colour"));
      });
    }

    menu.addSeparator();
    menu.addItem((item) =>
      item
        .setTitle("Remove thread")
        .setIcon("trash-2")
        .setWarning(true)
        .onClick(() => this.host.deleteConnection(connectionId)),
    );
    menu.showAtMouseEvent(event);
  }

  showBoardMenu(point: Vec2, event: MouseEvent): void {
    const menu = new Menu();
    menu.addItem((item) =>
      item
        .setTitle("Pin a note…")
        .setIcon("sticky-note")
        .onClick(() => this.host.addNote()),
    );
    menu.addItem((item) =>
      item
        .setTitle("Add text block")
        .setIcon("type")
        .onClick(() => this.host.addTextAt(point)),
    );
    menu.addItem((item) =>
      item
        .setTitle("Add photo from vault…")
        .setIcon("image")
        .onClick(() => this.host.addImageFromVault(point)),
    );
    menu.addItem((item) =>
      item
        .setTitle("Add photo from disk…")
        .setIcon("upload")
        .onClick(() => this.host.addImageFromDisk(point)),
    );
    menu.addSeparator();
    menu.addItem((item) =>
      item
        .setTitle("Import linked notes…")
        .setIcon("download")
        .onClick(() => this.host.openImport()),
    );
    menu.addSeparator();
    menu.addItem((item) =>
      item
        .setTitle("Zoom to fit")
        .setIcon("maximize-2")
        .onClick(() => this.host.zoomToFit()),
    );
    menu.addItem((item) =>
      item
        .setTitle("Focus mode")
        .setIcon("maximize")
        .onClick(() => this.host.toggleFocus()),
    );
    menu.addItem((item) =>
      item
        .setTitle("Board settings")
        .setIcon("sliders-horizontal")
        .onClick(() => this.host.openBoardSettings()),
    );
    menu.showAtMouseEvent(event);
  }
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

function colorFragment(color: string): DocumentFragment {
  const fragment = createFragment();
  const dot = createSpan();
  dot.className = "cb-menu-dot";
  dot.style.background = color;
  const label = createSpan();
  label.textContent = color.toUpperCase();
  fragment.append(dot, label);
  return fragment;
}
