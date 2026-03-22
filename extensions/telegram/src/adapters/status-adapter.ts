import type { ChannelAccountSnapshot, ChannelStatusAdapter } from '@xopcai/xopcbot/channels/plugin-types.js';
import type { TelegramAccountManager } from '../account-manager.js';
import type { TelegramResolvedAccount } from './types.js';

export function createTelegramStatusAdapter(options: {
  accountManager: TelegramAccountManager;
}): ChannelStatusAdapter<TelegramResolvedAccount> {
  const { accountManager } = options;

  return {
    defaultRuntime: {
      accountId: 'default',
      channelId: 'telegram',
      enabled: true,
      configured: false,
    },
    buildChannelSummary: async ({ account }) => {
      const status = accountManager.getStatus(account.accountId);
      return {
        accountId: account.accountId,
        channelId: 'telegram',
        enabled: account.enabled !== false,
        configured: !!account.botToken,
        running: status?.running ?? false,
        username: accountManager.getBotUsername(account.accountId),
      };
    },
    probeAccount: async ({ account, timeoutMs }) => {
      const bot = accountManager.getBot(account.accountId);
      if (!bot) throw new Error('Bot not initialized');
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        const me = await bot.api.getMe();
        clearTimeout(timeout);
        return { ok: true, username: me.username, id: me.id };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },
    buildAccountSnapshot: async ({ account }) => {
      const status = accountManager.getStatus(account.accountId);
      return {
        accountId: account.accountId,
        channelId: 'telegram',
        enabled: account.enabled !== false,
        configured: !!account.botToken,
        status: status?.running ? 'running' : 'stopped',
      } as ChannelAccountSnapshot;
    },
    resolveAccountState: ({ account, configured, enabled }) => {
      if (!configured) return 'offline';
      if (!enabled) return 'disabled';
      const status = accountManager.getStatus(account.accountId);
      return status?.running ? 'online' : 'offline';
    },
  };
}
