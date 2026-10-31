export interface PopoverOptions {
  placement?: "above" | "below";
  align?: "start" | "center" | "end";
  gap?: number;
  width?: number;
  onClose?: () => void;
}

let activePopover: Popover | null = null;

function rememberActivePopover(popover: Popover | null): void {
  activePopover = popover;
}

export class Popover {
  readonly el: HTMLElement;
  private anchor: HTMLElement | null = null;
  private onCloseCallback: (() => void) | null = null;
  private openState = false;

  constructor(
    private readonly root: HTMLElement,
    className = "",
  ) {
    this.el = this.root.createDiv({ cls: `cb-popover ${className}`.trim() });
    this.el.setAttribute("role", "dialog");
    this.el.setAttribute("aria-hidden", "true");
    this.el.toggleAttribute("hidden", true);
  }

  get isOpen(): boolean {
    return this.openState;
  }

  toggle(anchor: HTMLElement, build: (el: HTMLElement) => void, options: PopoverOptions = {}): boolean {
    if (this.openState && this.anchor === anchor) {
      this.close();
      return false;
    }
    this.open(anchor, build, options);
    return true;
  }

  open(anchor: HTMLElement, build: (el: HTMLElement) => void, options: PopoverOptions = {}): void {
    if (activePopover && activePopover !== this) activePopover.close();
    rememberActivePopover(this);

    this.anchor = anchor;
    this.onCloseCallback = options.onClose ?? null;
    this.el.empty();
    build(this.el);
    this.el.removeAttribute("hidden");
    this.el.classList.add("is-open");
    this.el.setAttribute("aria-hidden", "false");
    this.el.style.width = options.width ? `${options.width}px` : "";
    this.openState = true;

    this.el.addClass("is-measuring");
    this.position(anchor, options);
    this.el.removeClass("is-measuring");

    document.addEventListener("pointerdown", this.onOutsidePointer, true);
    document.addEventListener("keydown", this.onKeyDown, true);
  }

  close(): void {
    if (!this.openState) return;
    this.openState = false;
    this.el.classList.remove("is-open");
    this.el.setAttribute("aria-hidden", "true");
    this.el.toggleAttribute("hidden", true);
    this.el.empty();
    this.anchor = null;
    document.removeEventListener("pointerdown", this.onOutsidePointer, true);
    document.removeEventListener("keydown", this.onKeyDown, true);
    if (activePopover === this) activePopover = null;
    const callback = this.onCloseCallback;
    this.onCloseCallback = null;
    callback?.();
  }

  destroy(): void {
    this.close();
    this.el.remove();
  }

  private position(anchor: HTMLElement, options: PopoverOptions): void {
    const rootRect = this.root.getBoundingClientRect();
    const anchorRect = anchor.getBoundingClientRect();
    const rect = this.el.getBoundingClientRect();
    const gap = options.gap ?? 10;
    const placement = options.placement ?? "above";
    const align = options.align ?? "center";

    let left: number;
    if (align === "start") left = anchorRect.left - rootRect.left;
    else if (align === "end") left = anchorRect.right - rootRect.left - rect.width;
    else left = anchorRect.left - rootRect.left + anchorRect.width / 2 - rect.width / 2;

    let top: number;
    if (placement === "above") {
      top = anchorRect.top - rootRect.top - rect.height - gap;
      if (top < 12) top = anchorRect.bottom - rootRect.top + gap;
    } else {
      top = anchorRect.bottom - rootRect.top + gap;
      if (top + rect.height > rootRect.height - 12) {
        top = anchorRect.top - rootRect.top - rect.height - gap;
      }
    }

    const maxLeft = Math.max(12, rootRect.width - rect.width - 12);
    const maxTop = Math.max(12, rootRect.height - rect.height - 12);
    left = Math.min(Math.max(12, left), maxLeft);
    top = Math.min(Math.max(12, top), maxTop);

    this.el.style.left = `${Math.round(left)}px`;
    this.el.style.top = `${Math.round(top)}px`;
  }

  private onOutsidePointer = (event: PointerEvent): void => {
    const target = event.target;
    if (!(target instanceof Node)) return;
    if (this.el.contains(target)) return;
    if (this.anchor?.contains(target)) return;
    this.close();
  };

  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    this.close();
  };
}
