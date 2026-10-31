import { setIcon, setTooltip } from "obsidian";
import type { AnchorKind, BoardConnection, ThreadMode } from "../core/types";
import type { BoardTheme } from "../render/themes";

export interface ThreadInspectorHost {
  getConnection(id: string): BoardConnection | null;
  getTheme(): BoardTheme;
  getNodeLabel(nodeId: string): string;
  beginLiveEdit(label: string): void;
  updateConnectionLive(id: string, patch: Partial<BoardConnection>): void;
  endLiveEdit(): void;
  changeConnection(id: string, patch: Partial<BoardConnection>, label: string): void;
  deleteConnection(id: string): void;
  deselectThread(): void;
}

const MODES: Array<{ id: ThreadMode; label: string; hint: string }> = [
  { id: "dynamic", label: "Dynamic", hint: "A slack thread that settles with a little inertia." },
  { id: "taut", label: "Taut", hint: "A tight thread with automatic tension." },
  { id: "static", label: "Static", hint: "No simulation — the cheapest option." },
];

const ANCHORS: Array<{ id: AnchorKind; label: string }> = [
  { id: "auto", label: "Auto edge" },
  { id: "pin", label: "Pin" },
  { id: "tape", label: "Tape" },
  { id: "top", label: "Top" },
  { id: "right", label: "Right" },
  { id: "bottom", label: "Bottom" },
  { id: "left", label: "Left" },
];

interface Controls {
  endLabel: HTMLElement;
  dot: HTMLElement;
  modeButtons: Map<ThreadMode, HTMLButtonElement>;
  autoTension: HTMLInputElement;
  animated: HTMLInputElement;
  swatches: HTMLElement;
  customColor: HTMLInputElement;
  width: HTMLInputElement;
  widthValue: HTMLElement;
  sag: HTMLInputElement;
  sagValue: HTMLElement;
  tension: HTMLInputElement;
  tensionValue: HTMLElement;
  fromAnchor: HTMLSelectElement;
  toAnchor: HTMLSelectElement;
}

export class ThreadInspector {
  readonly el: HTMLElement;
  private controls: Controls | null = null;
  private currentId: string | null = null;
  private liveEdited = false;

  constructor(
    root: HTMLElement,
    private readonly host: ThreadInspectorHost,
  ) {
    this.el = root.createDiv({ cls: "cb-thread-inspector" });
    this.el.toggleAttribute("hidden", true);
    this.build();
  }

  setConnection(connection: BoardConnection | null): void {
    if (this.liveEdited && (!connection || connection.id !== this.currentId)) {
      this.finishLive();
    }
    if (!connection) {
      this.el.toggleAttribute("hidden", true);
      this.el.classList.remove("is-open");
      this.currentId = null;
      this.liveEdited = false;
      return;
    }
    const isSame = this.currentId === connection.id && this.el.classList.contains("is-open");
    this.currentId = connection.id;
    this.el.removeAttribute("hidden");
    window.requestAnimationFrame(() => this.el.classList.add("is-open"));
    if (!isSame) this.rebuildSwatches(connection.color);
    this.sync(connection);
  }

  destroy(): void {
    this.el.remove();
  }

