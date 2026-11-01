import { setIcon } from "obsidian";
import { formatTime } from "../render/AudioCard";

export interface RecordHudActions {
  onStop(): void;
  onCancel(): void;
}

const BAR_COUNT = 44;

/**
 * The strip that sits above the toolbar while the microphone is open: elapsed time,
 * a rolling live trace, input level and the two ways to end the take.
 */
export class RecordHud {
  readonly el: HTMLElement;
  private readonly timeEl: HTMLElement;
  private readonly levelEl: HTMLElement;
  private readonly bars: HTMLElement[] = [];
  private readonly history: number[] = [];
  private timer: number | null = null;
  private seconds = 0;

  constructor(root: HTMLElement, private readonly actions: RecordHudActions) {
    this.el = root.createDiv({ cls: "cb-rec-hud" });
    this.el.setAttribute("role", "status");

    this.el.createSpan({ cls: "cb-rec-dot" });
    this.timeEl = this.el.createSpan({ cls: "cb-rec-time", text: "0:00" });

    const wave = this.el.createDiv({ cls: "cb-rec-wave" });
    for (let index = 0; index < BAR_COUNT; index++) {
      const bar = wave.createSpan({ cls: "cb-rec-bar" });
      this.bars.push(bar);
      this.history.push(0.08);
    }

    const meter = this.el.createDiv({ cls: "cb-rec-meter" });
    this.levelEl = meter.createDiv({ cls: "cb-rec-meter-fill" });

    const stop = this.el.createEl("button", {
      cls: "cb-rec-stop",
      attr: { type: "button" },
    });
    setIcon(stop.createSpan({ cls: "cb-rec-stop-icon" }), "square");
    stop.createSpan({ text: "Stop & pin" });
    stop.addEventListener("click", () => this.actions.onStop());

    const cancel = this.el.createEl("button", {
      cls: "cb-rec-cancel",
      attr: { type: "button" },
    });
    cancel.setText("Cancel");
    cancel.addEventListener("click", () => this.actions.onCancel());

    this.el.hidden = true;
  }

  begin(): void {
    this.seconds = 0;
    this.timeEl.textContent = "0:00";
    for (let index = 0; index < this.bars.length; index++) {
      this.history[index] = 0.08;
      this.bars[index].setCssProps({ "--cb-rec-peak": "8" });
    }
    this.el.hidden = false;
    this.el.classList.add("is-live");
    this.timer = window.setInterval(() => {
      this.seconds += 1;
      this.timeEl.textContent = formatTime(this.seconds);
    }, 1000);
  }

  setLevel(level: number): void {
    this.history.shift();
    this.history.push(Math.max(0.05, level));
    this.levelEl.setCssProps({ "--cb-rec-level": `${Math.round(level * 100)}%` });
    for (let index = 0; index < this.bars.length; index++) {
      this.bars[index].setCssProps({
        "--cb-rec-peak": `${Math.round(this.history[index] * 100)}`,
      });
    }
  }

  get elapsed(): number {
    return this.seconds;
  }

  end(): void {
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
    this.el.classList.remove("is-live");
    this.el.hidden = true;
  }

  destroy(): void {
    this.end();
    this.el.remove();
  }
}
