import type { AgentMessage } from '@earendil-works/pi-agent-core';

import { getSqliteDatabase } from '../storage/sqlite/index.js';
import { deleteMediaBuffer } from './store.js';
import { tryParseMediaUri } from './uri.js';

function collectFromValue(value: unknown, out: Set<string>, seen: WeakSet<object>): void {
  if (!value) return;
  if (typeof value === 'string') {
    if (value.startsWith('media://')) out.add(value.trim());
    return;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) return;
    seen.add(value);
    for (const item of value) collectFromValue(item, out, seen);
    return;
  }
  if (typeof value !== 'object') return;

  if (seen.has(value)) return;
  seen.add(value);
  const record = value as Record<string, unknown>;
  for (const nested of Object.values(record)) {
    collectFromValue(nested, out, seen);
  }
}

export function collectMediaUrisFromValues(values: readonly unknown[]): Set<string> {
  const out = new Set<string>();
  const seen = new WeakSet<object>();
  for (const value of values) collectFromValue(value, out, seen);
  return out;
}

export function collectMediaUrisFromMessages(messages: readonly AgentMessage[]): Set<string> {
  return collectMediaUrisFromValues(messages);
}

export function messagesReferenceMediaUri(messages: readonly AgentMessage[], uri: string): boolean {
  return collectMediaUrisFromMessages(messages).has(uri.trim());
}

/**
 * A media object remains live while any non-deleted session references it,
 * including archived transcripts retained by a reset of that session key.
 */
export function isMediaUriReferencedByLiveSession(uri: string): boolean {
  const normalized = uri.trim();
  if (!normalized) return false;
  const escaped = JSON.stringify(normalized)
    .replaceAll('\\', '\\\\')
    .replaceAll('%', '\\%')
    .replaceAll('_', '\\_');
  const row = getSqliteDatabase()
    .prepare(
      `SELECT 1 AS referenced
       FROM transcript_entries e
       JOIN transcripts t ON t.session_id = e.session_id
       JOIN sessions s ON s.session_key = t.session_key
       WHERE e.payload_json LIKE ? ESCAPE '\\'
       LIMIT 1`,
    )
    .get(`%${escaped}%`) as { referenced?: number } | undefined;
  return row?.referenced === 1;
}

export async function deleteMediaUris(uris: Iterable<string>): Promise<void> {
  for (const uri of new Set(uris)) {
    const parsed = tryParseMediaUri(uri);
    if (!parsed) continue;
    if (isMediaUriReferencedByLiveSession(uri)) continue;
    await deleteMediaBuffer(parsed.id, parsed.bucket).catch(() => {});
  }
}

export async function deleteMediaUrisNoLongerReferenced(params: {
  removed: readonly AgentMessage[];
  remaining: readonly AgentMessage[];
}): Promise<void> {
  const removedUris = collectMediaUrisFromMessages(params.removed);
  if (removedUris.size === 0) return;

  const remainingUris = collectMediaUrisFromMessages(params.remaining);
  for (const uri of remainingUris) removedUris.delete(uri);
  await deleteMediaUris(removedUris);
}
