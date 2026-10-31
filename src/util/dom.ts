export function isTextEditing(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.isContentEditable) return true;
  return target.closest(".cm-editor") !== null;
}

export function isInside(target: EventTarget | null, parent: HTMLElement | null): boolean {
  return parent !== null && target instanceof Node && parent.contains(target);
}

export function setVars(el: HTMLElement, vars: Record<string, string>): void {
  for (const [key, value] of Object.entries(vars)) {
    el.style.setProperty(key, value);
  }
}

export function removeVars(el: HTMLElement, keys: string[]): void {
  for (const key of keys) el.style.removeProperty(key);
}

export function toggleClass(el: HTMLElement, className: string, enabled: boolean): void {
  if (enabled) el.classList.add(className);
  else el.classList.remove(className);
}

export function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

export function getScrollParent(el: HTMLElement | null): HTMLElement | null {
  let current = el?.parentElement ?? null;
  while (current) {
    const style = getComputedStyle(current);
    const overflow = style.overflowY;
    if ((overflow === "auto" || overflow === "scroll") && current.scrollHeight > current.clientHeight) {
      return current;
    }
    current = current.parentElement;
  }
  return null;
}