  private build(): void {
    const head = this.el.createDiv({ cls: "cb-inspector-head" });
    const titleWrap = head.createDiv({ cls: "cb-inspector-titles" });
    const kicker = titleWrap.createDiv({ cls: "cb-eyebrow", text: "Thread" });
    const dot = titleWrap.createDiv({ cls: "cb-inspector-thread" });
    const dotMark = dot.createSpan({ cls: "cb-thread-color-dot" });
    const endLabel = dot.createSpan({ cls: "cb-inspector-endpoints" });
    const close = head.createEl("button", {
      cls: "cb-icon-button cb-inspector-close",
      attr: { type: "button", "aria-label": "Close thread panel" },
    });
    setIcon(close, "x");
    close.addEventListener("click", () => this.host.deselectThread());
    kicker.title = "";
    dotMark.title = "";

    const body = this.el.createDiv({ cls: "cb-inspector-body" });

    const modeLabel = body.createDiv({ cls: "cb-field-label", text: "Physics" });
    modeLabel.setAttribute("aria-hidden", "true");
    const modeGroup = body.createDiv({ cls: "cb-segmented", attr: { role: "group" } });
    const modeButtons = new Map<ThreadMode, HTMLButtonElement>();
    for (const mode of MODES) {
      const button = modeGroup.createEl("button", {
        cls: "cb-segment",
        text: mode.label,
        attr: { type: "button", "aria-label": mode.label },
      });
      setTooltip(button, mode.hint);
      button.addEventListener("click", () => {
        if (!this.currentId) return;
        this.host.changeConnection(this.currentId, { physics: mode.id }, "Thread physics");
        for (const [id, item] of modeButtons) item.classList.toggle("is-active", id === mode.id);
      });
      modeButtons.set(mode.id, button);
    }

    const autoRow = this.toggleRow(body, "Auto tension", "Takes up slack as cards move.");
    const autoTension = autoRow.input;
    autoTension.addEventListener("change", () => {
      if (!this.currentId) return;
      this.host.changeConnection(
        this.currentId,
        { autoTension: autoTension.checked },
        "Auto tension",
      );
    });

    const animateRow = this.toggleRow(body, "Sway", "A subtle life-like drift while working.");
    const animated = animateRow.input;
    animated.addEventListener("change", () => {
      if (!this.currentId) return;
      this.host.changeConnection(
        this.currentId,
        { animated: animated.checked },
        "Thread sway",
      );
    });

    const colorLabel = body.createDiv({ cls: "cb-field-label", text: "Colour" });
    colorLabel.setAttribute("aria-hidden", "true");
    const colorRow = body.createDiv({ cls: "cb-color-row" });
    const swatches = colorRow.createDiv({ cls: "cb-swatches" });
    const customLabel = colorRow.createEl("label", {
      cls: "cb-color-custom",
      attr: { title: "Custom colour", "aria-label": "Custom colour" },
    });
    setIcon(customLabel.createSpan({ cls: "cb-color-custom-icon" }), "pipette");
    const customColor = customLabel.createEl("input", {
      attr: { type: "color", value: "#a6322c" },
    });
    customColor.addEventListener("input", () => {
      if (!this.currentId) return;
      if (!this.liveEdited) {
        this.host.beginLiveEdit("Thread colour");
        this.liveEdited = true;
      }
      this.host.updateConnectionLive(this.currentId, { color: customColor.value });
      this.updateDot(customColor.value);
    });
    customColor.addEventListener("change", () => {
      if (!this.liveEdited) return;
      this.liveEdited = false;
      this.host.endLiveEdit();
    });

    const widthControl = this.slider(body, "Thickness", 0.8, 8, 0.2, "2.4 px");
    const sagControl = this.slider(body, "Sag", 0, 1.5, 0.05, "55%");
    const tensionControl = this.slider(body, "Tension", 0, 1, 0.05, "35%");

    const anchorRow = body.createDiv({ cls: "cb-anchor-row" });
    const fromAnchor = this.anchorSelect(anchorRow, "From");
    const toAnchor = this.anchorSelect(anchorRow, "To");

    const footer = this.el.createDiv({ cls: "cb-inspector-foot" });
    const del = footer.createEl("button", {
      cls: "cb-danger-button",
      attr: { type: "button" },
    });
    setIcon(del.createSpan({ cls: "cb-inline-icon" }), "trash-2");
    del.createSpan({ text: "Remove thread" });
    del.addEventListener("click", () => {
      if (!this.currentId) return;
      this.host.deleteConnection(this.currentId);
    });

    this.controls = {
      endLabel,
      dot: dotMark,
      modeButtons,
      autoTension,
      animated,
      swatches,
      customColor,
      width: widthControl.input,
      widthValue: widthControl.value,
      sag: sagControl.input,
      sagValue: sagControl.value,
      tension: tensionControl.input,
      tensionValue: tensionControl.value,
      fromAnchor,
      toAnchor,
    };

    this.bindLive(
      widthControl,
      (value) => {
        if (!this.currentId) return;
        if (!this.liveEdited) {
          this.host.beginLiveEdit("Thread thickness");
          this.liveEdited = true;
        }
        this.host.updateConnectionLive(this.currentId, { width: value });
        widthControl.valueEl.textContent = `${value.toFixed(1)} px`;
      },
      () => this.finishLive(),
    );
    this.bindLive(
      sagControl,
      (value) => {
        if (!this.currentId) return;
        if (!this.liveEdited) {
          this.host.beginLiveEdit("Thread sag");
          this.liveEdited = true;
        }
        this.host.updateConnectionLive(this.currentId, { sag: value });
        sagControl.valueEl.textContent = `${Math.round(value * 100)}%`;
      },
      () => this.finishLive(),
    );
    this.bindLive(
      tensionControl,
      (value) => {
        if (!this.currentId) return;
        if (!this.liveEdited) {
          this.host.beginLiveEdit("Thread tension");
          this.liveEdited = true;
        }
        this.host.updateConnectionLive(this.currentId, { tension: value });
        tensionControl.valueEl.textContent = `${Math.round(value * 100)}%`;
      },
      () => this.finishLive(),
    );

    fromAnchor.addEventListener("change", () => {
      if (!this.currentId) return;
      this.host.changeConnection(
        this.currentId,
        { from: { nodeId: this.getConnectionFrom()?.from.nodeId ?? "", anchor: fromAnchor.value as AnchorKind } },
        "Thread attachment",
      );
    });
    toAnchor.addEventListener("change", () => {
      if (!this.currentId) return;
      this.host.changeConnection(
        this.currentId,
        { to: { nodeId: this.getConnectionFrom()?.to.nodeId ?? "", anchor: toAnchor.value as AnchorKind } },
        "Thread attachment",
      );
    });
  }

