import type { AgentMessage } from '@earendil-works/pi-agent-core';

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

export function collectMediaUrisFromMessages(messages: readonly AgentMessage[]): Set<string> {
  const out = new Set<string>();
  const seen = new WeakSet<object>();
  for (const message of messages) collectFromValue(message, out, seen);
  return out;
}

export function messagesReferenceMediaUri(messages: readonly AgentMessage[], uri: string): boolean {
  return collectMediaUrisFromMessages(messages).has(uri.trim());
}

export async function deleteMediaUris(uris: Iterable<string>): Promise<void> {
  for (const uri of new Set(uris)) {
    const parsed = tryParseMediaUri(uri);
    if (!parsed) continue;
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
