/**
 * Telegram ChannelPlugin adapter implementations (config, security, status).
 */

import type { Config } from '../../config/index.js';
import type {
  ChannelAccountSnapshot,
  ChannelConfigAdapter,
  ChannelSecurityAdapter,
  ChannelSecurityContext,
  ChannelStatusAdapter,
  DmPolicy,
  GroupPolicy,
} from '../plugin-types.js';
import { evaluateAccess, resolveDmPolicy, resolveGroupPolicy } from '../security.js';
import type { TelegramAccountManager } from './account-manager.js';

export interface TelegramResolvedAccount {
  accountId: string;
  name?: string;
  enabled: boolean;
  botToken: string;
  apiRoot?: string;
  dmPolicy?: 'pairing' | 'allowlist' | 'open' | 'disabled';
  groupPolicy?: 'open' | 'disabled' | 'allowlist';
  allowFrom?: Array<string | number>;
  groupAllowFrom?: Array<string | number>;
  requireMention?: boolean;
  streamMode?: 'off' | 'partial' | 'block';
}

export function createTelegramPluginAdapters(options: {
  accountManager: TelegramAccountManager;
}): {
  configAdapter: ChannelConfigAdapter<TelegramResolvedAccount>;
  securityAdapter: ChannelSecurityAdapter<TelegramResolvedAccount>;
  statusAdapter: ChannelStatusAdapter<TelegramResolvedAccount>;
} {
  const { accountManager } = options;

  const configAdapter: ChannelConfigAdapter<TelegramResolvedAccount> = {
    listAccountIds: () => accountManager.getAllAccounts().map((a) => a.accountId),
    resolveAccount: (_cfg, accountId = 'default') => {
      const account = accountManager.getAccount(accountId);
      if (!account) return { accountId, enabled: false, botToken: '' };
      return {
        accountId: account.accountId,
        name: account.name,
        enabled: account.enabled !== false,
        botToken: account.botToken || '',
        apiRoot: account.apiRoot,
        dmPolicy: account.dmPolicy as TelegramResolvedAccount['dmPolicy'],
        groupPolicy: account.groupPolicy as TelegramResolvedAccount['groupPolicy'],
        allowFrom: account.allowFrom,
        groupAllowFrom: account.groupAllowFrom,
        requireMention: (account as { requireMention?: boolean }).requireMention,
        streamMode: account.streamMode as TelegramResolvedAccount['streamMode'],
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

  const securityAdapter: ChannelSecurityAdapter<TelegramResolvedAccount> = {
    resolveDmPolicy: ({ account }) => resolveDmPolicy(account.dmPolicy as DmPolicy | undefined, 'open'),
    resolveGroupPolicy: ({ account }) =>
      resolveGroupPolicy(account.groupPolicy as GroupPolicy | undefined, 'open'),
    resolveAllowFrom: ({ account }) => account.allowFrom,
    checkAccess: (ctx, account) => {
      const isGroup = ctx.isGroup;
      const allowFrom = isGroup
        ? (account.groupAllowFrom ?? account.allowFrom ?? [])
        : (account.allowFrom ?? []);
      const result = evaluateAccess({
        context: {
          channel: 'telegram',
          accountId: account.accountId,
          chatId: ctx.chatId,
          senderId: ctx.senderId,
          senderName: ctx.senderName,
          isGroup,
          isDm: !isGroup,
        },
        dmPolicy: account.dmPolicy as DmPolicy | undefined,
        groupPolicy: account.groupPolicy as GroupPolicy | undefined,
        allowFrom,
        groupAllowFrom: account.groupAllowFrom,
      });
      return { allowed: result.allowed, reason: result.reason };
    },
  };

  const statusAdapter: ChannelStatusAdapter<TelegramResolvedAccount> = {
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

  return { configAdapter, securityAdapter, statusAdapter };
}
