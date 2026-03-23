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
      message: '检测到 TELEGRAM_BOT_TOKEN 环境变量，是否使用?',
      default: true,
    });
    if (useEnv) return envToken;
  }
  
  // Ask whether to keep an existing saved token
  if (existing) {
    const keep = await confirm({
      message: 'Telegram Bot Token 已配置，是否保留?',
      default: true,
    });
    if (keep) return existing;
  }
  
  // Help text for obtaining a token from BotFather
  console.log('\n📝 Telegram Bot Token:');
  console.log('   1. 在 Telegram 中找到 @BotFather');
  console.log('   2. 发送 /newbot 创建新机器人');
  console.log('   3. 复制提供的 Token\n');
  
  const token = await input({
    message: '输入 Bot Token:',
    validate: (v) => v.trim().length > 0 || 'Token 不能为空',
  });
  
  return token.trim();
}

/**
 * Prompt for DM (private chat) policy.
 */
async function promptDmPolicy(): Promise<DmPolicy> {
  const policy = await select<DmPolicy>({
    message: '选择 DM（私信）策略:',
    choices: [
      {
        value: 'pairing',
        name: 'pairing  [推荐] 首次对话需要配对验证',
        description: '新用户需要先发送 /pair 命令验证身份',
      },
      {
        value: 'allowlist',
        name: 'allowlist   仅允许白名单用户',
        description: '只有指定用户可以与机器人对话',
      },
      {
        value: 'open',
        name: 'open        允许所有人（不推荐）',
        description: '任何用户都可以直接开始对话',
      },
      {
        value: 'disabled',
        name: 'disabled    禁用私信',
        description: '机器人不响应任何私信',
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
    message: '选择群组策略:',
    choices: [
      {
        value: 'open',
        name: 'open       允许所有群组',
        description: '机器人可以在任何群组中使用',
      },
      {
        value: 'disabled',
        name: 'disabled   禁用群组功能',
        description: '机器人不响应群组消息',
      },
      {
        value: 'allowlist',
        name: 'allowlist  仅允许特定群组',
        description: '只有指定群组可以使用机器人',
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
    console.log(`📱 ${CHANNEL_NAME} 配置`);
    console.log(`${'='.repeat(50)}\n`);
    
    // Step 1: Bot Token
    const botToken = await promptBotToken(config);
    if (!botToken) {
      console.log('⚠️ 未配置 Bot Token，跳过 Telegram 设置');
      return config;
    }
    
    // Step 2: DM policy
    const dmPolicy = await promptDmPolicy();
    
    // Step 3: DM allowlist (when policy is allowlist)
    let allowFrom: Array<string | number> | undefined;
    if (dmPolicy === 'allowlist') {
      allowFrom = await promptAllowlist(
        '输入允许 DM 的用户 ID/用户名（逗号分隔）:'
      );
    }
    
    // Step 4: Group policy
    const groupPolicy = await promptGroupPolicy();
    
    // Step 5: Group allowlist (when policy is allowlist)
    let groupAllowFrom: Array<string | number> | undefined;
    if (groupPolicy === 'allowlist') {
      groupAllowFrom = await promptAllowlist(
        '输入允许的群组 ID（逗号分隔）:'
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
    
    console.log('\n✅ Telegram 配置完成\n');
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
