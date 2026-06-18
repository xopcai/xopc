/**
 * Bundled Telegram channel extension entry.
 */

import { defineChannelPluginEntry } from '@xopcai/xopc/extensions/sdk/channel-entry.js';

import { telegramPlugin } from './plugin.js';

export { telegramPlugin } from './plugin.js';
export type { TelegramAccount } from './plugin.js';
export { defineChannelPluginEntry } from '@xopcai/xopc/extensions/sdk/channel-entry.js';

export default defineChannelPluginEntry({
  id: 'telegram',
  name: 'Telegram',
  description: 'Telegram Bot API channel',
  plugin: telegramPlugin,
});
