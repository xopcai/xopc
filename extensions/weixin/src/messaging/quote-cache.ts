import { DurableState } from '@xopcai/xopc/storage/sqlite/durable-state.js';
import { resolveMediaReference } from '@xopcai/xopc/media/index.js';
import type { MediaRef } from '@xopcai/xopc/media/types.js';

import { logger } from '../util/logger.js';

type QuotedMessage = { id: string; text: string; attachments: MediaRef[]; timestamp: number };

const cache = new DurableState<QuotedMessage[]>('weixin-quoted-messages');
const RETENTION_MS = 7 * 24 * 60 * 60_000;
const MAX_MESSAGES_PER_CHAT = 64;

function chatKey(scope: string, sender: string): string {
  return JSON.stringify([scope, sender]);
}

export function rememberWeixinQuotedMessage(scope: string, sender: string, id: string, text: string, attachments?: MediaRef[]): void {
  try {
    const now = Date.now();
    cache.update(chatKey(scope, sender), entries => ({
      value: [
        ...(entries ?? []).filter(entry => entry.id !== id && now - entry.timestamp <= RETENTION_MS).slice(-(MAX_MESSAGES_PER_CHAT - 1)),
        { id, text: text.slice(0, 4000), attachments: (attachments ?? []).slice(0, 8), timestamp: now },
      ],
      result: undefined,
    }));
  } catch {
    logger.debug('Weixin quote cache could not store the message');
  }
}

export async function getWeixinQuotedMessage(scope: string, sender: string, id: string): Promise<QuotedMessage | undefined> {
  try {
    const now = Date.now();
    const entry = cache.get(chatKey(scope, sender))?.find(row => row.id === id && now - row.timestamp <= RETENTION_MS);
    if (!entry) return;
    const attachments: MediaRef[] = [];
    for (const attachment of entry.attachments) {
      try {
        await resolveMediaReference(attachment.uri);
        attachments.push(attachment);
      } catch {
        // The shared media store may already have cleaned up the binary.
      }
    }
    return { ...entry, attachments };
  } catch {
    return undefined;
  }
}
