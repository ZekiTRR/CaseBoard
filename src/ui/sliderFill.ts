/**
 * Range inputs are styled with a filled groove, and the fill has to follow the
 * value — including when a panel writes `input.value` while refreshing itself.
 */
export function paintSliderFill(input: HTMLInputElement): void {
  const min = Number(input.min || "0");
  const max = Number(input.max || "100");
  const span = max - min || 1;
  const ratio = (Number(input.value) - min) / span;
  const percent = Math.max(0, Math.min(1, ratio)) * 100;
  input.setCssProps({ "--cb-slider-fill": `${percent.toFixed(2)}%` });
}

export function watchSliderFill(input: HTMLInputElement): HTMLInputElement {
  paintSliderFill(input);
  const repaint = () => paintSliderFill(input);
  input.addEventListener("input", repaint);
  input.addEventListener("change", repaint);
  return input;
}

export function paintAllSliders(container: HTMLElement): void {
  container.querySelectorAll<HTMLInputElement>("input[type=range]").forEach(paintSliderFill);
}
