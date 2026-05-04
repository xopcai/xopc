/**
 * Extension System - Core Types
 * 
 * Core extension definitions and Extension API interface.
 */

import type { Command } from 'commander';
import type { Config } from '../../config/config-surface.js';
import type { Config as FullConfig } from '../../config/schema.js';
import type { MessageBus } from '../../infra/bus/index.js';
import type { TypedEventBus } from './events.js';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { ExtensionHookEvent, ExtensionHookHandler, HookOptions, HookHandlerMap } from './hooks.js';
import type { ChannelPlugin } from '../../channels/plugin-types.js';
import type { SessionMetadata } from '../../session/types.js';
import type { FlagConfig, FlagValue, ShortcutConfig } from './phase4.js';
import type { ProviderPlugin } from './providers.js';

// ============================================================================
// Extension Definition
// ============================================================================

export interface ExtensionDefinition {
  /** Unique extension identifier */
  id: string;
  /** Human-readable name */
  name: string;
  /** Extension description */
  description?: string;
  /** Extension version */
  version?: string;
  /** Extension kind */
  kind?: ExtensionKind;
  /** Configuration schema (JSON Schema) */
  configSchema?: Record<string, unknown>;
  /** Register hook - called when extension is registered */
  register?: (api: ExtensionApi) => void | Promise<void>;
  /** Activate hook - called when extension is enabled */
  activate?: (api: ExtensionApi) => void | Promise<void>;
  /** Deactivate hook - called when extension is disabled */
  deactivate?: (api: ExtensionApi) => void | Promise<void>;
}

export type ExtensionKind =
  | 'channel'
  | 'provider'
  | 'memory'
  | 'tool'
  | 'utility'
  | 'tts'
  | 'image-generation'
  | 'web-search';

export type ExtensionModule = ExtensionDefinition | ((api: ExtensionApi) => void | Promise<void>);

// ============================================================================
// Extension runtime (Gateway-injected)
// ============================================================================

/** Optional: session manager when extension runs inside Gateway. */
export type ExtensionSessionManager = {
  initialize?: () => Promise<void>;
  getSessionMetadata?: (key: string) => Promise<SessionMetadata | null>;
  updateSessionMetadata?: (key: string, updates: Partial<SessionMetadata>) => Promise<void>;
};

export interface ExtensionRuntime {
  config: Config;
  /** Present when ExtensionLoader.setRuntimeContext was used (e.g. Gateway). */
  bus?: MessageBus;
  log: ExtensionLogger;
  sessionManager?: ExtensionSessionManager;
  /**
   * Queue another webchat agent turn (same as POST /api/agent) after the current run unlocks.
   * Only injected in the Gateway process.
   */
  scheduleWebchatContinuation?: (sessionKey: string, message: string) => void;
}

export interface ExtensionCliRegistration {
  extensionId: string;
  commands: string[];
  factory: (ctx: { program: Command }) => void;
}

// ============================================================================
// Extension API
// ============================================================================

export interface ExtensionApi {
  /** Extension ID */
  readonly id: string;
  /** Extension name */
  readonly name: string;
  /** Extension version */
  readonly version?: string;
  /** Extension source path */
  readonly source: string;
  /** Runtime configuration */
  readonly config: Config;
  /** Extension-specific configuration */
  readonly extensionConfig: Record<string, unknown>;
  /** Logger instance */
  readonly logger: ExtensionLogger;
  
  // Tool Registration
  registerTool(tool: AgentTool): void;
  
  // Hook Registration
  registerHook(event: ExtensionHookEvent, handler: ExtensionHookHandler, opts?: HookOptions): void;
  
  //  Strongly Typed Hook Registration
  onHook<K extends ExtensionHookEvent>(hookName: K, handler: HookHandlerMap[K], opts?: { priority?: number }): void;
  
  /** Register a channel plugin (object form). */
  registerChannel(registration: { plugin: ChannelPlugin }): void;
  
  // HTTP Route Registration
  registerHttpRoute(path: string, handler: HttpRequestHandler): void;
  
  // Command Registration
  registerCommand(command: ExtensionCommand): void;

