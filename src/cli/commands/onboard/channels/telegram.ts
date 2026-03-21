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
import type { Config } from '../../../config/schema.js';
import type { ChannelConfigurator, DmPolicy, GroupPolicy } from './types.js';

const CHANNEL_ID = 'telegram';
const CHANNEL_NAME = 'Telegram';
const CHANNEL_DESC = 'Telegram messaging via Bot API';

/**
 * 检查 Telegram 是否已配置
 */
function isTelegramConfigured(config: Config): boolean {
  const telegram = config.channels?.telegram;
  if (!telegram) return false;
  
  // 检查顶层配置
  if (telegram.botToken && telegram.enabled) return true;
  
  // 检查多账号配置
  const accounts = telegram.accounts;
  if (accounts) {
    for (const account of Object.values(accounts)) {
      if (account.botToken && account.enabled) return true;
    }
  }
  
  return false;
}

/**
 * 检测环境变量
 */
function detectEnvToken(): string | null {
  return process.env.TELEGRAM_BOT_TOKEN?.trim() || null;
}

/**
 * 配置 Bot Token
 */
async function promptBotToken(config: Config): Promise<string | null> {
  const envToken = detectEnvToken();
  const existing = config.channels?.telegram?.botToken;
  
  // 如果有环境变量，询问是否使用
  if (envToken && !existing) {
    const useEnv = await confirm({
      message: '检测到 TELEGRAM_BOT_TOKEN 环境变量，是否使用?',
      default: true,
    });
    if (useEnv) return envToken;
  }
  
  // 如果已有配置，询问是否保留
  if (existing) {
    const keep = await confirm({
      message: 'Telegram Bot Token 已配置，是否保留?',
      default: true,
    });
    if (keep) return existing;
  }
  
  // 提示用户获取 token
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
 * 配置 DM 策略
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
 * 配置 Allowlist
 */
async function promptAllowlist(message: string): Promise<Array<string | number>> {
  const value = await input({
    message,
    default: '',
  });
  
  if (!value.trim()) return [];
  
  // 解析输入（支持逗号、空格、换行分隔）
  const entries = value
    .split(/[,\s\n]+/)
    .map(s => s.trim())
    .filter(Boolean);
  
  // 尝试将数字 ID 转为 number 类型
  return entries.map(e => {
    const num = parseInt(e, 10);
    return !isNaN(num) && String(num) === e ? num : e;
  });
}

/**
 * 配置 Group 策略
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
 * Telegram 配置器实现
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
    
    // Step 2: DM 策略
    const dmPolicy = await promptDmPolicy();
    
    // Step 3: DM Allowlist（如果选择 allowlist）
    let allowFrom: Array<string | number> | undefined;
    if (dmPolicy === 'allowlist') {
      allowFrom = await promptAllowlist(
        '输入允许 DM 的用户 ID/用户名（逗号分隔）:'
      );
    }
    
    // Step 4: Group 策略
    const groupPolicy = await promptGroupPolicy();
    
    // Step 5: Group Allowlist（如果选择 allowlist）
    let groupAllowFrom: Array<string | number> | undefined;
    if (groupPolicy === 'allowlist') {
      groupAllowFrom = await promptAllowlist(
        '输入允许的群组 ID（逗号分隔）:'
      );
    }
    
    // 构建新配置
    const newConfig: Config = {
      ...config,
      channels: {
        ...config.channels,
        telegram: {
          enabled: true,
          botToken,
          dmPolicy,
          groupPolicy,
          ...(allowFrom ? { allowFrom } : {}),
          ...(groupAllowFrom ? { groupAllowFrom } : {}),
          // 保留其他现有配置
          ...((config.channels?.telegram as Record<string, unknown> | undefined) ?? {}),
        },
      },
    };
    
    console.log('\n✅ Telegram 配置完成\n');
    return newConfig;
  },
};
