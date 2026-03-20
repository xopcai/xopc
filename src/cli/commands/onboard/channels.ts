/**
 * Channels Configuration for Onboarding (Telegram)
 */

import { input, confirm } from '@inquirer/prompts';
import type { Config } from '../../../config/schema.js';

export interface TelegramOnboardOptions {
  /** Prompt when asking to enable Telegram */
  confirmMessage?: string;
  /** Default for the enable prompt */
  confirmDefault?: boolean;
}

type TelegramPartial = NonNullable<Config['channels']>['telegram'];

/**
 * Interactive Telegram setup: writes schema fields `token` and `enabled`, preserves apiRoot etc.
 * Optional `botToken` is merged into `token` and omitted on save.
 */
export async function setupTelegramOnboard(
  config: Config,
  options?: TelegramOnboardOptions
): Promise<Config> {
  const enableTelegram = await confirm({
    message: options?.confirmMessage ?? 'Enable Telegram?',
    default: options?.confirmDefault ?? (config?.channels?.telegram?.enabled || false),
  });

  if (!enableTelegram) {
    return config;
  }

  config.channels = config.channels || {};
  const existingTelegram = (config.channels.telegram ?? {}) as Record<string, unknown>;

  const fromBotToken =
    typeof existingTelegram.botToken === 'string' ? existingTelegram.botToken.trim() : '';
  const existingToken =
    typeof existingTelegram.token === 'string' ? existingTelegram.token.trim() : '';
  const resolvedExisting = existingToken || fromBotToken;

  let token = resolvedExisting;
  if (!token) {
    console.log('\n📝 Telegram Configuration:');
    console.log('   Get your bot token from @BotFather on Telegram.\n');
    token = await input({
      message: 'Telegram Bot Token:',
      validate: (v: string) => v.length > 0 || 'Required',
    });
  } else {
    console.log('ℹ️  Telegram token already present; keeping existing.');
  }

  const { botToken: _dropBotTokenAlias, ...restExisting } = existingTelegram;

  config.channels.telegram = {
    ...(restExisting as TelegramPartial),
    enabled: true,
    token,
    allowFrom: ((existingTelegram as { allowFrom?: (string | number)[] }).allowFrom ?? []) as (
      | string
      | number
    )[],
    groupAllowFrom: ((existingTelegram as { groupAllowFrom?: (string | number)[] }).groupAllowFrom ??
      []) as (string | number)[],
    debug: (existingTelegram as { debug?: boolean }).debug ?? false,
    dmPolicy: ((existingTelegram as { dmPolicy?: 'pairing' | 'allowlist' | 'open' | 'disabled' })
      .dmPolicy ?? 'pairing') as 'pairing' | 'allowlist' | 'open' | 'disabled',
    groupPolicy: ((existingTelegram as { groupPolicy?: 'allowlist' | 'open' | 'disabled' })
      .groupPolicy ?? 'open') as 'allowlist' | 'open' | 'disabled',
    replyToMode: ((existingTelegram as { replyToMode?: 'off' | 'first' | 'all' }).replyToMode ??
      'off') as 'off' | 'first' | 'all',
    historyLimit: ((existingTelegram as { historyLimit?: number }).historyLimit ?? 50) as number,
    textChunkLimit: ((existingTelegram as { textChunkLimit?: number }).textChunkLimit ?? 4000) as number,
  };

  console.log('✅ Telegram enabled');
  return config;
}

/**
 * Standalone step (optional channels-only wizard)
 */
export async function setupChannels(config: Config): Promise<Config> {
  console.log('\n💬 Step: Channels (Optional)\n');
  return setupTelegramOnboard(config, {
    confirmMessage: 'Enable Telegram?',
    confirmDefault: config?.channels?.telegram?.enabled || false,
  });
}
