/**
 * Channels Module
 *
 * Exports shared channel infrastructure (plugins, pipeline, registry).
 */

export * from './channel-domain.js';

export { type ChannelDock } from './dock.js';

// ChannelPlugin v2 types
export type {
  ChannelPlugin,
  ChannelPluginDefaults,
  ChannelPluginInitOptions,
  ChannelPluginSessionModelHooks,
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
  ChannelMeta,
  ChannelAccountSnapshot,
  StreamMode,
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
  createEnvelopeTimestampHandler,
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
export { ChannelManager, createChannelManager, type OutboundChannelHooks } from './manager.js';
export { collectSetupWizardChannels } from './setup-wizard-discovery.js';

export {
  listChannelPlugins,
  getChannelPlugin,
  getChannelRegistryVersion,
  syncChannelPluginsFromManager,
} from './plugins/registry.js';

// Generic markdown helpers (Telegram HTML: `./telegram/format.js`)
export * from './format.js';
