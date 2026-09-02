type PathNode = Record<string, unknown>;

export function parseConfigPath(raw: string): { ok: boolean; path?: string[]; error?: string } {
  const parts = raw.trim().split('.').map((p) => p.trim());
  if (parts.some((p) => !p)) {
    return { ok: false, error: 'Invalid path. Use dot notation (e.g. agents.defaults.models.chat.primary).' };
  }
  return { ok: true, path: parts };
}

export function getConfigValueAtPath(root: PathNode, path: string[]): unknown {
  let cursor: unknown = root;
  for (const key of path) {
    if (typeof cursor !== 'object' || cursor === null) return undefined;
    cursor = (cursor as PathNode)[key];
  }
  return cursor;
}

export function setConfigValueAtPath(root: PathNode, path: string[], value: unknown): void {
  let cursor: PathNode = root;
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i];
    if (typeof cursor[key] !== 'object' || cursor[key] === null) cursor[key] = {};
    cursor = cursor[key] as PathNode;
  }
  cursor[path[path.length - 1]] = value;
}

export function unsetConfigValueAtPath(root: PathNode, path: string[]): boolean {
  let cursor: PathNode = root;
  for (let i = 0; i < path.length - 1; i++) {
    const next = cursor[path[i]];
    if (typeof next !== 'object' || next === null) return false;
    cursor = next as PathNode;
  }
  const leaf = path[path.length - 1];
  if (!(leaf in cursor)) return false;
  delete cursor[leaf];
  return true;
}
