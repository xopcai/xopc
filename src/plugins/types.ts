/**
 * xopcbot Plugin System - Core Types
 * 
 * A lightweight plugin system inspired by OpenClaw.
 */

import type { Config } from '../types/index.js';

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
}

// ============================================================================
// Tools
// ============================================================================

export interface PluginTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (params: Record<string, unknown>) => Promise<string>;
}

export interface PluginToolContext {
  agentId?: string;
  sessionKey?: string;
  workspaceDir?: string;
  sandboxed?: boolean;
}

// ============================================================================
// Hooks
// ============================================================================

export type PluginHookEvent = 
  | 'before_agent_start'
  | 'agent_end'
  | 'before_compaction'
  | 'after_compaction'
  | 'message_received'
  | 'message_sending'
  | 'message_sent'
  | 'before_tool_call'
  | 'after_tool_call'
  | 'session_start'
  | 'session_end'
  | 'gateway_start'
  | 'gateway_stop';

export type PluginHookHandler = (event: unknown, context: unknown) => Promise<unknown> | unknown;

export interface HookOptions {
  priority?: number;  // Higher priority runs first
  once?: boolean;     // Only run once
}

// ============================================================================
// Channels
// ============================================================================

export interface ChannelPlugin {
  name: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  send(message: OutboundMessage): Promise<void>;
  isRunning(): boolean;
}

export interface OutboundMessage {
  channel: string;
  chat_id: string;
  content: string;
}

// ============================================================================
// HTTP
// ============================================================================

export interface HttpRequestHandler {
  (req: HttpRequest, res: HttpResponse): Promise<void> | void;
}

export interface HttpRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: unknown;
}

export interface HttpResponse {
  status(code: number): HttpResponse;
  json(data: unknown): HttpResponse;
  send(data: string): HttpResponse;
}

// ============================================================================
// Commands
// ============================================================================

export interface PluginCommand {
  name: string;
  description: string;
  acceptsArgs?: boolean;
  requireAuth?: boolean;
  handler: (args: string, context: CommandContext) => Promise<CommandResult> | CommandResult;
}

export interface CommandContext {
  senderId?: string;
  channel: string;
  isAuthorized: boolean;
  config: Config;
}

export interface CommandResult {
  content: string;
  success?: boolean;
}

// ============================================================================
// Services
// ============================================================================

export interface PluginService {
  id: string;
  start(context: ServiceContext): void | Promise<void>;
  stop?(context: ServiceContext): void | Promise<void>;
}

export interface ServiceContext {
  config: Config;
  workspaceDir: string;
  stateDir: string;
  logger: PluginLogger;
}

// ============================================================================
// Gateway Methods
// ============================================================================

export interface GatewayMethodHandler {
  (params: Record<string, unknown>, context: GatewayContext): Promise<unknown> | unknown;
}

export interface GatewayContext {
  senderId?: string;
  channel?: string;
  isAuthorized: boolean;
}

// ============================================================================
// Logging
// ============================================================================

export interface PluginLogger {
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

// ============================================================================
// Registry Types
// ============================================================================

export interface PluginRegistry {
  plugins: Map<string, PluginRecord>;
  hooks: Map<PluginHookEvent, PluginHookHandler[]>;
  channels: Map<string, ChannelPlugin>;
  httpRoutes: Map<string, HttpRequestHandler>;
  commands: Map<string, PluginCommand>;
  services: Map<string, PluginService>;
  gatewayMethods: Map<string, GatewayMethodHandler>;
  tools: Map<string, PluginTool>;
  getHooks(event: PluginHookEvent): PluginHookHandler[];
  getTool(name: string): PluginTool | undefined;
  getAllTools(): PluginTool[];
  addTool(tool: PluginTool): void;
}

export interface PluginRecord {
  definition: PluginDefinition;
  module: PluginModule;
  source: string;
  enabled: boolean;
  loaded: boolean;
}

// ============================================================================
// Plugin Manifest
// ============================================================================

export interface PluginManifest {
  id: string;
  name: string;
  description?: string;
  version?: string;
  kind?: PluginKind;
  main?: string;
  configSchema?: Record<string, unknown>;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

// ============================================================================
// Plugin Origin
// ============================================================================

export type PluginOrigin = 'bundled' | 'global' | 'workspace' | 'config';

// ============================================================================
// Configuration
// ============================================================================

export interface PluginsConfig {
  enabled: string[];
  disabled: string[];
  autoLoad: boolean;
}

export interface ResolvedPluginsConfig {
  plugins: ResolvedPluginConfig[];
}

export interface ResolvedPluginConfig {
  id: string;
  origin: PluginOrigin;
  path: string;
  enabled: boolean;
  config: Record<string, unknown>;
}
