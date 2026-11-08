import { createHash } from 'node:crypto';

/** Opaque revision for optimistic chat edits; includes scope and lifecycle changes. */
export function memoryVersion(value: unknown): string {
  if (value && typeof value === 'object' && 'retrievalSnippet' in value) {
    const { retrievalSnippet: _snippet, ...record } = value;
    value = record;
  }
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
