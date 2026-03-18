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
} from '../extensions/types/index.js';

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
} from '../extensions/types/index.js';

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
} from '../extensions/types/index.js';

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
} from '../extensions/types/index.js';

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
} from '../extensions/types/index.js';

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
} from '../extensions/types/index.js';

// ============================================================================
//  Security Types
// ============================================================================

export type {
  SafetyCheckResult,
  SecurityConfig,
  ExtensionSourceOrigin,
  ProvenanceInfo,
} from '../extensions/security.js';

// ============================================================================
//  Slot Types
// ============================================================================

export type {
  SlotKey,
  SlotClaim,
  SlotConfig,
} from '../extensions/slots.js';

// ============================================================================
//  Diagnostics Types
// ============================================================================

export type {
  DiagnosticLevel,
  ExtensionDiagnostic,
  ExtensionLoaderCache,
} from '../extensions/diagnostics.js';

// ============================================================================
// Channels
// ============================================================================

export type {
  ChannelExtension,
  SendMessageOptions,
  ChannelMessage,
} from '../extensions/types/index.js';

// ============================================================================
// HTTP
// ============================================================================

export type {
  HttpRequestHandler,
  HttpRequest,
  HttpResponse,
} from '../extensions/types/index.js';

// ============================================================================
// Commands
// ============================================================================

export type {
  ExtensionCommand,
} from '../extensions/types/index.js';

// ============================================================================
// Services
// ============================================================================

export type {
  ExtensionService,
} from '../extensions/types/index.js';

// ============================================================================
// Gateway
// ============================================================================

export type {
  GatewayMethodHandler,
} from '../extensions/types/index.js';

// ============================================================================
// Export Classes
// ============================================================================

export { TypedEventBus } from '../extensions/typed-event-bus.js';
export { ExtensionRegistryImpl } from '../extensions/loader.js';
export { ProviderPluginRegistry, getProviderRegistry } from '../providers/plugin-registry.js';
export { SlotRegistry, getSlotRegistry, registerSlotType } from '../extensions/slots.js';
export { HOOK_EXECUTION_MODES } from '../extensions/types/hooks.js';

// ============================================================================
// Export Hook Runner and Utilities
// ============================================================================

export { 
  ExtensionHookRunner, 
  createHookContext, 
  isHookEvent 
} from '../extensions/hooks.js';

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
} from '../extensions/security.js';

// ============================================================================
//  Diagnostics Utilities
// ============================================================================

export {
  getExtensionCache,
  getExtensionDiagnostics,
  ExtensionLoaderCacheImpl,
  ExtensionDiagnostics,
} from '../extensions/diagnostics.js';

// ============================================================================
//  Channel Adapter
// ============================================================================

export {
  adaptExtensionChannel,
  isAdaptableChannel,
  getRequiredChannelMethods,
  DEFAULT_CHANNEL_CAPABILITIES,
} from '../extensions/channel-adapter.js';

// ============================================================================
// Config
// ============================================================================

export type { Config } from '../types/index.js';
