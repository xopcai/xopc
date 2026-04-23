type OverrideTree = Record<string, unknown>;

let overrides: OverrideTree = {};

export function getConfigOverrides(): OverrideTree {
  return overrides;
}

export function resetConfigOverrides(): void {
  overrides = {};
}

export function setConfigOverride(path: string[], value: unknown): void {
  let cursor: OverrideTree = overrides;
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i];
    if (typeof cursor[key] !== 'object' || cursor[key] === null) cursor[key] = {};
    cursor = cursor[key] as OverrideTree;
  }
  cursor[path[path.length - 1]] = value;
}

export function unsetConfigOverride(path: string[]): void {
  let cursor: OverrideTree = overrides;
  for (let i = 0; i < path.length - 1; i++) {
    const next = cursor[path[i]];
    if (typeof next !== 'object' || next === null) return;
    cursor = next as OverrideTree;
  }
  delete cursor[path[path.length - 1]];
}

/** Deep-merge overrides on top of base config (process lifetime only). */
export function applyConfigOverrides<T extends object>(base: T): T {
  return deepMerge(base, overrides) as T;
}

function deepMerge(base: unknown, override: unknown): unknown {
  if (
    typeof base !== 'object' ||
    base === null ||
    typeof override !== 'object' ||
    override === null
  ) {
    return override ?? base;
  }
  const result = { ...(base as Record<string, unknown>) };
  for (const [key, value] of Object.entries(override as Record<string, unknown>)) {
    result[key] = deepMerge(result[key], value);
  }
  return result;
}
