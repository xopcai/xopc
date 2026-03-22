/**
 * Telegram ChannelPlugin adapter implementations (config, security, status).
 */

import type {
  ChannelConfigAdapter,
  ChannelSecurityAdapter,
  ChannelStatusAdapter,
} from '../../../../channels/plugin-types.js';
import type { TelegramAccountManager } from '../account-manager.js';
import type { TelegramResolvedAccount } from './types.js';
import { createTelegramConfigAdapter } from './config.js';
import { createTelegramSecurityAdapter } from './security.js';
import { createTelegramStatusAdapter } from './status.js';

export type { TelegramResolvedAccount } from './types.js';

export function createTelegramPluginAdapters(options: {
  accountManager: TelegramAccountManager;
}): {
  config: ChannelConfigAdapter<TelegramResolvedAccount>;
  security: ChannelSecurityAdapter<TelegramResolvedAccount>;
  status: ChannelStatusAdapter<TelegramResolvedAccount>;
} {
  const { accountManager } = options;
  return {
    config: createTelegramConfigAdapter({ accountManager }),
    security: createTelegramSecurityAdapter(),
    status: createTelegramStatusAdapter({ accountManager }),
  };
}
