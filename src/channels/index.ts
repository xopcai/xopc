/**
 * Channels Module
 * 
 * Exports all channel implementations.
 */

export * from './types.js';

export {
  CHAT_CHANNEL_ORDER,
  getChatChannelMeta,
  isChatChannelId,
  listChatChannelMeta,
  type ChatChannelId,
  type ChatChannelMeta,
} from './registry.js';

export { getChannelDock, getDockForBuiltinChannel, type ChannelDock } from './dock.js';

// ChannelPlugin v2 types
export type {
  ChannelPlugin,
  ChannelPluginDefaults,
  ChannelPluginInitOptions,
  ChannelPluginReloadMeta,
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
  ChannelOutboundMediaType,
} from './plugin-types.js';

export { TELEGRAM_CHANNEL_DEFAULTS } from './telegram/plugin-defaults.js';

// Security
export {
  compileAllowlist,
  resolveAllowlistMatch,
  resolveAllowlistMatchSimple,
  evaluateAccess,
  resolveDmPolicy,
  resolveGroupPolicy,
  hasBotMention,
  removeBotMention,
} from './security.js';

// Pipeline
export {
  MessagePipeline,
  createPipeline,
  createFilterSelfHandler,
  createFilterEmptyHandler,
  createFilterCommandsHandler,
  standardPreflightHandlers,
  standardProcessHandlers,
  type PipelineMessageContext,
  type PipelineMediaRef,
  type PreflightHandler,
  type ProcessHandler,
  type DeliveryHandler,
  type AgentResponse,
} from './pipeline.js';

// Extension SDK → ChannelPlugin bridge
export {
  ExtensionSdkChannelPlugin,
  isSdkChannelExtension,
} from './extension-sdk-channel-plugin.js';

// Telegram Plugin
export { TelegramChannelPlugin, telegramPlugin } from './telegram-plugin.js';
export { createTelegramCommandHandler } from './telegram/command-handler.js';
export { TelegramInlineKeyboards } from './telegram/inline-keyboards.js';
export { startTelegramWebhook, validateWebhookSecret } from './telegram/webhook.js';

// Manager
export { ChannelManager, createChannelManager } from './manager.js';

// Telegram-specific utilities
export * from './telegram/access-control.js';
export * from './telegram/update-offset-store.js';
export * from './telegram/draft-stream.js';
export * from './telegram/format.js';

// Re-export format.ts (backward compatibility alias)
export * from './format.js';
