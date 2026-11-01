import { setIcon } from "obsidian";
import type {
  BoardNode,
  NoteBoardNode,
  NoteMeta,
  TextBoardNode,
} from "../core/types";
import { tapePlacements, usesTape } from "../core/tape";
import { AudioCard, type AudioCardHost } from "./AudioCard";

export interface NodeViewHost extends AudioCardHost {
  onTextInput(node: TextBoardNode, text: string): void;
  onTextEditingChange(node: TextBoardNode, editing: boolean): void;
  onTextAutoGrow(node: TextBoardNode, desiredHeight: number): void;
}

export class NodeView {
  readonly el: HTMLElement;
  node: BoardNode;
  private readonly cardEl: HTMLElement;
  private readonly noteEls: {
    wrap: HTMLElement;
    icon: HTMLElement;
    title: HTMLElement;
    excerpt: HTMLElement;
    tags: HTMLElement;
    path: HTMLElement;
    missing: HTMLElement;
  } | null = null;
  private readonly imageEls: {
    wrap: HTMLElement;
    img: HTMLImageElement;
    caption: HTMLElement;
    missing: HTMLElement;
  } | null = null;
  private readonly tapeLayer: HTMLElement;
  private readonly textEl: HTMLElement | null = null;
  private readonly audio: AudioCard | null = null;
  private readonly sizeBadge: HTMLElement;

  private lastIcon = "";
  private editing = false;
  private selected = false;
  private imageSrc = "";

  constructor(
    node: BoardNode,
    private readonly host: NodeViewHost,
  ) {
    this.node = node;
    this.el = createDiv({ cls: "cb-node" });
    this.el.dataset.id = node.id;
    this.el.dataset.type = node.type;
    this.el.createDiv({ cls: "cb-selection-frame" });

    this.cardEl = this.el.createDiv({ cls: "cb-card" });
    const pin = this.cardEl.createDiv({ cls: "cb-pin" });
    pin.createSpan({ cls: "cb-pin-head" });
    pin.createSpan({ cls: "cb-pin-needle" });
    this.tapeLayer = this.cardEl.createDiv({ cls: "cb-tape-layer" });
    setIcon(this.el.createDiv({ cls: "cb-lock-badge" }), "lock");

    if (node.type === "note") {
      const wrap = this.cardEl.createDiv({ cls: "cb-note" });
      const head = wrap.createDiv({ cls: "cb-note-head" });
      const icon = head.createSpan({ cls: "cb-note-icon" });
      const title = head.createDiv({ cls: "cb-note-title" });
      const excerpt = wrap.createDiv({ cls: "cb-note-excerpt" });
      const missing = wrap.createDiv({ cls: "cb-note-missing" });
      setIcon(missing.createSpan({ cls: "cb-inline-icon" }), "file-warning");
      missing.createSpan({ text: "Source note not found" });
      const foot = wrap.createDiv({ cls: "cb-note-foot" });
      const tags = foot.createDiv({ cls: "cb-note-tags" });
      const path = foot.createDiv({ cls: "cb-note-path" });
      this.noteEls = { wrap, icon, title, excerpt, tags, path, missing };
    } else if (node.type === "text") {
      this.textEl = this.cardEl.createDiv({ cls: "cb-text-content" });
      this.textEl.contentEditable = "false";
      this.textEl.spellcheck = false;
      this.bindTextEvents();
    } else if (node.type === "image") {
      const wrap = this.cardEl.createDiv({ cls: "cb-image-wrap" });
      const img = wrap.createEl("img", { cls: "cb-image" });
      img.draggable = false;
      const caption = wrap.createDiv({ cls: "cb-image-caption" });
      const missing = wrap.createDiv({ cls: "cb-image-missing" });
      setIcon(missing.createSpan({ cls: "cb-inline-icon" }), "image-off");
      missing.createSpan({ text: "Image not found" });
      this.imageEls = { wrap, img, caption, missing };
      img.addEventListener("load", () => {
        wrap.classList.add("is-loaded");
        wrap.classList.remove("is-missing");
      });
      img.addEventListener("error", () => {
        wrap.classList.remove("is-loaded");
        wrap.classList.add("is-missing");
      });
    } else if (node.type === "audio") {
      this.audio = new AudioCard(node, host);
      this.cardEl.appendChild(this.audio.el);
    } else {
      this.cardEl.addClass("is-tape-node");
      this.cardEl.createDiv({ cls: "cb-tape-surface" });
    }

    const handles = this.el.createDiv({ cls: "cb-handles" });
    for (const handle of ["nw", "ne", "se", "sw"] as const) {
      const el = handles.createDiv({ cls: `cb-handle cb-handle-${handle}` });
      el.dataset.handle = handle;
    }
    const rotate = handles.createDiv({ cls: "cb-rotate-handle" });
    rotate.dataset.handle = "rotate";
    setIcon(rotate, "rotate-cw");
    this.sizeBadge = this.el.createDiv({ cls: "cb-size-badge" });
    this.sizeBadge.hidden = true;

    this.updateFromNode(node, true);
  }