  /**
   * Bind a handler to a manifest-declared command id (`ui.contributions.commands`).
   * Metadata comes from the manifest; optional `chatAlias` becomes the slash command name.
   */
  onCommand(
    commandId: string,
    handler: ExtensionCommandHandler,
  ): void;

  /**
   * Register a reload handler when config paths matching this extension change during hot reload.
   */
  registerReload(handler: ExtensionReloadHandler): void;
  
  // Service Registration
  registerService(service: ExtensionService): void;
  
  // Gateway Method Registration
  registerGatewayMethod(method: string, handler: GatewayMethodHandler): void;

  /**
   * Register Commander subcommands. Apply with
   * `registerExtensionCliProgram(program, registry)` when wiring CLI.
   */
  registerCli(
    factory: (ctx: { program: Command }) => void,
    opts?: { commands: string[] },
  ): void;

  /** Gateway-injected runtime (bus, full config, session). Only set when ExtensionLoader.setRuntimeContext was used. */
  readonly runtime: ExtensionRuntime;
  
  // Path Resolution
  resolvePath(input: string): string;
  
  // Event Bus
  emit(event: string, data: unknown): void;
  on(event: string, handler: (data: unknown) => void): void;
  off(event: string, handler: (data: unknown) => void): void;
  
  //  Typed Event Bus
  events: TypedEventBus;
  
  //  Provider Registration
  registerProvider(plugin: ProviderPlugin): void;
  registerProviderPlugin(plugin: ProviderPlugin): void;
  
  //  Advanced Features
  registerFlag(name: string, config: FlagConfig, extensionId?: string): void;
  getFlag(name: string): FlagValue;
  registerShortcut(key: string, config: ShortcutConfig): void;
}

// ============================================================================
// Logger
// ============================================================================

export interface ExtensionLogger {
  debug(msg: string): void;
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

// ============================================================================
// HTTP & Gateway
// ============================================================================

export interface HttpRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: unknown;
}

export interface HttpResponse {
  status: number;
  headers?: Record<string, string>;
  body?: unknown;
}

export type HttpRequestHandler = (req: HttpRequest) => HttpResponse | Promise<HttpResponse>;

export type GatewayMethodHandler = (params: unknown) => unknown | Promise<unknown>;

// ============================================================================
// Extension config hot reload
// ============================================================================

export interface ExtensionReloadResult {
  success: boolean;
  error?: string;
}

export type ExtensionReloadHandler = (
  newConfig: FullConfig,
  changedPaths: string[],
) => ExtensionReloadResult | Promise<ExtensionReloadResult>;

export interface ExtensionReloadRegistration {
  extensionId: string;
  handler: ExtensionReloadHandler;
  /** Config path prefixes this handler cares about. Empty = any extension-related change passed to matcher. */
  configPrefixes: string[];
}

// ============================================================================
// Commands
// ============================================================================

/**
 * Chat command registered by an extension (bridged into CommandRegistry with category `extension`).
 */
export interface ExtensionCommand {
  name: string;
  description: string;
  aliases?: string[];
  scope?: Array<'global' | 'private' | 'group'>;
  acceptsArgs?: boolean;
  examples?: string[];
  handler: ExtensionCommandHandler;
}

export type ExtensionCommandHandler = (
  args: string,
  context: ExtensionCommandContext,
) => Promise<ExtensionCommandResult | void> | ExtensionCommandResult | void;

export interface ExtensionCommandContext {
  sessionKey: string;
  source: string;
  isGroup: boolean;
  config: Config;
  reply(text: string): Promise<void>;
}

export interface ExtensionCommandResult {
  content: string;
  success?: boolean;
}

// ============================================================================
// Services
// ============================================================================

export interface ExtensionService {
  id: string;
  name: string;
  start?: () => void | Promise<void>;
  stop?: () => void | Promise<void>;
}

// ============================================================================
// Extension Registry (Core)
// ============================================================================

export interface ExtensionRegistry {
  addTool(tool: AgentTool): void;
  getTools(): Map<string, AgentTool>;
  getTool(name: string): AgentTool | undefined;
  getAllTools(): AgentTool[];
  getCommand(name: string): ExtensionCommand | undefined;
  addCliRegistration(reg: ExtensionCliRegistration): void;
  getCliRegistrations(): readonly ExtensionCliRegistration[];
}
