export class Debouncer {
  private timer: number | null = null;
  private lastCall = 0;

  constructor(
    private readonly callback: () => void,
    private delay: number,
  ) {}

  setDelay(delay: number): void {
    this.delay = delay;
  }

  schedule(): void {
    this.lastCall = Date.now();
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      this.timer = null;
      this.callback();
    }, this.delay);
  }

  cancel(): void {
    if (this.timer !== null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
  }

  get pending(): boolean {
    return this.timer !== null;
  }

  flush(): void {
    if (this.timer !== null) {
      this.cancel();
      this.callback();
    }
  }

  get lastCalledAt(): number {
    return this.lastCall;
  }

  dispose(): void {
    this.cancel();
  }
}

export function debounce<T extends (...args: never[]) => void>(fn: T, delay: number): T & { cancel: () => void; flush: () => void } {
  let timer: number | null = null;
  let lastArgs: never[] | null = null;

  const wrapped = ((...args: never[]) => {
    lastArgs = args;
    if (timer !== null) window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      timer = null;
      if (lastArgs) {
        const current = lastArgs;
        lastArgs = null;
        fn(...current);
      }
    }, delay);
  }) as T & { cancel: () => void; flush: () => void };

  wrapped.cancel = () => {
    if (timer !== null) window.clearTimeout(timer);
    timer = null;
    lastArgs = null;
  };

  wrapped.flush = () => {
    if (timer !== null) {
      window.clearTimeout(timer);
      timer = null;
    }
    if (lastArgs) {
      const current = lastArgs;
      lastArgs = null;
      fn(...current);
    }
  };

  return wrapped;
}
