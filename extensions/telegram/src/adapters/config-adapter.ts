import type { ChannelAccountSnapshot, ChannelConfigAdapter } from '@xopcai/xopc/channels/plugin-types.js';
import type { TelegramAccountManager } from '../account-manager.js';
import type { TelegramResolvedAccount } from './types.js';

export function createTelegramConfigAdapter(options: {
  accountManager: TelegramAccountManager;
}): ChannelConfigAdapter<TelegramResolvedAccount> {
  const { accountManager } = options;

  return {
    listAccountIds: (_cfg) => accountManager.getAllAccounts().map((a) => a.accountId),
    resolveAccount: (_cfg, accountId = 'default') => {
      const account = accountManager.getAccount(accountId);
      if (!account) return { accountId, enabled: false, botToken: '' };
      return {
        accountId: account.accountId,
        name: account.name,
        enabled: account.enabled !== false,
        botToken: account.botToken || '',
        tokenFile: account.tokenFile,
        apiRoot: account.apiRoot,
        proxy: account.proxy,
        dmPolicy: account.dmPolicy as TelegramResolvedAccount['dmPolicy'],
        groupPolicy: account.groupPolicy as TelegramResolvedAccount['groupPolicy'],
        allowFrom: account.allowFrom,
        groupAllowFrom: account.groupAllowFrom,
        requireMention: (account as { requireMention?: boolean }).requireMention,
        replyToMode: account.replyToMode as TelegramResolvedAccount['replyToMode'],
        streamMode: account.streamMode as TelegramResolvedAccount['streamMode'],
        streaming: account.streaming as TelegramResolvedAccount['streaming'],
        pollingStallThresholdMs: account.pollingStallThresholdMs,
        reactionLevel: account.reactionLevel as TelegramResolvedAccount['reactionLevel'],
        reactionNotifications: account.reactionNotifications as TelegramResolvedAccount['reactionNotifications'],
        ackReaction: account.ackReaction,
        webhookUrl: account.webhookUrl,
        webhookSecret: account.webhookSecret,
        webhookPath: account.webhookPath,
        groups: account.groups,
      };
    },
    isEnabled: (account) => account.enabled !== false,
    disabledReason: (account) => {
      if (account.enabled === false) return 'Account disabled';
      if (!account.botToken) return 'No token configured';
      return '';
    },
    isConfigured: async (account) => !!account.botToken,
    describeAccount: (account) => {
      const status = accountManager.getStatus(account.accountId);
      return {
        accountId: account.accountId,
        channelId: 'telegram',
        enabled: account.enabled !== false,
        configured: !!account.botToken,
        status: status?.running ? 'running' : 'stopped',
      } as ChannelAccountSnapshot;
    },
  };
}
