/**
 * Channels Module
 * 
 * Exports all channel implementations.
 * 
 * Structure:
 * - telegram/: Telegram channel implementation
 */

export * from './types.js';
export { telegramExtension } from './telegram/extension.js';
export { createTelegramCommandHandler } from './telegram/command-handler.js';
export { TelegramInlineKeyboards } from './telegram/inline-keyboards.js';
export { startTelegramWebhook, validateWebhookSecret } from './telegram/webhook.js';

// Telegram-specific utilities
export * from './telegram/access-control.js';
export * from './telegram/update-offset-store.js';
export * from './telegram/draft-stream.js';
export * from './telegram/format.js';

// Re-export format.ts (backward compatibility alias)
export * from './format.js';

export { ChannelManager } from './manager.js';
