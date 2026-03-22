/**
 * Telegram ChannelPlugin adapter implementations (config, security, status).
 */

import type {
  ChannelConfigAdapter,
  ChannelSecurityAdapter,
  ChannelStatusAdapter,
} from '@xopcai/xopcbot/channels/plugin-types.js';
import type { TelegramAccountManager } from '../account-manager.js';
import type { TelegramResolvedAccount } from './types.js';
import { createTelegramConfigAdapter } from './config-adapter.js';
import { createTelegramSecurityAdapter } from './security-adapter.js';
import { createTelegramStatusAdapter } from './status-adapter.js';

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

export { createTelegramSetupWizard } from './setup-wizard.js';
export {
  createTelegramOutboundSendMethods,
  telegramTextChunker,
  TELEGRAM_OUTBOUND_DEFAULTS,
} from './outbound-adapter.js';
export { createTelegramInboundAccessControl } from './inbound-access.js';
export { telegramDebouncerKeyPolicy, type TelegramMessageEvent } from './debounce-keys.js';
