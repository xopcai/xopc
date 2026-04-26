import type { ChannelStatusAdapter } from '@xopcai/xopc/channels/plugin-types.js';
import type { Config } from '@xopcai/xopc/config/schema.js';

import type { ResolvedFeishuAccount } from '../state/accounts.js';

export function createFeishuStatusAdapter(): ChannelStatusAdapter<ResolvedFeishuAccount> {
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
      status: account.configured ? 'online' : 'unconfigured',
    }),
    resolveAccountState: ({ configured, enabled }) => {
      if (!enabled) return 'disabled';
      if (!configured) return 'error';
      return 'online';
    },
    probeAccount: async ({ account, timeoutMs, cfg }) => {
      // Best-effort: ensure credentials present. Real probe will call Feishu API later.
      return {
        ok: account.configured,
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

