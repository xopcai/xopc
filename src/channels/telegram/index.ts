/**
 * Stable imports for the bundled Telegram channel (implementation under extensions/telegram).
 */

export { telegramPlugin, defineChannelPluginEntry } from '../../../extensions/telegram/src/index.js';
export type { TelegramAccount } from '../../../extensions/telegram/src/index.js';
export { generateSessionKeyWithRouting } from '../../../extensions/telegram/src/routing-integration.js';
