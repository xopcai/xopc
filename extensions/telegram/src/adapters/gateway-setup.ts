import { Bot } from 'grammy';

import { cancelChannelConnectionProbe, confirmChannelConnectionProbe, getChannelConnectionClaimant, getChannelConnectionProbe, startChannelConnectionProbe } from '@xopcai/xopc/channels/connection-probe.js';
import { mergeDistinctSenderIds } from '@xopcai/xopc/channels/pairing/index.js';
import type { Config } from '@xopcai/xopc/config/schema.js';
import type { ChannelRuntimeActionAdapter } from '@xopcai/xopc/channels/plugins/types.adapters.js';

import { createProxyFetch } from '../proxy-fetch.js';
import { createTimeoutAbortSignal } from '../timeout-abort.js';

function isZh(locale: string | undefined): boolean {
  return locale?.toLowerCase().startsWith('zh') === true;
}

function readInput(input: unknown): Record<string, unknown> {
  return input && typeof input === 'object' && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : {};
}

function pickString(input: unknown): string {
  return typeof input === 'string' ? input.trim() : '';
}

function pickDmPolicy(input: unknown): 'open' | 'pairing' | 'allowlist' | 'disabled' {
  return input === 'open' || input === 'pairing' || input === 'allowlist' || input === 'disabled'
    ? input
    : 'pairing';
}

function existingAccount(config: Config, accountId: string): Record<string, unknown> {
  const telegram = config.channels?.telegram as Record<string, unknown> | undefined;
  const accounts = telegram?.accounts as Record<string, unknown> | undefined;
  const account = accounts && Object.hasOwn(accounts, accountId) ? accounts[accountId] : undefined;
  return account && typeof account === 'object' && !Array.isArray(account)
    ? (account as Record<string, unknown>)
    : {};
}

function existingDefaults(config: Config): Record<string, unknown> {
  const telegram = config.channels?.telegram as Record<string, unknown> | undefined;
  const defaults = telegram?.defaults;
  return defaults && typeof defaults === 'object' && !Array.isArray(defaults)
    ? (defaults as Record<string, unknown>)
    : {};
}

function buildTelegramConfig(config: Config, input: Record<string, unknown>, accountId: string): Config {
  const existing = (config.channels?.telegram as Record<string, unknown> | undefined) ?? {};
  const existingAccounts = (existing.accounts as Record<string, unknown> | undefined) ?? {};
  const previousDefault = existingAccount(config, accountId);
  const previousDefaults = existingDefaults(config);

  const botToken = pickString(input.botToken) || pickString(previousDefault.botToken);
  const apiRoot = pickString(input.apiRoot);
  const proxy = pickString(input.proxy);
  const dmPolicy = pickDmPolicy(input.dmPolicy ?? previousDefault.dmPolicy ?? previousDefaults.dmPolicy);

  const defaults: Record<string, unknown> = {
    ...previousDefaults,
    dmPolicy: previousDefaults.dmPolicy ?? 'pairing',
    groupPolicy: previousDefaults.groupPolicy ?? 'open',
    replyToMode: previousDefaults.replyToMode ?? 'off',
    historyLimit: previousDefaults.historyLimit ?? 50,
    textChunkLimit: previousDefaults.textChunkLimit ?? 4000,
    streaming: previousDefaults.streaming ?? { mode: 'partial' },
  };
  const configuredAccount: Record<string, unknown> = {
    ...previousDefault,
    accountId,
    enabled: true,
    botToken,
    ...(apiRoot ? { apiRoot } : {}),
    ...(proxy ? { proxy } : {}),
    dmPolicy,
    allowFrom: dmPolicy === 'open' ? ['*'] : (previousDefault.allowFrom ?? []),
  };

  return {
    ...config,
    channels: {
      ...config.channels,
      telegram: {
        ...existing,
        enabled: true,
        defaults,
        accounts: {
          ...existingAccounts,
          [accountId]: configuredAccount,
        },
      },
    },
  };
}

