import { sanitizeSegment } from "@xopcai/xopcbot/routing/session-key.js";

/**
 * Canonical Weixin bot account id (ilink / state paths).
 * Kept separate from `accounts.ts` so token store can import it without circular deps with `inbound`.
 */
export function normalizeWeixinAccountId(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/@/g, '-')
    .replace(/\./g, '-')
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Peer id as in session keys / context-token map (same rules as `buildSessionKey` peer segment).
 */
export function canonicalWeixinPeerId(rawPeerId: string): string {
  const t = rawPeerId.trim();
  const s = sanitizeSegment(t, { allowLeadingDash: true });
  return s || t.toLowerCase();
}

const ILINK_WECHAT_USER_SUFFIX = "-im-wechat";

/**
 * ilink sendmessage / getUploadUrl / getconfig expect `…@im.wechat` for C2C users.
 * Session/cron addresses use sanitized `…-im-wechat` (from `sanitizeSegment`); map back before API calls.
 */
export function toRawIlinkUserIdForApi(peerId: string): string {
  const t = peerId.trim();
  if (t.includes("@")) return t;
  if (t.toLowerCase().endsWith(ILINK_WECHAT_USER_SUFFIX)) {
    const prefix = t.slice(0, t.length - ILINK_WECHAT_USER_SUFFIX.length);
    return `${prefix}@im.wechat`;
  }
  return t;
}
