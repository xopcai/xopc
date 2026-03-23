/**
 * Channels Configuration for Onboarding
 * 
 * Multi-channel configuration with guided setup flow.
 */

import { select, confirm } from '@inquirer/prompts';
import type { Config } from '../../../../config/schema.js';

import type { ChannelConfigurator, ChannelStatus } from './types.js';
import { telegramConfigurator } from './telegram.js';
import { discordConfigurator } from './discord.js';
import { slackConfigurator } from './slack.js';

// All channel configurators for the onboarding flow
const configurators: ChannelConfigurator[] = [
  telegramConfigurator,
  discordConfigurator,
  slackConfigurator,
];

/**
 * Build status rows for each registered channel.
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
 * Prompt to pick a channel to configure (or finish).
 */
async function promptChannelSelection(
  statuses: ChannelStatus[]
): Promise<string | null> {
  const choices = statuses.map(status => ({
    value: status.id,
    name: `${status.name.padEnd(12)} ${status.configured ? '[configured]' : '[not configured]'}`,
    description: status.description,
  }));
  
  // "Done" option to exit the loop
  choices.push({
    value: 'done',
    name: '[Done]',
    description: 'Save and exit channel setup',
  });
  
  const selected = await select<string>({
    message: 'Select a channel to configure:',
    choices,
  });
  
  return selected === 'done' ? null : selected;
}

/**
 * Run configure() for one channel id.
 */
async function configureChannel(
  config: Config,
  channelId: string
): Promise<Config> {
  const configurator = configurators.find(c => c.id === channelId);
  if (!configurator) {
    console.log(`⚠️  Unknown channel: ${channelId}`);
    return config;
  }
  
  return configurator.configure(config);
}

/**
 * Interactive multi-channel onboarding entry point.
 */
export async function setupChannels(config: Config): Promise<Config> {
  console.log('\n💬 Channel setup\n');
  console.log('═'.repeat(50));
  
  let currentConfig = config;
  
  while (true) {
    // Refresh channel configured flags
    const statuses = getChannelStatuses(currentConfig);
    
    // Channel picker or "done"
    const selected = await promptChannelSelection(statuses);
    
    // User chose "done"
    if (selected === null) {
      break;
    }
    
    // Run that channel's wizard
    currentConfig = await configureChannel(currentConfig, selected);
    
    // Optionally configure another channel
    const continueConfig = await confirm({
      message: 'Configure another channel?',
      default: true,
    });
    
    if (!continueConfig) {
      break;
    }
    
    console.log('\n' + '─'.repeat(50) + '\n');
  }
  
  console.log('\n✅ Channel setup complete\n');
  return currentConfig;
}

// Re-export types and configurators
export type { ChannelConfigurator, ChannelStatus, DmPolicy, GroupPolicy } from './types.js';
export { telegramConfigurator } from './telegram.js';
export { discordConfigurator } from './discord.js';
export { slackConfigurator } from './slack.js';

// Export setupTelegramOnboard for use in onboard.ts
export { setupTelegramOnboard } from './telegram.js';
