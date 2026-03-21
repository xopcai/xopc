/**
 * Channels Configuration for Onboarding
 * 
 * Multi-channel configuration with guided setup flow.
 */

import { select, confirm } from '@inquirer/prompts';
import type { Config } from '../../../config/schema.js';

import type { ChannelConfigurator, ChannelStatus } from './types.js';
import { telegramConfigurator } from './telegram.js';
import { discordConfigurator } from './discord.js';
import { slackConfigurator } from './slack.js';

// 注册所有频道配置器
const configurators: ChannelConfigurator[] = [
  telegramConfigurator,
  discordConfigurator,
  slackConfigurator,
];

/**
 * 获取所有频道的状态
 */
function getChannelStatuses(config: Config): ChannelStatus[] {
  return configurators.map(cfg => ({
    id: cfg.id,
    name: cfg.name,
    description: cfg.description,
    configured: cfg.isConfigured(config),
  }));
}

/**
 * 显示频道选择界面
 */
async function promptChannelSelection(
  statuses: ChannelStatus[]
): Promise<string | null> {
  const choices = statuses.map(status => ({
    value: status.id,
    name: `${status.name.padEnd(12)} ${status.configured ? '[已配置]' : '[未配置]'}`,
    description: status.description,
  }));
  
  // 添加"完成"选项
  choices.push({
    value: 'done',
    name: '[完成配置]',
    description: '保存当前配置并退出',
  });
  
  const selected = await select<string>({
    message: '选择要配置的频道:',
    choices,
  });
  
  return selected === 'done' ? null : selected;
}

/**
 * 配置单个频道
 */
async function configureChannel(
  config: Config,
  channelId: string
): Promise<Config> {
  const configurator = configurators.find(c => c.id === channelId);
  if (!configurator) {
    console.log(`⚠️  未知频道: ${channelId}`);
    return config;
  }
  
  return configurator.configure(config);
}

/**
 * 主配置流程
 */
export async function setupChannels(config: Config): Promise<Config> {
  console.log('\n💬 频道配置\n');
  console.log('═'.repeat(50));
  
  let currentConfig = config;
  
  while (true) {
    // 获取当前状态
    const statuses = getChannelStatuses(currentConfig);
    
    // 显示选择界面
    const selected = await promptChannelSelection(statuses);
    
    // 用户选择完成
    if (selected === null) {
      break;
    }
    
    // 配置选中的频道
    currentConfig = await configureChannel(currentConfig, selected);
    
    // 询问是否继续配置其他频道
    const continueConfig = await confirm({
      message: '是否继续配置其他频道?',
      default: true,
    });
    
    if (!continueConfig) {
      break;
    }
    
    console.log('\n' + '─'.repeat(50) + '\n');
  }
  
  console.log('\n✅ 频道配置完成\n');
  return currentConfig;
}

// 重新导出类型和配置器
export type { ChannelConfigurator, ChannelStatus, DmPolicy, GroupPolicy } from './types.js';
export { telegramConfigurator } from './telegram.js';
export { discordConfigurator } from './discord.js';
export { slackConfigurator } from './slack.js';
