export function normalizeFolderSetting(folder: string): string {
  const trimmed = folder.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (!trimmed || trimmed.split("/").some((part) => !part || part === "..")) return "";
  return trimmed;
}
