/**
 * Extension API Implementation
 */

import type {
  ExtensionApi,
  ExtensionLogger,
  ExtensionTool,
  ChannelPlugin,
  GatewayMethodHandler,
  HttpRequestHandler,
  ExtensionCommand,
  ExtensionService,
  ProviderConfig,
  FlagConfig,
  FlagValue,
  ShortcutConfig,
} from './types/index.js';
import type { Config } from '../types/index.js';
import { resolve, isAbsolute } from 'path';
import { EventEmitter } from 'events';
import { createLogger } from '../utils/logger.js';
import { TypedEventBus } from './typed-event-bus.js';
import { ExtensionRegistryImpl } from './loader.js';

export class ExtensionApiImpl implements ExtensionApi {
  private _tools: Map<string, ExtensionTool> = new Map();
  private _hooks: Map<string, Set<Function>> = new Map();
  private _eventBus = new EventEmitter();
  private _typedEventBus: TypedEventBus;
  
  // Phase 4: Unified Registry
  private _registry: ExtensionRegistryImpl;

  constructor(
    public readonly id: string,
    public readonly name: string,
    public readonly version: string | undefined,
    public readonly source: string,
    public readonly config: Config,
    public readonly extensionConfig: Record<string, unknown>,
    private readonly _logger: ExtensionLogger,
    private readonly _resolvePath: (input: string) => string,
    private readonly _coreRegistry?: ExtensionRegistryImpl,
  ) {
    // Initialize typed event bus
    this._typedEventBus = new TypedEventBus({
      logger: _logger,
    });
    
    // Initialize unified registry
    this._registry = new ExtensionRegistryImpl();
  }

  get logger(): ExtensionLogger {
    return this._logger;
  }

  registerTool(tool: ExtensionTool): void {
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

  registerCommand(command: ExtensionCommand): void {
    this._eventBus.emit('command:register', command);
    this._logger.info(`Registered command: /${command.name}`);
  }

  registerService(service: ExtensionService): void {
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

  // Phase 3: Typed Event Bus
  get events(): TypedEventBus {
    return this._typedEventBus;
  }

  // Phase 4: Unified Registry Methods
  registerProvider(name: string, config: Partial<ProviderConfig>): void {
    // this._registry.registerProvider(name, config);
    this._logger.info(`Extension registered provider: ${name}`);
  }

  registerFlag(name: string, config: FlagConfig): void {
    // this._registry.registerFlag(name, config, this.id);
  }

  getFlag(name: string): FlagValue {
    return // this._registry.getFlag(name);
  }

  registerShortcut(key: string, config: ShortcutConfig): void {
    // this._registry.registerShortcut(key, config, { extensionId: this.id });
  }

  // Internal methods for extension manager
  _getTools(): Map<string, ExtensionTool> {
    return this._tools;
  }

  _getHooks(): Map<string, Set<Function>> {
    return this._hooks;
  }

  _getEventBus(): EventEmitter {
    return this._eventBus;
  }

  _cleanup(): void {
    this._typedEventBus.cleanupAll();
    this._eventBus.removeAllListeners();
  }
}

// ============================================================================
// Default Logger
// ============================================================================

export function createExtensionLogger(prefix: string): ExtensionLogger {
  const childLogger = createLogger(`Extension:${prefix}`);

  return {
    debug: (msg: string) => childLogger.debug(msg),
    info: (msg: string) => childLogger.info(msg),
    warn: (msg: string) => childLogger.warn(msg),
    error: (msg: string) => childLogger.error(msg),
  };
}

// ============================================================================
// Path Resolver
// ============================================================================

export function createPathResolver(extensionDir: string, workspaceDir: string) {
  return (input: string): string => {
    if (input.startsWith('~')) {
      return input.replace('~', process.env.HOME || '');
    }
    if (input.startsWith('.')) {
      return resolve(extensionDir, input);
    }
    if (!isAbsolute(input)) {
      return resolve(workspaceDir, input);
    }
    return input;
  };
}
