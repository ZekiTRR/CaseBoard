import { App, TFile, normalizePath } from "obsidian";

export function resolveNote(app: App, input: string, contextPath = ""): TFile | null {
  let target = input.trim();
  if (!target) return null;
  if (target.startsWith("[[") && target.endsWith("]]")) target = target.slice(2, -2);
  const pipe = target.indexOf("|");
  if (pipe !== -1) target = target.slice(0, pipe);
  const hash = target.indexOf("#");
  if (hash !== -1) target = target.slice(0, hash);
  target = target.trim();
  if (!target) return null;

  const direct = app.vault.getAbstractFileByPath(normalizePath(target));
  if (direct instanceof TFile && direct.extension === "md") return direct;

  const withExtension = target.endsWith(".md") ? target : `${target}.md`;
  const byPath = app.vault.getAbstractFileByPath(normalizePath(withExtension));
  if (byPath instanceof TFile) return byPath;

  const resolved = app.metadataCache.getFirstLinkpathDest(target, contextPath);
  if (resolved instanceof TFile && resolved.extension === "md") return resolved;
  return null;
}

export function resolveAsset(app: App, input: string, contextPath = ""): TFile | null {
  let target = input.trim();
  if (!target) return null;
  if (target.startsWith("[[") && target.endsWith("]]")) target = target.slice(2, -2);
  const direct = app.vault.getAbstractFileByPath(normalizePath(target));
  if (direct instanceof TFile) return direct;
  return app.metadataCache.getFirstLinkpathDest(target, contextPath);
}
