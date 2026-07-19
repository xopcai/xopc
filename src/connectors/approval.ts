import { createHash } from 'node:crypto';

const SENSITIVE_KEY = /(authorization|cookie|password|secret|token|api[_-]?key|credential)/i;
const MAX_PREVIEW_DEPTH = 3;
const MAX_PREVIEW_ARRAY = 10;
const MAX_PREVIEW_STRING = 160;

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalize(child)]),
  );
}

export function connectorArgumentsHash(args: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(canonicalize(args))).digest('hex');
}

function previewValue(value: unknown, depth: number): unknown {
  if (depth >= MAX_PREVIEW_DEPTH) return '[nested]';
  if (typeof value === 'string') {
    return value.length > MAX_PREVIEW_STRING ? `${value.slice(0, MAX_PREVIEW_STRING)}…` : value;
  }
  if (typeof value === 'number' || typeof value === 'boolean' || value == null) return value;
  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_PREVIEW_ARRAY).map((item) => previewValue(item, depth + 1));
    if (value.length > MAX_PREVIEW_ARRAY) items.push(`[+${value.length - MAX_PREVIEW_ARRAY} items]`);
    return items;
  }
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, child]) => [
      key,
      SENSITIVE_KEY.test(key) ? '[redacted]' : previewValue(child, depth + 1),
    ]));
  }
  return String(value);
}

export function connectorArgumentsPreview(args: Record<string, unknown>): Record<string, unknown> {
  return previewValue(args, 0) as Record<string, unknown>;
}
