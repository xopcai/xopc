/**
 * Access-control helpers passed to the inbound processor (Telegram-specific).
 */

import {
  normalizeAllowFromWithStore,
  evaluateGroupBaseAccess,
  resolveRequireMention,
  hasBotMention,
  removeBotMention as removeBotMentionAccess,
} from '../access-control.js';

export function createTelegramInboundAccessControl() {
  return {
    normalizeAllowFromWithStore: (opts: { allowFrom?: Array<string | number>; storeAllowFrom?: string[] }) =>
      normalizeAllowFromWithStore(opts),
    evaluateGroupBaseAccess: (opts: Parameters<typeof evaluateGroupBaseAccess>[0]) => evaluateGroupBaseAccess(opts),
    resolveRequireMention: (opts: Parameters<typeof resolveRequireMention>[0]) => resolveRequireMention(opts),
    hasBotMention: (opts: Parameters<typeof hasBotMention>[0]) => hasBotMention(opts),
    removeBotMention: (text: string, botUsername: string) => removeBotMentionAccess(text, botUsername),
  };
}
