/**
 * Channels Module
 *
 * Exports shared channel infrastructure (plugins, pipeline, registry).
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

// Manager
export { ChannelManager, createChannelManager } from './manager.js';

// Generic markdown helpers (Telegram HTML: `./telegram/format.js`)
export * from './format.js';
