let counter = 0;

export function uid(prefix = "cb"): string {
  counter = (counter + 1) % 0x10000;
  const time = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${time}-${counter.toString(36)}-${random}`;
}
