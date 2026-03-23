/**
 * Telegram Channel Configurator
 * 
 * Interactive setup for Telegram channel with:
 * - Bot token configuration (with env var detection)
 * - DM policy selection with guidance
 * - Allowlist configuration
 * - Group policy configuration
 */

import { input, confirm, select } from '@inquirer/prompts';
import type { Config } from '../../../../config/schema.js';
import type { ChannelConfigurator, DmPolicy, GroupPolicy } from './types.js';

const CHANNEL_ID = 'telegram';
const CHANNEL_NAME = 'Telegram';
const CHANNEL_DESC = 'Telegram messaging via Bot API';

/**
 * Whether Telegram has usable credentials in config.
 */
function isTelegramConfigured(config: Config): boolean {
  const telegram = config.channels?.telegram as any;
  if (!telegram) return false;
  
  // Top-level single-account config
  if ((telegram as any).botToken && (telegram as any).enabled) return true;
  
  // Multi-account config
  const accounts = (telegram as any).accounts;
  if (accounts) {
    for (const account of Object.values(accounts)) {
      if ((account as any).botToken && (account as any).enabled) return true;
    }
  }
  
  return false;
}

/**
 * Read TELEGRAM_BOT_TOKEN from the environment if set.
 */
function detectEnvToken(): string | null {
  return process.env.TELEGRAM_BOT_TOKEN?.trim() || null;
}

/**
 * Prompt for or reuse the bot token.
 */
async function promptBotToken(config: Config): Promise<string | null> {
  const envToken = detectEnvToken();
  const existing = (config.channels?.telegram as any)?.botToken;
  
  // Offer env var when present and no saved token
  if (envToken && !existing) {
    const useEnv = await confirm({
      message: 'TELEGRAM_BOT_TOKEN is set in the environment. Use it?',
      default: true,
    });
    if (useEnv) return envToken;
  }
  
  // Ask whether to keep an existing saved token
  if (existing) {
    const keep = await confirm({
      message: 'A Telegram bot token is already configured. Keep it?',
      default: true,
    });
    if (keep) return existing;
  }
  
  // Help text for obtaining a token from BotFather
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

/**
 * Prompt for DM (private chat) policy.
 */
async function promptDmPolicy(): Promise<DmPolicy> {
  const policy = await select<DmPolicy>({
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
  
  return policy;
}

/**
 * Prompt for an allowlist (IDs or usernames).
 */
async function promptAllowlist(message: string): Promise<Array<string | number>> {
  const value = await input({
    message,
    default: '',
  });
  
  if (!value.trim()) return [];
  
  // Split on comma, whitespace, or newlines
  const entries = value
    .split(/[,\s\n]+/)
    .map(s => s.trim())
    .filter(Boolean);
  
  // Coerce numeric-looking strings to numbers
  return entries.map(e => {
    const num = parseInt(e, 10);
    return !isNaN(num) && String(num) === e ? num : e;
  });
}

/**
 * Prompt for group chat policy.
 */
async function promptGroupPolicy(): Promise<GroupPolicy> {
  const policy = await select<GroupPolicy>({
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
  
  return policy;
}

/**
 * Telegram channel configurator implementation.
 */
export const telegramConfigurator: ChannelConfigurator = {
  id: CHANNEL_ID,
  name: CHANNEL_NAME,
  description: CHANNEL_DESC,
  
  isConfigured: isTelegramConfigured,
  
  async configure(config: Config): Promise<Config> {
    console.log(`\n${'='.repeat(50)}`);
    console.log(`📱 ${CHANNEL_NAME} setup`);
    console.log(`${'='.repeat(50)}\n`);
    
    // Step 1: Bot Token
    const botToken = await promptBotToken(config);
    if (!botToken) {
      console.log('⚠️ No bot token; skipping Telegram setup.');
      return config;
    }
    
    // Step 2: DM policy
    const dmPolicy = await promptDmPolicy();
    
    // Step 3: DM allowlist (when policy is allowlist)
    let allowFrom: Array<string | number> | undefined;
    if (dmPolicy === 'allowlist') {
      allowFrom = await promptAllowlist(
        'User IDs or usernames allowed for DMs (comma-separated):'
      );
    }
    
    // Step 4: Group policy
    const groupPolicy = await promptGroupPolicy();
    
    // Step 5: Group allowlist (when policy is allowlist)
    let groupAllowFrom: Array<string | number> | undefined;
    if (groupPolicy === 'allowlist') {
      groupAllowFrom = await promptAllowlist(
        'Allowed group chat IDs (comma-separated):'
      );
    }
    
    // Build merged Telegram channel config
    const telegramConfig: any = {
      enabled: true,
      botToken,
      dmPolicy,
      groupPolicy,
      debug: false,
      replyToMode: 'off',
      historyLimit: 50,
      textChunkLimit: 4000,
      allowFrom: allowFrom || [],
      groupAllowFrom: groupAllowFrom || [],
    };

    // Merge with existing config, then override new fields
    const existingTelegramConfig = config.channels?.telegram as any;
    if (existingTelegramConfig) {
      Object.assign(telegramConfig, existingTelegramConfig);
      telegramConfig.enabled = true;
      telegramConfig.botToken = botToken;
      telegramConfig.dmPolicy = dmPolicy;
      telegramConfig.groupPolicy = groupPolicy;
      if (allowFrom) telegramConfig.allowFrom = allowFrom;
      if (groupAllowFrom) telegramConfig.groupAllowFrom = groupAllowFrom;
    }

    const newConfig: any = {
      ...config,
      channels: {
        ...config.channels,
        telegram: telegramConfig,
      },
    };
    
    console.log('\n✅ Telegram configuration complete\n');
    return newConfig as Config;
  },
};

/**
 * Telegram onboarding entry point (used by onboard.ts)
 */
export async function setupTelegramOnboard(
  config: Config,
  options: {
    confirmMessage?: string;
    confirmDefault?: boolean;
  } = {}
): Promise<Config> {
  const shouldEnable = await confirm({
    message: options.confirmMessage || 'Enable Telegram channel?',
    default: options.confirmDefault ?? true,
  });
  if (!shouldEnable) {
    console.log('ℹ️ Telegram skipped.');
    return config;
  }
  return telegramConfigurator.configure(config);
}
