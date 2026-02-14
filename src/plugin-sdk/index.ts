/**
 * xopcbot Plugin SDK
 * 
 * Official SDK for developing xopcbot plugins.
 * Import types and utilities from this module:
 * 
 * @example
 * import type { PluginApi, PluginDefinition } from 'xopcbot/plugin-sdk';
 */

// Core plugin types
export type {
  PluginDefinition,
  PluginModule,
  PluginKind,
  PluginManifest,
  PluginRecord,
  PluginRegistry,
  ResolvedPluginConfig,
  PluginOrigin,
} from '../plugins/types.js';

// Plugin API
export type {
  PluginApi,
  PluginLogger,
} from '../plugins/types.js';

// Tools
export type {
  PluginTool,
  PluginToolContext,
} from '../plugins/types.js';

// Hooks
export type {
  PluginHookEvent,
  PluginHookHandler,
  HookOptions,
} from '../plugins/types.js';

// Hook context types (from hooks.ts)
export type {
  HookContext,
  BeforeAgentStartContext,
  BeforeAgentStartResult,
  AgentEndContext,
  BeforeCompactionContext,
  AfterCompactionContext,
  MessageReceivedContext,
  MessageSendingContext,
  MessageSendingResult,
  MessageSentContext,
  BeforeToolCallContext,
  BeforeToolCallResult,
  AfterToolCallContext,
  SessionStartContext,
  SessionEndContext,
  GatewayStartContext,
  GatewayStopContext,
} from '../plugins/hooks.js';

// Export hook runner and utilities
export { HookRunner, createHookContext, isHookEvent } from '../plugins/hooks.js';

// Channels
export type {
  ChannelPlugin,
  OutboundMessage,
} from '../plugins/types.js';

// HTTP
export type {
  HttpRequestHandler,
  HttpRequest,
  HttpResponse,
} from '../plugins/types.js';

// Commands
export type {
  PluginCommand,
  CommandContext,
  CommandResult,
} from '../plugins/types.js';

// Services
export type {
  PluginService,
  ServiceContext,
} from '../plugins/types.js';

// Gateway
export type {
  GatewayMethodHandler,
  GatewayContext,
} from '../plugins/types.js';

// Config
export type { Config } from '../types/index.js';
