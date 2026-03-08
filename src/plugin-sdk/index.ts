/**
 * xopcbot Plugin SDK
 * 
 * Official SDK for developing xopcbot plugins.
 * Import types and utilities from this module:
 * 
 * @example
 * import type { PluginApi, PluginDefinition } from 'xopcbot/plugin-sdk';
 */

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
  PluginApi,
  PluginLogger,
  PluginManifest,
  PluginRecord,
  PluginRegistry,
  ResolvedPluginConfig,
} from '../plugins/types.js';

// Tools
export type {
  PluginTool,
  PluginToolContext,
  EnhancedTool,
  ToolUpdate,
  ToolResult,
  ToolExecutionStartEvent,
  ToolExecutionUpdateEvent,
  ToolExecutionEndEvent,
} from '../plugins/types.js';

// Hooks
export type {
  PluginHookEvent,
  PluginHookHandler,
  HookOptions,
  AgentMessage,
  ContextEvent,
  ContextResult,
  InputEvent,
  InputResult,
  TurnEvent,
  TurnResult,
} from '../plugins/types.js';

// Phase 3: Typed Event Bus
export type {
  EventMap,
  RequestMap,
  EventHandler,
  EventHandlerMeta,
  RequestHandler,
  RequestHandlerMeta,
  WildcardEventHandler,
  WildcardHandlerMeta,
  TypedEventBusOptions,
  RequestOptions,
} from '../plugins/types.js';

// Phase 4: Advanced Features
export type {
  ProviderConfig,
  ModelConfig,
  OAuthConfig,
  OAuthCallbacks,
  OAuthCredentials,
  FlagConfig,
  FlagValue,
  ShortcutConfig,
  ShortcutHandler,
} from '../plugins/types.js';

// Channels
export type {
  ChannelPlugin,
  SendMessageOptions,
  ChannelMessage,
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
} from '../plugins/types.js';

// Services
export type {
  PluginService,
} from '../plugins/types.js';

// Gateway
export type {
  GatewayMethodHandler,
  GatewayStopContext,
} from '../plugins/types.js';

// Export classes
export { TypedEventBus } from '../plugins/typed-event-bus.js';
export { PluginRegistryImpl } from '../plugins/loader.js';

// Export hook runner and utilities
export { HookRunner, createHookContext, isHookEvent } from '../plugins/hooks.js';

// Config
export type { Config } from '../types/index.js';
