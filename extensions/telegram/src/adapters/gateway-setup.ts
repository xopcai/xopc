import type { Config } from '@xopcai/xopc/config/schema.js';
import type { ChannelRuntimeActionAdapter } from '@xopcai/xopc/channels/plugins/types.adapters.js';

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

function existingDefaultAccount(config: Config): Record<string, unknown> {
  const telegram = config.channels?.telegram as Record<string, unknown> | undefined;
  const accounts = telegram?.accounts as Record<string, unknown> | undefined;
  const account = accounts?.default;
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

function buildTelegramConfig(config: Config, input: Record<string, unknown>): Config {
  const existing = (config.channels?.telegram as Record<string, unknown> | undefined) ?? {};
  const existingAccounts = (existing.accounts as Record<string, unknown> | undefined) ?? {};
  const previousDefault = existingDefaultAccount(config);
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
  if (apiRoot) defaults.apiRoot = apiRoot;
  if (proxy) defaults.proxy = proxy;

  const defaultAccount: Record<string, unknown> = {
    ...previousDefault,
    accountId: 'default',
    enabled: true,
    botToken,
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
          default: defaultAccount,
        },
      },
    },
  };
}

function formPayload(config: Config, locale?: string) {
  const zh = isZh(locale);
  const account = existingDefaultAccount(config);
  const defaults = existingDefaults(config);
  return {
    type: 'form' as const,
    submitAction: 'setup.save',
    message: zh
      ? '填写 Bot Token 后保存即可启用 Telegram。默认私聊策略为 pairing；允许列表在账号配置里维护。'
      : 'Enter a Bot Token and save. The default DM policy is pairing; manage allow lists on the account configuration.',
    schema: {
      type: 'object',
      properties: {
        botToken: { type: 'string', title: zh ? 'Bot Token' : 'Bot Token', format: 'password' },
        dmPolicy: {
          type: 'string',
          title: zh ? '私聊访问' : 'Private chat access',
          enum: ['open', 'pairing', 'allowlist', 'disabled'],
          default: 'open',
        },
        apiRoot: {
          type: 'string',
          title: zh ? 'API Root（可选）' : 'API root (optional)',
          placeholder: 'https://api.telegram.org',
        },
        proxy: {
          type: 'string',
          title: zh ? '代理（可选）' : 'Proxy (optional)',
          placeholder: 'http://127.0.0.1:7897',
        },
      },
      required: ['botToken'],
    },
    values: {
      botToken: pickString(account.botToken),
      dmPolicy: pickDmPolicy(account.dmPolicy ?? defaults.dmPolicy ?? 'pairing'),
      apiRoot: pickString(account.apiRoot ?? defaults.apiRoot),
      proxy: pickString(account.proxy ?? defaults.proxy),
    },
  };
}

export const telegramGatewaySetupActions: ChannelRuntimeActionAdapter = {
  async runAction({ actionId, input, locale }) {
    const zh = isZh(locale);
    if (actionId === 'setup.start') {
      const { loadConfig } = await import('@xopcai/xopc/config/loader.js');
      return { ok: true, payload: formPayload(loadConfig(), locale) };
    }

    if (actionId === 'setup.save') {
      const raw = readInput(input);
      const botToken = pickString(raw.botToken);
      if (!botToken) {
        return { ok: false, message: zh ? 'Bot Token 为必填项。' : 'Bot Token is required.' };
      }
      const { loadConfig, saveConfig } = await import('@xopcai/xopc/config/loader.js');
      await saveConfig(buildTelegramConfig(loadConfig(), raw));
      return {
        ok: true,
        payload: {
          type: 'ok',
          message: zh ? 'Telegram 配置已保存。私聊将按 pairing/允许列表策略放行。' : 'Telegram configuration saved. Private chat now follows the pairing/allow-list policy.',
          configChanged: true,
        },
      };
    }

    return { ok: false, message: `${zh ? '不支持的 Telegram 操作' : 'Unsupported Telegram action'}: ${actionId}` };
  },
};
