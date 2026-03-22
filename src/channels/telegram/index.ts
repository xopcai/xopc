/**
 * Compatibility re-export for legacy `src/channels/telegram` import paths.
 * Prefer importing from `@xopcai/xopcbot-extension-telegram` in new code.
 */

export { telegramPlugin, defineChannelPluginEntry } from '@xopcai/xopcbot-extension-telegram';
export type { TelegramAccount } from '@xopcai/xopcbot-extension-telegram';
