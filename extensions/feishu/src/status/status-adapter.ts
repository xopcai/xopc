import type { ChannelStatusAdapter } from '@xopcai/xopc/channels/plugin-types.js';

import { probeFeishuBot } from '../transport/client/bot-info.js';
import type { ResolvedFeishuAccount } from '../state/accounts.js';

export function createFeishuStatusAdapter(getState: (accountId: string) => 'online' | 'connecting' | 'error' | undefined = () => undefined): ChannelStatusAdapter<ResolvedFeishuAccount> {
  return {
    defaultRuntime: {
      accountId: 'default',
      channelId: 'feishu',
      enabled: true,
      configured: false,
    },
    buildAccountSnapshot: async ({ account }) => ({
      accountId: account.accountId,
      channelId: 'feishu',
      enabled: account.enabled,
      configured: account.configured,
      status: account.configured ? getState(account.accountId) ?? 'offline' : 'unconfigured',
    }),
    resolveAccountState: ({ account, configured, enabled }) => {
      if (!enabled) return 'disabled';
      if (!configured) return 'error';
      const state = getState(account.accountId);
      return state === 'online' || state === 'error' ? state : 'offline';
    },
    probeAccount: async ({ account, timeoutMs, cfg }) => {
      const info = await probeFeishuBot(account, AbortSignal.timeout(Math.max(1000, Math.min(timeoutMs ?? 10_000, 30_000))))
        .catch(() => ({ ok: false as const }));
      return {
        ...info,
        state: getState(account.accountId),
        timeoutMs,
        domain: account.domain,
        mode: account.connectionMode,
        enabled: account.enabled,
        configured: account.configured,
        hasConfig: Boolean((cfg.channels?.feishu as any)?.enabled),
      };
    },
    buildChannelSummary: async ({ snapshot }) => ({
      ok: snapshot.configured && snapshot.enabled,
      accountId: snapshot.accountId,
      enabled: snapshot.enabled,
      configured: snapshot.configured,
      status: snapshot.status,
    }),
  };
}

