/**
 * xopcbot Extension SDK
 * 
 * Official SDK for developing xopcbot extensions.
 * Import types and utilities from this module:
 * 
 * @example
 * import type { ExtensionApi, ExtensionDefinition } from 'xopcbot/extension-sdk';
 */

// Core extension types
export type {
  ExtensionDefinition,
  ExtensionModule,
  ExtensionKind,
  ExtensionApi,
  ExtensionLogger,
  ExtensionManifest,
  ExtensionRecord,
  ExtensionRegistry,
  ResolvedExtensionConfig,
} from '../extensions/types/index.js';

// Tools
export type {
  ExtensionTool,
  ExtensionToolContext,
  EnhancedTool,
  ToolUpdate,
  ToolResult,
  ToolExecutionStartEvent,
  ToolExecutionUpdateEvent,
  ToolExecutionEndEvent,
} from '../extensions/types/index.js';

// Hooks
export type {
  ExtensionHookEvent,
  ExtensionHookHandler,
  HookOptions,
  AgentMessage,
  ContextEvent,
  ContextResult,
  InputEvent,
  InputResult,
  TurnEvent,
  TurnResult,
} from '../extensions/types/index.js';

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
} from '../extensions/types/index.js';

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
} from '../extensions/types/index.js';

// Channels
export type {
  ChannelPlugin,
  SendMessageOptions,
  ChannelMessage,
} from '../extensions/types/index.js';

// HTTP
export type {
  HttpRequestHandler,
  HttpRequest,
  HttpResponse,
} from '../extensions/types/index.js';

// Commands
export type {
  ExtensionCommand,
} from '../extensions/types/index.js';

// Services
export type {
  ExtensionService,
} from '../extensions/types/index.js';

// Gateway
export type {
  GatewayMethodHandler,
  GatewayStopContext,
} from '../extensions/types/index.js';

// Export classes
export { TypedEventBus } from '../extensions/typed-event-bus.js';
export { ExtensionRegistryImpl } from '../extensions/loader.js';

// Export hook runner and utilities
export { ExtensionHookRunner, createHookContext, isHookEvent } from '../extensions/hooks.js';

// Config
export type { Config } from '../types/index.js';
