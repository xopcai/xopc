export const RECENT_DIRS_KEY = 'xopc.recentWorkspaceDirs.v1';
export const MAX_RECENT_DIRS = 10;

function readRecentDirs(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_DIRS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
      : [];
  } catch {
    return [];
  }
}

export function pushRecentDir(path: string): void {
  const t = path.trim();
  if (!t) return;
  try {
    const prev = readRecentDirs();
    const next = [t, ...prev.filter((p) => p !== t)].slice(0, MAX_RECENT_DIRS);
    localStorage.setItem(RECENT_DIRS_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

/** Last path segment for display (folder name only). */
export function folderDisplayName(absPath: string): string {
  const t = absPath.trim().replace(/[/\\]+$/, '');
  if (!t) return absPath;
  const parts = t.split(/[/\\]/);
  return parts[parts.length - 1] || t;
}
