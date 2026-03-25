/**
 * xopcbot Extension SDK
 * 
 * Official SDK for developing xopcbot extensions.
 * Import types and utilities from this module:
 * 
 * @example
 * import type { ExtensionApi, ExtensionDefinition } from 'xopcbot/extension-sdk';
 */

// ============================================================================
// Core extension types
// ============================================================================

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
  ExtensionRuntime,
  ExtensionCliRegistration,
} from '../types/index.js';

// ============================================================================
// Tools (re-exported from @mariozechner/pi-agent-core)
// ============================================================================

export type {
  AgentTool,
  AgentToolResult,
  AgentToolUpdateCallback,
  ToolExecutionStartEvent,
  ToolExecutionUpdateEvent,
  ToolExecutionEndEvent,
} from '../types/index.js';

// ============================================================================
// Hooks ( Strongly Typed)
// ============================================================================

export type {
  ExtensionHookEvent,
  ExtensionHookHandler,
  HookOptions,
  HookAgentContext,
  AgentMessage,
  ContextEvent,
  ContextResult,
  InputEvent,
  InputResult,
  TurnEvent,
  TurnResult,
  //  New hook types
  HookHandlerMap,
  HookExecutionMode,
  // Note: HOOK_EXECUTION_MODES is exported as value below
  //  LLM observation hooks
  HookBeforeModelResolveEvent,
  HookBeforeModelResolveResult,
  HookBeforePromptBuildEvent,
  HookBeforePromptBuildResult,
  HookLlmInputEvent,
  HookLlmOutputEvent,
  //  Inbound claim
  HookInboundClaimEvent,
  HookInboundClaimResult,
  //  Reset hook
  HookBeforeResetEvent,
  HookBeforeResetResult,
  //  Message write hook
  HookBeforeMessageWriteEvent,
  HookBeforeMessageWriteResult,
  //  Subagent hooks
  HookSubagentStartEvent,
  HookSubagentEndEvent,
  HookSubagentErrorEvent,
  HookSubagentResultEvent,
  //  Turn hooks
  HookTurnStartEvent,
  HookTurnEndEvent,
  //  Tool execution hooks
  HookToolExecutionStartEvent,
  HookToolExecutionUpdateEvent,
  HookToolExecutionEndEvent,
  // Existing context types
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
} from '../types/index.js';

// ============================================================================
//  Typed Event Bus
// ============================================================================

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
} from '../types/index.js';

// ============================================================================
//  Provider Types
// ============================================================================

export type {
  ProviderPlugin,
  ProviderModelDefinition,
  ProviderCapabilities,
  ProviderStreamParams,
  ProviderStreamChunk,
  ProviderCompleteParams,
  ProviderResponse,
  ProviderRegistry,
  BUILTIN_PROVIDERS,
  BuiltinProviderId,
} from '../types/index.js';

// ============================================================================
//  Advanced Features
// ============================================================================

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
} from '../types/index.js';

// ============================================================================
//  Security Types
// ============================================================================

export type {
  SafetyCheckResult,
  SecurityConfig,
  ExtensionSourceOrigin,
  ProvenanceInfo,
} from '../security.js';

// ============================================================================
//  Slot Types
// ============================================================================

export type {
  SlotKey,
  SlotClaim,
  SlotConfig,
} from '../slots.js';

// ============================================================================
//  Diagnostics Types
// ============================================================================

export type {
  DiagnosticLevel,
  ExtensionDiagnostic,
  ExtensionLoaderCache,
} from '../diagnostics.js';

// ============================================================================
// Channels (ChannelPlugin registry)
// ============================================================================

export type {
  ChannelPlugin,
  ChannelPluginInitOptions,
  ChannelPluginStartOptions,
} from '../../channels/plugin-types.js';

// ============================================================================
// HTTP
// ============================================================================

export type {
  HttpRequestHandler,
  HttpRequest,
  HttpResponse,
} from '../types/index.js';

// ============================================================================
// Commands
// ============================================================================

export type {
  ExtensionCommand,
} from '../types/index.js';

// ============================================================================
// Services
// ============================================================================

export type {
  ExtensionService,
} from '../types/index.js';

// ============================================================================
// Gateway
// ============================================================================

export type {
  GatewayMethodHandler,
} from '../types/index.js';

// ============================================================================
// Export Classes
// ============================================================================

export { TypedEventBus } from '../typed-event-bus.js';
export { ExtensionRegistryImpl } from '../loader.js';
export { ProviderPluginRegistry, getProviderRegistry } from '../../providers/plugin-registry.js';
export { SlotRegistry, getSlotRegistry, registerSlotType } from '../slots.js';
export { HOOK_EXECUTION_MODES } from '../types/hooks.js';

export { defineChannelPluginEntry } from './channel-entry.js';
export { registerExtensionCliProgram } from './channel-helpers.js';

// ============================================================================
// Export Hook Runner and Utilities
// ============================================================================

export { 
  ExtensionHookRunner, 
  createHookContext, 
  isHookEvent 
} from '../hooks.js';

// ============================================================================
//  Security Utilities
// ============================================================================

export {
  checkExtensionPathSafety,
  checkExtensionDirSafety,
  isExtensionAllowed,
  provenanceTracker,
  logSecurityIssue,
  DEFAULT_SECURITY_CONFIG,
} from '../security.js';

// ============================================================================
//  Diagnostics Utilities
// ============================================================================

export {
  getExtensionCache,
  getExtensionDiagnostics,
  ExtensionLoaderCacheImpl,
  ExtensionDiagnostics,
} from '../diagnostics.js';

// ============================================================================
// Config
// ============================================================================

export type { Config } from '../../config/config-surface.js';