  get id(): string {
    return this.node.id;
  }

  get isEditing(): boolean {
    return this.editing;
  }

  get element(): HTMLElement {
    return this.el;
  }

  updateFromNode(node: BoardNode, force = false): void {
    this.node = node;
    const previousVariant = this.el.dataset.variant;
    const previousLocked = this.el.classList.contains("is-locked");
    this.el.dataset.variant = node.variant;
    this.el.style.setProperty("--cb-node-accent", node.accent || "#a6322c");
    if (node.type === "note" || node.type === "text") {
      this.el.style.setProperty("--cb-text-scale", String(node.fontScale || 1));
    }
    this.el.classList.toggle("is-locked", node.locked);
    this.cardEl.classList.toggle("is-locked", node.locked);

    if (force || previousVariant !== node.variant) {
      this.cardEl.dataset.variant = node.variant;
    }
    if (node.locked !== previousLocked || force) {
      const label =
        node.type === "tape"
          ? node.locked
            ? "Locked tape strip"
            : "Tape strip"
          : node.type === "audio"
            ? node.locked
              ? "Locked recording"
              : "Recording"
            : node.locked
              ? "Locked card"
              : "Card";
      this.el.setAttribute("aria-label", label);
    }

    this.applyTransform();

    if (node.type === "note" && this.noteEls) {
      if (!this.lastIcon) this.updateNotePreview(node, null);
      this.noteEls.title.textContent = basename(node.file);
      this.noteEls.title.title = node.file;
      this.noteEls.path.textContent = folderOf(node.file);
      this.noteEls.path.title = node.file;
    } else if (node.type === "text" && this.textEl) {
      if (!this.editing && this.textEl.innerText !== node.text) {
        this.textEl.textContent = node.text;
      }
      this.el.classList.toggle("is-empty", node.text.trim().length === 0);
    } else if (node.type === "image" && this.imageEls) {
      this.imageEls.img.style.objectFit = node.fit;
      this.imageEls.caption.textContent = node.caption || basename(node.file);
      this.imageEls.img.alt = node.caption || basename(node.file);
    } else if (node.type === "audio" && this.audio) {
      this.audio.update(node);
    }

    this.updateTapeLayout(node);
  }

  private updateTapeLayout(node: BoardNode): void {
    const taped = usesTape(node);
    this.el.dataset.fastener = taped ? "tape" : "pin";
    this.tapeLayer.empty();
    this.tapeLayer.toggleAttribute("hidden", !taped);
    if (!taped) return;
    const tapes = tapePlacements(node);
    tapes.forEach((tape, index) => {
      const strip = this.tapeLayer.createDiv({ cls: "cb-tape" });
      strip.dataset.tape = String(index);
      strip.style.left = `${50 + tape.x * 100}%`;
      strip.style.top = `${50 + tape.y * 100}%`;
      strip.style.transform = `translate(-50%, -50%) rotate(${tape.angle}deg)`;
      strip.createDiv({
        cls: "cb-tape-rotate",
        attr: { "data-tape-rotate": String(index) },
      });
    });
  }

  applyTransform(): void {
    const node = this.node;
    this.el.style.width = `${node.width}px`;
    this.el.style.height = `${node.height}px`;
    this.el.style.transform = `translate3d(${round(node.x - node.width / 2)}px, ${round(
      node.y - node.height / 2,
    )}px, 0) rotate(${round(node.rotation)}deg)`;
    this.el.style.zIndex = String(node.z);
    if (this.audio && node.type === "audio") this.audio.update(node);
  }

