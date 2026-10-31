export interface HistoryEntry {
  label: string;
  before: string;
  after: string;
}

export class BoardHistory {
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  private pending: { label: string; before: string } | null = null;

  constructor(
    private readonly limit: number,
    private readonly onChange: () => void,
  ) {}

  begin(label: string, currentSnapshot: string): void {
    if (this.pending) return;
    this.pending = { label, before: currentSnapshot };
  }

  commit(currentSnapshot: string, label?: string): boolean {
    if (!this.pending) return false;
    const pending = this.pending;
    this.pending = null;
    if (pending.before === currentSnapshot) return false;
    this.undoStack.push({
      label: label ?? pending.label,
      before: pending.before,
      after: currentSnapshot,
    });
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack = [];
    this.onChange();
    return true;
  }

  cancel(): void {
    this.pending = null;
  }

  get isPending(): boolean {
    return this.pending !== null;
  }

  undo(): HistoryEntry | null {
    if (this.undoStack.length === 0) return null;
    const entry = this.undoStack.pop() as HistoryEntry;
    this.redoStack.push(entry);
    this.pending = null;
    this.onChange();
    return entry;
  }

  redo(): HistoryEntry | null {
    if (this.redoStack.length === 0) return null;
    const entry = this.redoStack.pop() as HistoryEntry;
    this.undoStack.push(entry);
    this.pending = null;
    this.onChange();
    return entry;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  get undoLabel(): string | null {
    return this.undoStack.at(-1)?.label ?? null;
  }

  get redoLabel(): string | null {
    return this.redoStack.at(-1)?.label ?? null;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.pending = null;
    this.onChange();
  }
}
