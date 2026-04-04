import { parseSessionKey } from '../routing/session-key.js';
import type { SessionStore } from '../session/store.js';

export type NormalizedWeixinCronDelivery = {
  chatId: string;
  /** Set on OutboundMessage.metadata for multi-account Weixin */
  accountId?: string;
};

/**
 * Resolves Weixin ilink `chat_id` and optional `accountId` from cron / UI `delivery.to`.
 * Accepts a full session key (`main:weixin:{accountId}:dm:{peerId}`) or shorthand
 * `{accountId}:dm:{peerId}` (same shape as Telegram delivery suffix).
 */
export function normalizeWeixinCronDeliveryTo(to: string): NormalizedWeixinCronDelivery {
  const trimmed = to.trim();
  if (!trimmed) {
    return { chatId: trimmed };
  }

  const parsed = parseSessionKey(trimmed);
  if (parsed?.source === 'weixin' && parsed.peerKind === 'dm' && parsed.peerId) {
    const accountId = parsed.accountId && parsed.accountId !== '_' ? parsed.accountId : undefined;
    return { chatId: parsed.peerId, accountId };
  }

  const parts = trimmed.split(':');
  if (parts.length === 3 && parts[1]?.toLowerCase() === 'dm' && parts[0] && parts[2]) {
    return { chatId: parts[2], accountId: parts[0] };
  }

  return { chatId: trimmed };
}

/**
 * If exactly one indexed weixin DM session matches `ilinkPeerId`, return that session's accountId.
 * Used when cron `delivery.to` is only the peer id (no `{accountId}:dm:…` suffix).
 */
export async function resolveWeixinAccountIdFromSessions(
  store: SessionStore,
  ilinkPeerId: string,
): Promise<string | undefined> {
  const normalized = ilinkPeerId.trim().toLowerCase();
  if (!normalized) return undefined;

  const accountIds = new Set<string>();
  let offset = 0;
  const pageSize = 2000;

  for (;;) {
    const batch = await store.list({ channel: 'weixin', limit: pageSize, offset });
    for (const s of batch.items) {
      const rp = s.routing?.peerId?.toLowerCase();
      if (rp === normalized && s.routing?.accountId) {
        accountIds.add(s.routing.accountId);
      }
    }
    if (!batch.hasMore) break;
    offset += pageSize;
  }

  if (accountIds.size === 1) return [...accountIds][0];
  return undefined;
}

/** Like {@link normalizeWeixinCronDeliveryTo}, plus session-index lookup for bare ilink user ids. */
export async function normalizeWeixinCronDeliveryToResolved(
  to: string,
  sessionStore?: SessionStore,
): Promise<NormalizedWeixinCronDelivery> {
  const base = normalizeWeixinCronDeliveryTo(to);
  if (base.accountId || !sessionStore) return base;
  if (!to.trim().includes(':')) {
    const accountId = await resolveWeixinAccountIdFromSessions(sessionStore, base.chatId);
    if (accountId) return { chatId: base.chatId, accountId };
  }
  return base;
}
