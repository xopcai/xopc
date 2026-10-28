import { weixinAccountIdentityRevision } from '../../channels/weixin/account-identity.js';
import type { Config } from '../../config/schema.js';
import { readAllowFromIdsSync, resolveWeixinAllowFromPath } from '../../channels/pairing/index.js';
import { getConversationRouting } from '../../routing/session-key.js';
import { resolveReverseProxyPublicUrl } from '../../gateway/public-url.js';

export type WeixinPrivateIdentity = { accountId: string; peerId: string; principalId: string };
export type WeixinSetupScope = WeixinPrivateIdentity & { origin: string };

/** Pairing permits a bounded proposal; it never grants general owner authority. */
export function weixinPrivateIdentity(conversationId: string, config: Config): WeixinPrivateIdentity | undefined {
  if (config.session.dmScope !== 'per-account-channel-peer' || Object.keys(config.session.identityLinks ?? {}).length) return;
  const route = getConversationRouting(conversationId);
  if (route?.source !== 'weixin' || route.peerKind !== 'direct' || !route.accountId || !route.peerId) return;
  const section = config.channels?.weixin as { enabled?: boolean; dmPolicy?: string; allowFrom?: string[];
    accounts?: Record<string, { enabled?: boolean; dmPolicy?: string; allowFrom?: string[] }> } | undefined;
  const account = section?.accounts?.[route.accountId];
  if (section?.enabled !== true || account?.enabled === false || (account?.dmPolicy ?? section.dmPolicy) === 'disabled') return;
  const allowed = [...(account?.allowFrom ?? section.allowFrom ?? []), ...readAllowFromIdsSync(resolveWeixinAllowFromPath(route.accountId))];
  if (!allowed.some(id => id.trim().toLowerCase() === route.peerId.toLowerCase())) return;
  const loginRevision = weixinAccountIdentityRevision(route.accountId);
  if (!loginRevision) return;
  return { accountId: route.accountId, peerId: route.peerId,
    principalId: `channel:weixin:${route.accountId}:direct:${route.peerId}:login:${loginRevision}` };
}

export function weixinSetupScope(conversationId: string, config: Config): WeixinSetupScope | undefined {
  const identity = weixinPrivateIdentity(conversationId, config);
  if (!identity) return;
  const origin = resolveReverseProxyPublicUrl(config);
  if (!origin) return;
  const url = new URL(origin);
  if (url.protocol !== 'https:' && !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) return;
  return { ...identity, origin };
}
