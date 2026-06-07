import path from 'node:path';

/** Find the actual key used for PATH (Windows may use `Path`). */
export function findPathKey(env: Record<string, string>): string {
  if ('PATH' in env) return 'PATH';
  for (const key of Object.keys(env)) {
    if (key.toUpperCase() === 'PATH') return key;
  }
  return 'PATH';
}

export function normalizePathPrepend(entries?: string[]): string[] {
  if (!Array.isArray(entries)) return [];
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const entry of entries) {
    if (typeof entry !== 'string') continue;
    const trimmed = entry.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    normalized.push(trimmed);
  }
  return normalized;
}

export function mergePathPrepend(existing: string | undefined, prepend: string[]): string {
  if (prepend.length === 0) return existing ?? '';
  const partsExisting = (existing ?? '')
    .split(path.delimiter)
    .map((part) => part.trim())
    .filter(Boolean);
  const merged: string[] = [];
  const seen = new Set<string>();
  for (const part of [...prepend, ...partsExisting]) {
    if (seen.has(part)) continue;
    seen.add(part);
    merged.push(part);
  }
  return merged.join(path.delimiter);
}

export function applyPathPrepend(
  env: Record<string, string>,
  prepend: string[] | undefined,
  options?: { requireExisting?: boolean },
): void {
  if (!Array.isArray(prepend) || prepend.length === 0) return;
  const pathKey = findPathKey(env);
  if (options?.requireExisting && !env[pathKey]) return;
  const merged = mergePathPrepend(env[pathKey], prepend);
  if (merged) env[pathKey] = merged;
}