  updateNotePreview(node: NoteBoardNode, meta: NoteMeta | null): void {
    if (!this.noteEls) return;
    const title = meta?.title?.trim() || basename(node.file);
    const icon = meta?.icon || "file-text";
    const excerpt = meta?.excerpt ?? "";
    const tags = meta?.tags ?? [];
    const missing = meta?.missing ?? false;
    const folder = folderOf(meta?.path || node.file);

    this.noteEls.title.textContent = title;
    this.noteEls.title.title = meta?.path || node.file;
    this.noteEls.excerpt.textContent = excerpt;
    this.noteEls.path.textContent = folder;
    this.noteEls.path.title = meta?.path || node.file;

    if (this.lastIcon !== icon) {
      this.lastIcon = icon;
      this.noteEls.icon.empty();
      setIcon(this.noteEls.icon, icon);
    }

    this.noteEls.tags.empty();
    const shown = tags.slice(0, 3);
    for (const tag of shown) {
      this.noteEls.tags.createSpan({ cls: "cb-tag", text: `#${tag}` });
    }
    if (tags.length > shown.length) {
      this.noteEls.tags.createSpan({ cls: "cb-tag cb-tag-more", text: `+${tags.length - shown.length}` });
    }

    this.cardEl.classList.toggle("is-missing", missing);
    this.noteEls.missing.toggleAttribute("hidden", !missing);
    this.noteEls.wrap.classList.toggle("has-tags", shown.length > 0);
  }

  updateImage(src: string | null, missing: boolean): void {
    if (!this.imageEls) return;
    this.imageEls.wrap.classList.toggle("is-missing", missing);
    if (missing) {
      this.imageEls.img.removeAttribute("src");
      this.imageSrc = "";
      return;
    }
    if (!src) return;
    if (this.imageSrc !== src) {
      this.imageSrc = src;
      this.imageEls.wrap.classList.remove("is-loaded");
      this.imageEls.img.src = src;
    }
  }

  updateAudioProgress(ratio: number): void {
    this.audio?.setProgress(ratio);
  }

  updateAudioState(state: "idle" | "playing" | "paused"): void {
    this.audio?.setState(state);
  }

  updateAudioMissing(missing: boolean): void {
    this.audio?.setMissing(missing);
  }

  setSelected(selected: boolean, single: boolean): void {
    if (this.selected === selected && this.el.classList.contains("is-single") === single) return;
    this.selected = selected;
    this.el.classList.toggle("is-selected", selected);
    this.el.classList.toggle("is-single", selected && single);
    this.el.setAttribute("aria-selected", String(selected));
  }

  setPinsVisible(visible: boolean): void {
    this.el.classList.toggle("has-no-pins", !visible);
  }

  startEditing(): void {
    if (this.node.type !== "text" || !this.textEl || this.editing) return;
    this.editing = true;
    this.el.classList.add("is-editing");
    this.textEl.contentEditable = "plaintext-only";
    this.textEl.focus();
    placeCaretAtEnd(this.textEl);
    this.host.onTextEditingChange(this.node, true);
  }

  stopEditing(): void {
    if (!this.editing || !this.textEl || this.node.type !== "text") return;
    const textNode = this.node;
    this.editing = false;
    this.el.classList.remove("is-editing");
    this.textEl.contentEditable = "false";
    this.el.classList.toggle("is-empty", (textNode.text || "").trim().length === 0);
    this.host.onTextEditingChange(textNode, false);
  }

  setSizeBadge(text: string | null): void {
    this.sizeBadge.textContent = text ?? "";
    this.sizeBadge.toggleAttribute("hidden", !text);
  }

  private bindTextEvents(): void {
    if (!this.textEl) return;
    this.textEl.addEventListener("input", () => {
      if (!this.editing) return;
      const text = this.textEl?.innerText ?? "";
      this.el.classList.toggle("is-empty", text.trim().length === 0);
      this.host.onTextInput(this.node as TextBoardNode, text);
      if (this.textEl && this.node.type === "text") {
        const desired = this.textEl.scrollHeight + 46;
        if (desired > this.node.height + 4) {
          this.host.onTextAutoGrow(this.node, desired);
        }
      }
    });
    this.textEl.addEventListener("blur", () => {
      if (!this.editing) return;
      this.stopEditing();
    });
    this.textEl.addEventListener("keydown", (event) => {
      event.stopPropagation();
      if (event.key === "Escape") {
        event.preventDefault();
        this.textEl?.blur();
      }
    });
    this.textEl.addEventListener("pointerdown", (event) => {
      if (this.editing) event.stopPropagation();
    });
    this.textEl.addEventListener("dblclick", (event) => {
      if (!this.editing) {
        event.stopPropagation();
        this.startEditing();
      }
    });
  }
}

function basename(path: string): string {
  const name = path.split("/").pop() ?? path;
  return name.replace(/\.md$/i, "");
}

function folderOf(path: string): string {
  const parts = path.split("/");
  parts.pop();
  return parts.length > 0 ? `${parts.join("/")}/` : "Vault";
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function placeCaretAtEnd(el: HTMLElement): void {
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  const selection = window.getSelection();
  if (!selection) return;
  selection.removeAllRanges();
  selection.addRange(range);
}
