/**
 * Channels Module
 * 
 * Exports all channel implementations.
 * 
 * Structure:
 * - telegram/: Telegram channel implementation
 * - whatsapp/: WhatsApp channel implementation
 */

export * from './types.js';
export { telegramPlugin } from './telegram/plugin.js';
export { whatsappPlugin } from './whatsapp/plugin.js';
export { TelegramClient } from './telegram/client.js';
export { createTelegramCommandHandler } from './telegram/command-handler.js';
export { TelegramInlineKeyboards } from './telegram/inline-keyboards.js';
export { startTelegramWebhook, validateWebhookSecret } from './telegram/webhook.js';
export * from './typing-controller.js';
export * from './access-control.js';
export * from './update-offset-store.js';
export * from './draft-stream.js';
export * from './format.js';
export { ChannelManager } from './manager.js';