function formPayload(locale?: string) {
  const zh = isZh(locale);
  return {
    type: 'form' as const,
    submitAction: 'setup.save',
    setupLink: { url: 'https://t.me/BotFather', label: zh ? '打开 BotFather' : 'Open BotFather' },
    schema: {
      type: 'object',
      properties: {
        botToken: { type: 'string', title: 'Bot Token', format: 'password' },
      },
      required: ['botToken'],
    },
    values: {},
  };
}

export const telegramGatewaySetupActions: ChannelRuntimeActionAdapter = {
  async runAction({ cfg, actionId, input, locale, accountId: requestedAccountId }) {
    const zh = isZh(locale);
    const accountId = requestedAccountId || 'default';
    const raw = readInput(input);
    const conversationId = pickString(raw.conversationId);
    if (actionId === 'setup.start') return { ok: true, payload: formPayload(locale) };

    if (actionId === 'setup.verify.status') {
      return { ok: true, payload: getChannelConnectionProbe('telegram', accountId, conversationId, zh) };
    }
    if (actionId === 'setup.verify.cancel') {
      cancelChannelConnectionProbe('telegram', accountId, conversationId);
      return { ok: true, payload: { type: 'ok' } };
    }
    if (actionId === 'setup.verify.confirm') {
      const current = existingAccount(cfg, accountId);
      const dmPolicy = pickDmPolicy(current.dmPolicy ?? existingDefaults(cfg).dmPolicy);
      const botToken = pickString(current.botToken);
      const senderId = getChannelConnectionClaimant('telegram', accountId, conversationId, botToken.split(':')[0]);
      if (!senderId) return { ok: false, message: zh ? '验证已结束，请重新连接。' : 'Verification ended. Connect again.' };
      const complete = () => {
        confirmChannelConnectionProbe('telegram', accountId, conversationId);
        return getChannelConnectionProbe('telegram', accountId, conversationId, zh);
      };
      if (dmPolicy !== 'pairing') return { ok: true, payload: complete() };
      const section = cfg.channels?.telegram as Record<string, unknown>;
      const accounts = section.accounts as Record<string, unknown>;
      const allowFrom = mergeDistinctSenderIds(Array.isArray(current.allowFrom) ? current.allowFrom : [], [senderId]);
      const nextConfig = {
        ...cfg,
        channels: {
          ...cfg.channels,
          telegram: { ...section, accounts: { ...accounts, [accountId]: { ...current, allowFrom } } },
        },
      };
      return { ok: true, nextConfig, onConfigSaved: () => ({ ...complete(), configChanged: true }) };
    }

    if (actionId === 'setup.save') {
      const botToken = pickString(raw.botToken);
      if (!/^\d+:[a-zA-Z0-9_-]+$/.test(botToken)) {
        return { ok: false, message: zh ? '请输入有效的 Bot Token。' : 'Enter a valid Bot Token.' };
      }
      const previous = existingAccount(cfg, accountId);
      const defaults = existingDefaults(cfg);
      const apiRoot = pickString(raw.apiRoot ?? previous.apiRoot ?? defaults.apiRoot);
      const proxy = pickString(raw.proxy ?? previous.proxy ?? defaults.proxy);
      const timeout = createTimeoutAbortSignal(10_000);
      try {
        const bot = new Bot(botToken, { client: {
          ...(apiRoot ? { apiRoot } : {}),
          ...(proxy ? { fetch: createProxyFetch(proxy) } : {}),
        } });
        const me = await bot.api.getMe(timeout.signal);
        return {
          ok: true,
          nextConfig: buildTelegramConfig(cfg, raw, accountId),
          onConfigSaved: () => startChannelConnectionProbe({ channel: 'telegram', accountId, identity: String(me.id), botUsername: me.username, confirmOwner: true, zh, configChanged: true }),
        };
      } catch {
        return { ok: false, message: zh ? '无法验证 Bot Token。请检查 Token、网络和代理。' : 'Could not verify the Bot Token. Check the token, network and proxy.' };
      } finally {
        timeout.dispose();
      }
    }

    return { ok: false, message: zh ? '不支持的 Telegram 操作。' : 'Unsupported Telegram action.' };
  },
};
