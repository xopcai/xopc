import { parseSessionKey } from '../routing/session-key.js';

/**
 * Resolves Telegram Bot API `chat_id` from cron delivery `to`.
 * Accepts numeric ids, full session keys (`main:telegram:...`), or mistaken
 * routing suffixes (`account:dm:peerId` / `account:group:peerId`).
 */
export function normalizeTelegramDeliveryChatId(to: string): string {
  const trimmed = to.trim();
  if (!trimmed) {
    return trimmed;
  }

  const parsed = parseSessionKey(trimmed);
  if (parsed?.source === 'telegram') {
    return parsed.peerId;
  }

  const parts = trimmed.split(':');
  if (
    parts.length === 3 &&
    (parts[1] === 'dm' || parts[1] === 'group') &&
    parts[2] !== ''
  ) {
    return parts[2];
  }

  return trimmed;
}
