/**
 * Plugin API Implementation
 */

import type {
  ChannelPlugin,
  GatewayContext,
  GatewayMethodHandler,
  HttpRequest,
  HttpRequestHandler,
  HttpResponse,
  OutboundMessage,
  PluginApi,
  PluginCommand,
  PluginLogger,
  PluginService,
  PluginTool,
} from './types.js';
import type { Config } from '../types/index.js';
import type { MessageBus } from '../bus/index.js';
import { EventEmitter } from 'events';

export class PluginApiImpl implements PluginApi {
  private _tools: Map<string, PluginTool> = new Map();
  private _hooks: Map<string, Set<Function>> = new Map();
  private _eventBus = new EventEmitter();
  
  constructor(
    public readonly id: string,
    public readonly name: string,
    public readonly version: string | undefined,
    public readonly source: string,
    public readonly config: Config,
    public readonly pluginConfig: Record<string, unknown>,
    private readonly _logger: PluginLogger,
    private readonly _resolvePath: (input: string) => string,
  ) {}

  get logger(): PluginLogger {
    return this._logger;
  }

  registerTool(tool: PluginTool): void {
    if (this._tools.has(tool.name)) {
      this._logger.warn(`Tool ${tool.name} already registered, overwriting`);
    }
    this._tools.set(tool.name, tool);
    this._logger.info(`Registered tool: ${tool.name}`);
  }

  registerHook(event: string, handler: Function, opts?: { priority?: number; once?: boolean }): void {
    if (!this._hooks.has(event)) {
      this._hooks.set(event, new Set());
    }
    this._hooks.get(event)!.add(handler);
    
    if (opts?.once) {
      const wrapper = async (...args: unknown[]) => {
        await handler(...args);
        this._hooks.get(event)?.delete(wrapper);
      };
      this._hooks.get(event)!.add(wrapper);
    }
    
    this._logger.info(`Registered hook: ${event}`);
  }

  registerChannel(channel: ChannelPlugin): void {
    this._eventBus.emit('channel:register', channel);
    this._logger.info(`Registered channel: ${channel.name}`);
  }

  registerHttpRoute(path: string, handler: HttpRequestHandler): void {
    this._eventBus.emit('http:route', { path, handler });
    this._logger.info(`Registered HTTP route: ${path}`);
  }

  registerCommand(command: PluginCommand): void {
    this._eventBus.emit('command:register', command);
    this._logger.info(`Registered command: /${command.name}`);
  }

  registerService(service: PluginService): void {
    this._eventBus.emit('service:register', service);
    this._logger.info(`Registered service: ${service.id}`);
  }

  registerGatewayMethod(method: string, handler: GatewayMethodHandler): void {
    this._eventBus.emit('gateway:method', { method, handler });
    this._logger.info(`Registered gateway method: ${method}`);
  }

  resolvePath(input: string): string {
    return this._resolvePath(input);
  }

  emit(event: string, data: unknown): void {
    this._eventBus.emit(event, data);
  }

  on(event: string, handler: (data: unknown) => void): void {
    this._eventBus.on(event, handler);
  }

  off(event: string, handler: (data: unknown) => void): void {
    this._eventBus.off(event, handler);
  }

  // Internal methods for plugin manager
  _getTools(): Map<string, PluginTool> {
    return this._tools;
  }

  _getHooks(): Map<string, Set<Function>> {
    return this._hooks;
  }

  _getEventBus(): EventEmitter {
    return this._eventBus;
  }
}

// ============================================================================
// Default Logger
// ============================================================================

export function createPluginLogger(prefix: string): PluginLogger {
  return {
    debug: (msg) => console.debug(`[${prefix}] DEBUG: ${msg}`),
    info: (msg) => console.log(`[${prefix}] INFO: ${msg}`),
    warn: (msg) => console.warn(`[${prefix}] WARN: ${msg}`),
    error: (msg) => console.error(`[${prefix}] ERROR: ${msg}`),
  };
}

// ============================================================================
// Path Resolver
// ============================================================================

export function createPathResolver(pluginDir: string, workspaceDir: string) {
  return (input: string): string => {
    if (input.startsWith('~')) {
      return input.replace('~', process.env.HOME || '');
    }
    if (input.startsWith('.')) {
      return require('path').resolve(pluginDir, input);
    }
    if (!require('path').isAbsolute(input)) {
      return require('path').resolve(workspaceDir, input);
    }
    return input;
  };
}