  private getConnectionFrom(): BoardConnection | null {
    return this.currentId ? this.host.getConnection(this.currentId) : null;
  }

  private finishLive(): void {
    if (!this.liveEdited) return;
    this.liveEdited = false;
    this.host.endLiveEdit();
  }

  private sync(connection: BoardConnection): void {
    if (!this.controls) return;
    const controls = this.controls;
    for (const [id, button] of controls.modeButtons) {
      button.classList.toggle("is-active", id === connection.physics);
    }
    controls.autoTension.checked = connection.autoTension;
    controls.animated.checked = connection.animated;
    controls.animated.disabled = connection.physics !== "taut";
    controls.width.value = String(connection.width);
    controls.widthValue.textContent = `${connection.width.toFixed(1)} px`;
    controls.sag.value = String(connection.sag);
    controls.sagValue.textContent = `${Math.round(connection.sag * 100)}%`;
    controls.tension.value = String(connection.tension);
    controls.tensionValue.textContent = `${Math.round(connection.tension * 100)}%`;
    controls.fromAnchor.value = connection.from.anchor;
    controls.toAnchor.value = connection.to.anchor;
    controls.customColor.value = toColorInput(connection.color);
    controls.endLabel.textContent = `${this.host.getNodeLabel(
      connection.from.nodeId,
    )} → ${this.host.getNodeLabel(connection.to.nodeId)}`;
    this.updateDot(connection.color);
    for (const swatch of Array.from(controls.swatches.children)) {
      const element = swatch as HTMLElement;
      element.classList.toggle("is-active", element.dataset.color === connection.color);
    }
  }

  private rebuildSwatches(color: string): void {
    if (!this.controls) return;
    const swatches = this.controls.swatches;
    swatches.empty();
    const palette = [...this.host.getTheme().threadPalette];
    if (!palette.includes(color)) palette.push(color);
    for (const swatchColor of palette) {
      const button = swatches.createEl("button", {
        cls: "cb-swatch",
        attr: { type: "button", "aria-label": swatchColor, title: swatchColor },
      });
      button.style.background = swatchColor;
      button.dataset.color = swatchColor;
      button.addEventListener("click", () => {
        if (!this.currentId) return;
        this.host.changeConnection(this.currentId, { color: swatchColor }, "Thread colour");
        this.rebuildSwatches(swatchColor);
        const conn = this.getConnectionFrom();
        if (conn) this.sync(conn);
      });
      if (swatchColor === color) button.classList.add("is-active");
    }
  }

  private updateDot(color: string): void {
    if (this.controls) this.controls.dot.style.background = color;
  }

  private toggleRow(parent: HTMLElement, label: string, hint: string): { input: HTMLInputElement } {
    const row = parent.createDiv({ cls: "cb-toggle-row" });
    const text = row.createDiv({ cls: "cb-toggle-text" });
    text.createDiv({ cls: "cb-toggle-label", text: label });
    text.createDiv({ cls: "cb-toggle-hint", text: hint });
    const control = row.createEl("label", { cls: "cb-switch" });
    const input = control.createEl("input", { attr: { type: "checkbox" } });
    control.createSpan({ cls: "cb-switch-track" });
    setTooltip(control, hint);
    return { input };
  }

  private slider(
    parent: HTMLElement,
    label: string,
    min: number,
    max: number,
    step: number,
    initial: string,
  ): { input: HTMLInputElement; value: HTMLElement; valueEl: HTMLElement } {
    const row = parent.createDiv({ cls: "cb-slider-row" });
    const head = row.createDiv({ cls: "cb-slider-head" });
    head.createSpan({ cls: "cb-field-label", text: label });
    const value = head.createSpan({ cls: "cb-slider-value", text: initial });
    const input = row.createEl("input", {
      cls: "cb-slider",
      attr: {
        type: "range",
        min: String(min),
        max: String(max),
        step: String(step),
        "aria-label": label,
      },
    });
    return { input, value, valueEl: value };
  }

  private bindLive(
    control: { input: HTMLInputElement; valueEl: HTMLElement },
    onInput: (value: number) => void,
    onEnd: () => void,
  ): void {
    control.input.addEventListener("input", () => onInput(Number(control.input.value)));
    control.input.addEventListener("change", () => onEnd());
    control.input.addEventListener("pointerup", () => onEnd());
  }

  private anchorSelect(parent: HTMLElement, label: string): HTMLSelectElement {
    const wrap = parent.createDiv({ cls: "cb-anchor-field" });
    wrap.createDiv({ cls: "cb-field-label", text: label });
    const select = wrap.createEl("select", { cls: "cb-select" });
    for (const anchor of ANCHORS) {
      select.createEl("option", { value: anchor.id, text: anchor.label });
    }
    return select;
  }
}

function toColorInput(color: string): string {
  return /^#[0-9a-f]{6}$/i.test(color) ? color : "#a6322c";
}
