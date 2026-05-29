/**
 * Merge UI channel account → agent routes into `config.bindings`.
 * Managed rules use ids `ui:route:account:<channel>:<accountId>`.
 */

import type { BindingRuleWire, ChannelAgentRoutesState } from './types/channel-bindings';

export type { BindingRuleWire, ChannelAgentRoutesState } from './types/channel-bindings';

function normAcc(s: string | undefined): string {
  return (s ?? '').trim().toLowerCase();
}

function accountBindingKey(channel: string, accountId: string): string {
  return `${normAcc(channel)}\0${normAcc(accountId)}`;
}

function buildSimpleAccountBindingLookup(bindings: BindingRuleWire[]): Map<string, BindingRuleWire> {
  const byAccount = new Map<string, BindingRuleWire>();
  for (const r of bindings) {
    if (!isSimpleAccountOnlyRule(r)) continue;
    const channel = normAcc(r.match?.channel);
    const accountId = normAcc(r.match?.accountId);
    if (!channel || !accountId) continue;
    byAccount.set(accountBindingKey(channel, accountId), r);
  }
  return byAccount;
}

export function isSimpleAccountOnlyRule(r: BindingRuleWire): boolean {
  const m = r.match;
  if (!m?.channel || !m.accountId) return false;
  if (m.peerId || m.peerKind || m.guildId || m.teamId) return false;
  if (m.memberRoleIds && m.memberRoleIds.length > 0) return false;
  return true;
}

/** Telegram: `accounts` keys (token lives per account, typically `default`). */
export function telegramRoutingAccountIds(tg: { accounts?: Record<string, unknown> }): string[] {
  return Object.keys(tg.accounts ?? {}).sort();
}

export function weixinRoutingAccountIds(wx: { accounts?: Record<string, unknown> }): string[] {
  return Object.keys(wx.accounts ?? {}).sort();
}

export function feishuRoutingAccountIds(fs: { appId?: string; appSecret?: string; accounts?: Record<string, unknown> }): string[] {
  const keys = Object.keys(fs.accounts ?? {});
  if (keys.length > 0) return keys.toSorted();
  if (typeof fs.appId === 'string' && fs.appId.trim() && typeof fs.appSecret === 'string' && fs.appSecret.trim()) {
    return ['default'];
  }
  return [];
}

export function extractChannelAgentRoutes(
  bindings: BindingRuleWire[],
  telegramAccountIds: string[],
  weixinAccountIds: string[],
  feishuAccountIds: string[],
  defaultAgentId: string,
): ChannelAgentRoutesState {
  const telegram: Record<string, string> = {};
  const weixin: Record<string, string> = {};
  const feishu: Record<string, string> = {};
  const byAccount = buildSimpleAccountBindingLookup(bindings);

  for (const id of telegramAccountIds) {
    const rule = byAccount.get(accountBindingKey('telegram', id));
    telegram[id] = (rule?.agentId ?? defaultAgentId).trim().toLowerCase();
  }
  for (const id of weixinAccountIds) {
    const rule = byAccount.get(accountBindingKey('weixin', id));
    weixin[id] = (rule?.agentId ?? defaultAgentId).trim().toLowerCase();
  }

  for (const id of feishuAccountIds) {
    const rule = byAccount.get(accountBindingKey('feishu', id));
    feishu[id] = (rule?.agentId ?? defaultAgentId).trim().toLowerCase();
  }

  return { telegram, weixin, feishu };
}

export function mergeChannelAgentBindings(
  previous: BindingRuleWire[],
  routes: ChannelAgentRoutesState,
  telegramAccountIds: string[],
  weixinAccountIds: string[],
  feishuAccountIds: string[],
  defaultAgentId: string,
): BindingRuleWire[] {
  const tgAcc = new Set(telegramAccountIds.map(normAcc));
  const wxAcc = new Set(weixinAccountIds.map(normAcc));
  const fsAcc = new Set(feishuAccountIds.map(normAcc));

  const filtered = previous.filter((r) => {
    if (r.id?.startsWith('ui:route:account:')) return false;
    if (!isSimpleAccountOnlyRule(r)) return true;
    const ch = normAcc(r.match.channel);
    const acc = normAcc(r.match.accountId);
    if (!acc || acc === '*') return true;
    if (ch === 'telegram' && tgAcc.has(acc)) return false;
    if (ch === 'weixin' && wxAcc.has(acc)) return false;
    if (ch === 'feishu' && fsAcc.has(acc)) return false;
    return true;
  });

  const added: BindingRuleWire[] = [];

  for (const acc of telegramAccountIds) {
    const agentId = (routes.telegram[acc] ?? routes.telegram[normAcc(acc)] ?? defaultAgentId).trim().toLowerCase();
    added.push({
      id: `ui:route:account:telegram:${acc}`,
      agentId,
      priority: 45,
      enabled: true,
      match: { channel: 'telegram', accountId: acc },
    });
  }

  for (const acc of weixinAccountIds) {
    const agentId = (routes.weixin[acc] ?? routes.weixin[normAcc(acc)] ?? defaultAgentId).trim().toLowerCase();
    added.push({
      id: `ui:route:account:weixin:${acc}`,
      agentId,
      priority: 45,
      enabled: true,
      match: { channel: 'weixin', accountId: acc },
    });
  }

  for (const acc of feishuAccountIds) {
    const agentId = (routes.feishu[acc] ?? routes.feishu[normAcc(acc)] ?? defaultAgentId).trim().toLowerCase();
    added.push({
      id: `ui:route:account:feishu:${acc}`,
      agentId,
      priority: 45,
      enabled: true,
      match: { channel: 'feishu', accountId: acc },
    });
  }

  return [...filtered, ...added];
}
