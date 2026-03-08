/**
 * Plugin System - Core Types
 * 
 * Core plugin definitions and Plugin API interface.
 */

import type { Config } from '../../types/index.js';
import type { TypedEventBus } from './events.js';
import type { PluginTool } from './tools.js';
import type { PluginHookEvent, PluginHookHandler, HookOptions } from './hooks.js';
import type { ChannelPlugin } from './channels.js';
import type { ProviderConfig, FlagConfig, FlagValue, ShortcutConfig } from './phase4.js';

// ============================================================================
// Plugin Definition
// ============================================================================

export interface PluginDefinition {
  /** Unique plugin identifier */
  id: string;
  /** Human-readable name */
  name: string;
  /** Plugin description */
  description?: string;
  /** Plugin version */
  version?: string;
  /** Plugin kind */
  kind?: PluginKind;
  /** Configuration schema (JSON Schema) */
  configSchema?: Record<string, unknown>;
  /** Register hook - called when plugin is registered */
  register?: (api: PluginApi) => void | Promise<void>;
  /** Activate hook - called when plugin is enabled */
  activate?: (api: PluginApi) => void | Promise<void>;
  /** Deactivate hook - called when plugin is disabled */
  deactivate?: (api: PluginApi) => void | Promise<void>;
}

export type PluginKind = 'channel' | 'provider' | 'memory' | 'tool' | 'utility';

export type PluginModule = PluginDefinition | ((api: PluginApi) => void | Promise<void>);

// ============================================================================
// Plugin API
// ============================================================================

export interface PluginApi {
  /** Plugin ID */
  readonly id: string;
  /** Plugin name */
  readonly name: string;
  /** Plugin version */
  readonly version?: string;
  /** Plugin source path */
  readonly source: string;
  /** Runtime configuration */
  readonly config: Config;
  /** Plugin-specific configuration */
  readonly pluginConfig: Record<string, unknown>;
  /** Logger instance */
  readonly logger: PluginLogger;
  
  // Tool Registration
  registerTool(tool: PluginTool): void;
  
  // Hook Registration
  registerHook(event: PluginHookEvent, handler: PluginHookHandler, opts?: HookOptions): void;
  
  // Channel Registration
  registerChannel(channel: ChannelPlugin): void;
  
  // HTTP Route Registration
  registerHttpRoute(path: string, handler: HttpRequestHandler): void;
  
  // Command Registration
  registerCommand(command: PluginCommand): void;
  
  // Service Registration
  registerService(service: PluginService): void;
  
  // Gateway Method Registration
  registerGatewayMethod(method: string, handler: GatewayMethodHandler): void;
  
  // Path Resolution
  resolvePath(input: string): string;
  
  // Event Bus
  emit(event: string, data: unknown): void;
  on(event: string, handler: (data: unknown) => void): void;
  off(event: string, handler: (data: unknown) => void): void;
  
  // Phase 3: Typed Event Bus
  events: TypedEventBus;
  
  // Phase 4: Advanced Features
  registerProvider(name: string, config: Partial<ProviderConfig>): void;
  registerFlag(name: string, config: FlagConfig, pluginId?: string): void;
  getFlag(name: string): FlagValue;
  registerShortcut(key: string, config: ShortcutConfig): void;
}

// ============================================================================
// Logger
// ============================================================================

export interface PluginLogger {
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

export interface PluginCommand {
  name: string;
  description: string;
  handler: (args: string[]) => void | Promise<void>;
  aliases?: string[];
}

// ============================================================================
// Services
// ============================================================================

export interface PluginService {
  id: string;
  name: string;
  start?: () => void | Promise<void>;
  stop?: () => void | Promise<void>;
}

// ============================================================================
// Plugin Registry (Core)
// ============================================================================

export interface PluginRegistry {
  addTool(tool: PluginTool): void;
  getTools(): Map<string, PluginTool>;
  getTool(name: string): PluginTool | undefined;
  getAllTools(): PluginTool[];
  getCommand(name: string): PluginCommand | undefined;
}
