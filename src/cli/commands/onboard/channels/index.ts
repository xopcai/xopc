/**
 * Channels configuration for onboarding — multi-channel loop with registry-driven configurators.
 */

import { select } from '@inquirer/prompts';
import type { Config } from '../../../../config/schema.js';

import type { ChannelConfigurator, ChannelStatus } from './types.js';
import { getChannelConfigurators } from './registry.js';

function getChannelStatuses(config: Config, configurators: ChannelConfigurator[]): ChannelStatus[] {
  return configurators.map(cfg => ({
    id: cfg.id,
    name: cfg.name,
    description: cfg.description,
    configured: cfg.isConfigured(config),
  }));
}

async function promptChannelSelection(statuses: ChannelStatus[]): Promise<string | null> {
  const choices = statuses.map(status => ({
    value: status.id,
    name: `${status.name.padEnd(14)} ${status.configured ? '[configured]' : '[not configured]'}`,
    description: status.description,
  }));

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

async function configureChannel(
  config: Config,
  channelId: string,
  configurators: ChannelConfigurator[]
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
  const configurators = getChannelConfigurators();

  while (true) {
    const statuses = getChannelStatuses(currentConfig, configurators);
    const selected = await promptChannelSelection(statuses);
    if (selected === null) {
      break;
    }
    currentConfig = await configureChannel(currentConfig, selected, configurators);
    console.log('\n' + '─'.repeat(50) + '\n');
  }

  console.log('\n✅ Channel setup complete\n');
  return currentConfig;
}

export type { ChannelConfigurator, ChannelStatus, DmPolicy, GroupPolicy } from './types.js';
export { telegramConfigurator } from './telegram.js';
export { getChannelConfigurators } from './registry.js';

export { setupTelegramOnboard } from './telegram.js';
