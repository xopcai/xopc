import { LOCAL_READ_MAX_CHARS } from './local-read-budget.js';

/** Bound model-visible reads and disclose every omitted field or list item. */
export function boundedPersonalResult(value: unknown): unknown {
  let truncated = false;
  const project = (entry: unknown, depth = 0): unknown => {
    if (typeof entry === 'string') {
      if (entry.length > 600) truncated = true;
      return entry.slice(0, 600);
    }
    if (!entry || typeof entry !== 'object') return entry;
    if (depth > 6) { truncated = true; return '[omitted]'; }
    if (Array.isArray(entry)) {
      if (entry.length > 20) truncated = true;
      return entry.slice(0, 20).map(item => project(item, depth + 1));
    }
    return Object.fromEntries(Object.entries(entry).map(([key, item]) => [key, project(item, depth + 1)]));
  };
  const result = project(value);
  if (!result || typeof result !== 'object' || Array.isArray(result)) return result;
  const payload = result as Record<string, unknown>;
  let removedItems = false;
  const items = payload.items as unknown[] | undefined;
  if (Array.isArray(items)) {
    while (items.length && JSON.stringify(payload).length > LOCAL_READ_MAX_CHARS - 100) {
      items.pop(); truncated = true; removedItems = true;
    }
    if (!items.length && removedItems) return { ...payload, nextOffset: undefined, truncated: true, requiresSpecialist: true, guidance: 'A single item exceeds the local read budget.' };
    if (typeof payload.offset === 'number' && (removedItems || (typeof payload.total === 'number' && payload.offset + items.length < payload.total))) {
      payload.nextOffset = payload.offset + items.length;
    }
  }
  if (JSON.stringify(payload).length > LOCAL_READ_MAX_CHARS - 100) {
    return { truncated: true, requiresSpecialist: true, guidance: 'Complete details exceed the local read budget.' };
  }
  return { ...payload, ...(truncated ? { truncated: true, excerpts: true, ...(!Array.isArray(items) ? { requiresSpecialist: true } : {}) } : {}) };
}
