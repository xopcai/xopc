import { GrammyError, type Bot } from 'grammy';

import { buildSendOptions } from './send-options.js';

const unavailable = new WeakSet<Bot['api']>();
const RICH_BLOCK_PATTERN = /^(?: {0,3}(?:```|~~~|>\s?)|\s*\|.+\|\s*$)/m;

export function prefersTelegramRichMessage(text: string): boolean {
  return text.length <= 16_000 && RICH_BLOCK_PATTERN.test(text);
}

export async function sendTelegramRichMessage(
  api: Bot['api'],
  chatId: string,
  content: string,
  options?: Parameters<typeof buildSendOptions>[0],
): Promise<number | undefined> {
  if (unavailable.has(api) || typeof api.sendRichMessage !== 'function' || !prefersTelegramRichMessage(content)) return;
  try {
    const response = await api.sendRichMessage(chatId, { markdown: content }, buildSendOptions(options ?? {}));
    return response.message_id;
  } catch (err) {
    if (err instanceof GrammyError && err.error_code === 404) {
      unavailable.add(api);
      return;
    }
    // A rejected rich payload can fall back safely; a transport failure can be ambiguous.
    if (err instanceof GrammyError && err.error_code === 400) return;
    throw err;
  }
}
