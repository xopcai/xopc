import type { AgentMessage } from '@earendil-works/pi-agent-core';

import { deleteMediaBuffer } from './store.js';
import { tryParseMediaUri } from './uri.js';

function collectFromValue(value: unknown, out: Set<string>): void {
  if (!value) return;
  if (typeof value === 'string') {
    if (value.startsWith('media://')) out.add(value.trim());
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectFromValue(item, out);
    return;
  }
  if (typeof value !== 'object') return;

  const record = value as Record<string, unknown>;
  if (typeof record.uri === 'string' && record.uri.startsWith('media://')) {
    out.add(record.uri.trim());
  }
  if (Array.isArray(record.media)) collectFromValue(record.media, out);
  if (Array.isArray(record.attachments)) collectFromValue(record.attachments, out);
}

export function collectMediaUrisFromMessages(messages: readonly AgentMessage[]): Set<string> {
  const out = new Set<string>();
  for (const message of messages) collectFromValue(message, out);
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
