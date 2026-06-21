/**
 * Telegram interactive onboarding (CLI onboard) — {@link ChannelOnboardAdapter}.
 */

import { input, confirm, select } from '@inquirer/prompts';

import type { Config } from '@xopcai/xopc/config/schema.js';
import type { ChannelOnboardAdapter } from '@xopcai/xopc/channels/plugins/types.adapters.js';

type DmPolicy = 'pairing' | 'allowlist' | 'open' | 'disabled';
type GroupPolicy = 'open' | 'disabled' | 'allowlist';

function isTelegramConfigured(config: Config): boolean {
  const telegram = config.channels?.telegram as Record<string, unknown> | undefined;
  if (!telegram) return false;

  const accounts = telegram.accounts as Record<string, Record<string, unknown>> | undefined;
  if (accounts) {
    for (const account of Object.values(accounts)) {
      if (account?.enabled === false) continue;
      if (typeof account.botToken === 'string' && account.botToken.trim()) return true;
    }
  }

  return false;
}

function detectEnvToken(): string | null {
  return process.env.TELEGRAM_BOT_TOKEN?.trim() || null;
}

async function promptBotToken(config: Config): Promise<string | null> {
  const envToken = detectEnvToken();
  const tg = config.channels?.telegram as Record<string, unknown> | undefined;
  const accounts = tg?.accounts as Record<string, { botToken?: string }> | undefined;
  const existing = accounts?.default?.botToken?.trim();

  if (envToken && !existing) {
    const useEnv = await confirm({
      message: 'TELEGRAM_BOT_TOKEN is set in the environment. Use it?',
      default: true,
    });
    if (useEnv) return envToken;
  }

  if (typeof existing === 'string' && existing) {
    const keep = await confirm({
      message: 'A Telegram bot token is already configured. Keep it?',
      default: true,
    });
    if (keep) return existing;
  }

  console.log('\n📝 Telegram Bot Token:');
  console.log('   1. Open Telegram and chat with @BotFather');
  console.log('   2. Send /newbot and follow the prompts');
  console.log('   3. Copy the token BotFather gives you\n');

  const token = await input({
    message: 'Enter bot token:',
    validate: (v) => v.trim().length > 0 || 'Token cannot be empty',
  });

  return token.trim();
}

async function promptDmPolicy(): Promise<DmPolicy> {
  return select<DmPolicy>({
    message: 'DM (private chat) policy:',
    choices: [
      {
        value: 'pairing',
        name: 'pairing  [recommended] verify new users with /pair',
        description: 'New users must send /pair before chatting',
      },
      {
        value: 'allowlist',
        name: 'allowlist   allowlisted users only',
        description: 'Only listed users can message the bot',
      },
      {
        value: 'open',
        name: 'open        anyone can DM (not recommended)',
        description: 'Any user can start a conversation',
      },
      {
        value: 'disabled',
        name: 'disabled    DMs disabled',
        description: 'The bot does not respond to private messages',
      },
    ],
    default: 'pairing',
  });
}

async function promptAllowlist(message: string): Promise<Array<string | number>> {
  const value = await input({
    message,
    default: '',
  });

  if (!value.trim()) return [];

  const entries = value
    .split(/[,\s\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  return entries.map((e) => {
    const num = parseInt(e, 10);
    return !isNaN(num) && String(num) === e ? num : e;
  });
}

async function promptGroupPolicy(): Promise<GroupPolicy> {
  return select<GroupPolicy>({
    message: 'Group chat policy:',
    choices: [
      {
        value: 'open',
        name: 'open       all groups allowed',
        description: 'The bot can be used in any group',
      },
      {
        value: 'disabled',
        name: 'disabled   groups disabled',
        description: 'The bot does not respond in groups',
      },
      {
        value: 'allowlist',
        name: 'allowlist  allowlisted groups only',
        description: 'Only listed group chats can use the bot',
      },
    ],
    default: 'open',
  });
}

async function configureTelegram(config: Config): Promise<Config> {
  console.log(`\n${'='.repeat(50)}`);
  console.log('📱 Telegram setup');
  console.log(`${'='.repeat(50)}\n`);

  const botToken = await promptBotToken(config);
  if (!botToken) {
    console.log('⚠️ No bot token; skipping Telegram setup.');
    return config;
  }

  const dmPolicy = await promptDmPolicy();

  let allowFrom: Array<string | number> | undefined;
  if (dmPolicy === 'allowlist') {
    allowFrom = await promptAllowlist('User IDs or usernames allowed for DMs (comma-separated):');
  }

  const groupPolicy = await promptGroupPolicy();

  let groupAllowFrom: Array<string | number> | undefined;
  if (groupPolicy === 'allowlist') {
    groupAllowFrom = await promptAllowlist('Allowed group chat IDs (comma-separated):');
  }

  const prev = config.channels?.telegram as Record<string, unknown> | undefined;
  const prevAccounts =
    prev?.accounts && typeof prev.accounts === 'object' && !Array.isArray(prev.accounts)
      ? { ...(prev.accounts as Record<string, unknown>) }
      : {};
  const prevDefault =
    prevAccounts.default && typeof prevAccounts.default === 'object' && !Array.isArray(prevAccounts.default)
      ? { ...(prevAccounts.default as Record<string, unknown>) }
      : {};

  const telegramConfig: Record<string, unknown> = {
    ...(prev ?? {}),
    enabled: true,
    defaults:
      prev?.defaults && typeof prev.defaults === 'object' && !Array.isArray(prev.defaults)
        ? prev.defaults
        : {
            dmPolicy: 'pairing',
            groupPolicy: 'open',
            replyToMode: 'off',
            historyLimit: 50,
            textChunkLimit: 4000,
            streaming: { mode: 'partial' },
          },
    accounts: {
      ...prevAccounts,
      default: {
        ...prevDefault,
        accountId: 'default',
        enabled: true,
        botToken,
        dmPolicy,
        groupPolicy,
        allowFrom: allowFrom ?? (prevDefault.allowFrom as Array<string | number> | undefined) ?? [],
        groupAllowFrom:
          groupAllowFrom ?? (prevDefault.groupAllowFrom as Array<string | number> | undefined) ?? [],
      },
    },
  };

  const newConfig: Config = {
    ...config,
    channels: {
      ...config.channels,
      telegram: telegramConfig,
    },
  };

  console.log('\n✅ Telegram configuration complete\n');
  return newConfig;
}

export const telegramOnboardAdapter: ChannelOnboardAdapter = {
  isConfigured: isTelegramConfigured,
  configure: configureTelegram,
};

/** Optional entry: confirm before running the full Telegram configure flow. */
export async function setupTelegramOnboard(
  config: Config,
  options: { confirmMessage?: string; confirmDefault?: boolean } = {},
): Promise<Config> {
  const shouldEnable = await confirm({
    message: options.confirmMessage || 'Enable Telegram channel?',
    default: options.confirmDefault ?? true,
  });
  if (!shouldEnable) {
    console.log('ℹ️ Telegram skipped.');
    return config;
  }
  return configureTelegram(config);
}
