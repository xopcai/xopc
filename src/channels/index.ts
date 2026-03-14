/**
 * Channels Module
 * 
 * Exports all channel implementations.
 * 
 * Structure:
 * - telegram/: Telegram channel implementation
 * - plugin-types.ts: ChannelPlugin v2 接口定义
 */

export * from './types.js';

// ChannelPlugin v2 - 使用别名避免与 types.js 冲突
export type {
  ChannelPlugin,
  ChannelPluginInitOptions,
  ChannelPluginStartOptions,
  ChannelOutboundContext,
  ChannelOutboundPayloadContext,
  OutboundDeliveryResult,
  ChannelStreamHandle,
  ChannelStatusAdapter,
  ChannelSecurityAdapter,
  ChannelConfigAdapter,
  ChannelStreamingAdapter,
  ChannelCapabilities,
  ChannelMetadata,
  ChannelAccountSnapshot,
  DmPolicy,
  GroupPolicy,
  ReplyToMode,
  StreamMode,
  ChatType,
} from './plugin-types.js';

// Legacy exports (仍兼容)
export { telegramExtension } from './telegram/extension.js';
export { createTelegramCommandHandler } from './telegram/command-handler.js';
export { TelegramInlineKeyboards } from './telegram/inline-keyboards.js';
export { startTelegramWebhook, validateWebhookSecret } from './telegram/webhook.js';

// Manager
export { ChannelManager } from './manager.js';

// Telegram-specific utilities
export * from './telegram/access-control.js';
export * from './telegram/update-offset-store.js';
export * from './telegram/draft-stream.js';
export * from './telegram/format.js';

// Re-export format.ts (backward compatibility alias)
export * from './format.js';
