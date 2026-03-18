/**
 * Extension System - Core Types
 * 
 * Core extension definitions and Extension API interface.
 */

import type { Config } from '../../types/index.js';
import type { TypedEventBus } from './events.js';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { ExtensionHookEvent, ExtensionHookHandler, HookOptions, HookHandlerMap } from './hooks.js';
import type { ChannelExtension } from './channels.js';
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

export type ExtensionKind = 'channel' | 'provider' | 'memory' | 'tool' | 'utility';

export type ExtensionModule = ExtensionDefinition | ((api: ExtensionApi) => void | Promise<void>);

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
  
  // Channel Registration
  registerChannel(channel: ChannelExtension): void;
  
  // HTTP Route Registration
  registerHttpRoute(path: string, handler: HttpRequestHandler): void;
  
  // Command Registration
  registerCommand(command: ExtensionCommand): void;
  
  // Service Registration
  registerService(service: ExtensionService): void;
  
  // Gateway Method Registration
  registerGatewayMethod(method: string, handler: GatewayMethodHandler): void;
  
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
// Commands
// ============================================================================

export interface ExtensionCommand {
  name: string;
  description: string;
  handler: (args: string[]) => void | Promise<void>;
  aliases?: string[];
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
}
