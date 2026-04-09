/**
 * Merge UI channel account → agent routes into `config.bindings` (OpenClaw-style routing).
 * Managed rules use ids `ui:route:account:<channel>:<accountId>`.
 */

export type BindingRuleWire = {
  id?: string;
  agentId: string;
  priority?: number;
  enabled?: boolean;
  match: {
    channel: string;
    accountId?: string;
    peerKind?: string;
    peerId?: string;
    guildId?: string;
    teamId?: string;
    memberRoleIds?: string[];
  };
};

export type ChannelAgentRoutesState = {
  telegram: Record<string, string>;
  weixin: Record<string, string>;
};

function normAcc(s: string | undefined): string {
  return (s ?? '').trim().toLowerCase();
}

export function isSimpleAccountOnlyRule(r: BindingRuleWire): boolean {
  const m = r.match;
  if (!m?.channel || !m.accountId) return false;
  if (m.peerId || m.peerKind || m.guildId || m.teamId) return false;
  if (m.memberRoleIds && m.memberRoleIds.length > 0) return false;
  return true;
}

/** Telegram: multi-account keys, or single `default` when only legacy `botToken` is set. */
export function telegramRoutingAccountIds(tg: { botToken?: string; accounts?: Record<string, unknown> }): string[] {
  const keys = Object.keys(tg.accounts ?? {});
  if (keys.length > 0) return [...keys].sort();
  if (typeof tg.botToken === 'string' && tg.botToken.trim()) return ['default'];
  return [];
}

export function weixinRoutingAccountIds(wx: { accounts?: Record<string, unknown> }): string[] {
  return Object.keys(wx.accounts ?? {}).sort();
}

export function extractChannelAgentRoutes(
  bindings: BindingRuleWire[],
  telegramAccountIds: string[],
  weixinAccountIds: string[],
  defaultAgentId: string,
): ChannelAgentRoutesState {
  const telegram: Record<string, string> = {};
  const weixin: Record<string, string> = {};

  for (const id of telegramAccountIds) {
    const rule = bindings.find(
      (r) =>
        normAcc(r.match?.channel) === 'telegram' &&
        normAcc(r.match?.accountId) === normAcc(id) &&
        isSimpleAccountOnlyRule(r),
    );
    telegram[id] = (rule?.agentId ?? defaultAgentId).trim().toLowerCase();
  }
  for (const id of weixinAccountIds) {
    const rule = bindings.find(
      (r) =>
        normAcc(r.match?.channel) === 'weixin' &&
        normAcc(r.match?.accountId) === normAcc(id) &&
        isSimpleAccountOnlyRule(r),
    );
    weixin[id] = (rule?.agentId ?? defaultAgentId).trim().toLowerCase();
  }

  return { telegram, weixin };
}

export function mergeChannelAgentBindings(
  previous: BindingRuleWire[],
  routes: ChannelAgentRoutesState,
  telegramAccountIds: string[],
  weixinAccountIds: string[],
  defaultAgentId: string,
): BindingRuleWire[] {
  const tgAcc = new Set(telegramAccountIds.map(normAcc));
  const wxAcc = new Set(weixinAccountIds.map(normAcc));

  const filtered = previous.filter((r) => {
    if (r.id?.startsWith('ui:route:account:')) return false;
    if (!isSimpleAccountOnlyRule(r)) return true;
    const ch = normAcc(r.match.channel);
    const acc = normAcc(r.match.accountId);
    if (!acc || acc === '*') return true;
    if (ch === 'telegram' && tgAcc.has(acc)) return false;
    if (ch === 'weixin' && wxAcc.has(acc)) return false;
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

  return [...filtered, ...added];
}
