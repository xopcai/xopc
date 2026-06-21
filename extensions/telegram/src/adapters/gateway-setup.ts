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
  return input === 'pairing' || input === 'allowlist' || input === 'disabled' ? input : 'open';
}

function existingDefaultAccount(config: Config): Record<string, unknown> {
  const telegram = config.channels?.telegram as Record<string, unknown> | undefined;
  const accounts = telegram?.accounts as Record<string, unknown> | undefined;
  const account = accounts?.default;
  return account && typeof account === 'object' && !Array.isArray(account)
    ? (account as Record<string, unknown>)
    : {};
}

function buildTelegramConfig(config: Config, input: Record<string, unknown>): Config {
  const existing = (config.channels?.telegram as Record<string, unknown> | undefined) ?? {};
  const existingAccounts = (existing.accounts as Record<string, unknown> | undefined) ?? {};
  const previousDefault = existingDefaultAccount(config);

  const botToken = pickString(input.botToken) || pickString(previousDefault.botToken);
  const apiRoot = pickString(input.apiRoot);
  const proxy = pickString(input.proxy);
  const dmPolicy = pickDmPolicy(input.dmPolicy ?? previousDefault.dmPolicy ?? existing.dmPolicy);

  const defaultAccount: Record<string, unknown> = {
    ...previousDefault,
    accountId: 'default',
    enabled: true,
    botToken,
    dmPolicy,
    allowFrom: dmPolicy === 'open' ? ['*'] : (previousDefault.allowFrom ?? []),
    groupPolicy: previousDefault.groupPolicy ?? existing.groupPolicy ?? 'open',
    replyToMode: previousDefault.replyToMode ?? existing.replyToMode ?? 'off',
    historyLimit: previousDefault.historyLimit ?? existing.historyLimit ?? 50,
    textChunkLimit: previousDefault.textChunkLimit ?? existing.textChunkLimit ?? 4000,
    streaming: previousDefault.streaming ?? existing.streaming ?? { mode: 'partial' },
  };

  if (apiRoot) defaultAccount.apiRoot = apiRoot;
  if (proxy) defaultAccount.proxy = proxy;

  const topAllowFrom = dmPolicy === 'open' ? ['*'] : (existing.allowFrom ?? []);

  return {
    ...config,
    channels: {
      ...config.channels,
      telegram: {
        ...existing,
        enabled: true,
        dmPolicy,
        allowFrom: topAllowFrom,
        groupPolicy: existing.groupPolicy ?? 'open',
        replyToMode: existing.replyToMode ?? 'off',
        streaming: existing.streaming ?? { mode: 'partial' },
        historyLimit: existing.historyLimit ?? 50,
        textChunkLimit: existing.textChunkLimit ?? 4000,
        ...(apiRoot ? { apiRoot } : {}),
        ...(proxy ? { proxy } : {}),
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
  const telegram = (config.channels?.telegram as Record<string, unknown> | undefined) ?? {};
  const account = existingDefaultAccount(config);
  return {
    type: 'form' as const,
    submitAction: 'setup.save',
    message: zh
      ? '填写 Bot Token 后保存即可启用 Telegram 私聊。群聊、多个账号、allowlist 等放在高级配置。'
      : 'Enter a Bot Token and save. Private chat works by default; groups, multi-account, and allowlists live in Advanced configuration.',
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
      dmPolicy: pickDmPolicy(account.dmPolicy ?? telegram.dmPolicy ?? 'open'),
      apiRoot: pickString(account.apiRoot ?? telegram.apiRoot),
      proxy: pickString(account.proxy ?? telegram.proxy),
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
          message: zh ? 'Telegram 配置已保存。私聊现在默认可用。' : 'Telegram configuration saved. Private chat is enabled by default.',
          configChanged: true,
        },
      };
    }

    return { ok: false, message: `${zh ? '不支持的 Telegram 操作' : 'Unsupported Telegram action'}: ${actionId}` };
  },
};
