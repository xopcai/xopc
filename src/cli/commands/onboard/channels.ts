/**
 * Channels Configuration for Onboarding
 */

import { input, confirm } from '@inquirer/prompts';
import type { Config } from '../../../config/schema.js';

/**
 * Configure messaging channels
 */
export async function setupChannels(config: Config): Promise<Config> {
  console.log('\n💬 Step: Channels (Optional)\n');

  const enableTelegram = await confirm({
    message: 'Enable Telegram?',
    default: config?.channels?.telegram?.enabled || false,
  });

  if (enableTelegram) {
    const token = await input({
      message: 'Telegram Bot Token:',
      validate: (v: string) => v.length > 0 || 'Required',
    });

    config.channels = config.channels || {};
    // Merge with existing config to preserve apiRoot and other settings
    const existingTelegram = config.channels.telegram || {};
    config.channels.telegram = {
      ...existingTelegram,
      enabled: true,
      token,
      allowFrom: ((existingTelegram as { allowFrom?: (string | number)[] }).allowFrom ?? []) as (string | number)[],
      debug: (existingTelegram as { debug?: boolean }).debug ?? false,
      dmPolicy: ((existingTelegram as { dmPolicy?: 'pairing' | 'allowlist' | 'open' | 'disabled' }).dmPolicy ?? 'pairing') as 'pairing' | 'allowlist' | 'open' | 'disabled',
      groupPolicy: ((existingTelegram as { groupPolicy?: 'allowlist' | 'open' | 'disabled' }).groupPolicy ?? 'open') as 'allowlist' | 'open' | 'disabled',
    };

    console.log('✅ Telegram enabled');
  }

  const hasTelegram = config?.channels?.telegram?.enabled;
  if (hasTelegram) {
    console.log('✅ Telegram already configured');
  }

  return config;
}
