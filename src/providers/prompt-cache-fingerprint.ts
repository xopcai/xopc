import { createHash } from 'node:crypto';

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : undefined;
}

const MAX_FINGERPRINT_DEPTH = 64;
const MAX_FINGERPRINT_NODES = 20_000;
const MAX_FINGERPRINT_STRING_CHARS = 100_000;

function canonicalize(
  value: unknown,
  state: { nodes: number; seen: WeakSet<object> },
  depth: number,
): string {
  state.nodes += 1;
  if (depth > MAX_FINGERPRINT_DEPTH || state.nodes > MAX_FINGERPRINT_NODES) {
    return '"[fingerprint-limit]"';
  }
  if (typeof value === 'string' && value.length > MAX_FINGERPRINT_STRING_CHARS) {
    return JSON.stringify(`${value.slice(0, MAX_FINGERPRINT_STRING_CHARS)}[fingerprint-limit]`);
  }
  if (Array.isArray(value)) {
    if (state.seen.has(value)) return '"[circular]"';
    state.seen.add(value);
    const result = `[${value.map((entry) => canonicalize(entry, state, depth + 1)).join(',')}]`;
    state.seen.delete(value);
    return result;
  }
  const record = asRecord(value);
  if (record) {
    if (state.seen.has(record)) return '"[circular]"';
    state.seen.add(record);
    const result = `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalize(record[key], state, depth + 1)}`)
      .join(',')}}`;
    state.seen.delete(record);
    return result;
  }
  return JSON.stringify(value) ?? 'null';
}

/** Canonical JSON used only for bounded prompt-cache fingerprints. */
export function canonicalizeCacheValue(value: unknown): string {
  return canonicalize(value, { nodes: 0, seen: new WeakSet() }, 0);
}

export function digestCacheValue(value: unknown): string {
  return createHash('sha256').update(canonicalizeCacheValue(value)).digest('base64url');
}

export function digestCacheText(value: string): string {
  return createHash('sha256').update(value).digest('base64url');
}
