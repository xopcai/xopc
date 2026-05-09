/**
 * Extension API Implementation
 * 
 *  Complete extension API with strong typing, security, and provider support.
 */

import type { AgentTool } from '@earendil-works/pi-agent-core';
import type { Command } from 'commander';
import type {
  ExtensionApi,
  ExtensionLogger,
  ExtensionRuntime,
  ExtensionCliRegistration,
  GatewayMethodHandler,
  HttpRequestHandler,
  ExtensionCommand,
  ExtensionCommandContext,
  ExtensionCommandHandler,
  ExtensionReloadHandler,
  ExtensionService,
  FlagConfig,
  FlagValue,
  ShortcutConfig,
  HookHandlerMap,
  ExtensionHookEvent,
  HookExecutionMode,
} from './types/index.js';
import type { CommandContribution } from './types/manifest.js';
import type { CommandDefinition } from '../chat-commands/types.js';
import { commandRegistry } from '../chat-commands/registry.js';
import type { ChannelPlugin } from '../channels/plugin-types.js';
import {
  HOOK_EXECUTION_MODES,
} from './types/hooks.js';
import type { Config } from '../config/config-surface.js';
import type { Config as SchemaConfig } from '../config/schema.js';
import { resolve, isAbsolute } from 'path';
import { EventEmitter } from 'events';
import { createLogger } from '../utils/logger.js';
import { TypedEventBus } from './typed-event-bus.js';
import { ExtensionRegistryImpl } from './loader.js';

export class ExtensionApiImpl implements ExtensionApi {
  private _tools: Map<string, AgentTool> = new Map();
  private _hooks: Map<string, Set<Function>> = new Map();
  //  Strongly typed hooks (for on() method)
  private _typedHooks: Map<ExtensionHookEvent, Set<Function>> = new Map();
  private _eventBus = new EventEmitter();
  private _typedEventBus: TypedEventBus;
  
  //  Unified Registry
  private _registry: ExtensionRegistryImpl;

  private readonly _runtime: ExtensionRuntime;

  private _reloadConfigPrefixes: string[] = [];
  private _registeredCommandIds: string[] = [];
  private readonly _manifestCommands = new Map<string, CommandContribution>();

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
    runtime?: ExtensionRuntime,
  ) {
    // Initialize typed event bus
    this._typedEventBus = new TypedEventBus({
      logger: _logger,
    });
    
    this._registry = _coreRegistry ?? new ExtensionRegistryImpl();
    this._runtime =
      runtime ??
      ({
        config: this.config,
        log: this._logger,
      } as ExtensionRuntime);
  }

  get logger(): ExtensionLogger {
    return this._logger;
  }

  get runtime(): ExtensionRuntime {
    return this._runtime;
  }

  registerTool(tool: AgentTool): void {
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

  /**
   *  Strongly typed hook registration
   * Provides compile-time type checking and IDE autocomplete
   * 
   * @example
   * api.on('before_agent_start', async (event, ctx) => {
   *   console.log('Agent starting with prompt:', event.prompt);
   *   return { systemPrompt: event.systemPrompt };
   * });
   */
  onHook<K extends ExtensionHookEvent>(
    hookName: K,
    handler: HookHandlerMap[K],
    _opts?: { priority?: number },
  ): void {
    // Get execution mode for this hook
    const mode = (HOOK_EXECUTION_MODES as Record<string, HookExecutionMode>)[hookName];
    
    if (!this._typedHooks.has(hookName)) {
      this._typedHooks.set(hookName, new Set());
    }
    
    this._typedHooks.get(hookName)!.add(handler);

    this._logger.debug(`Registered typed hook: ${hookName} (mode: ${mode})`);
  }

  /**
   *  Get typed hooks for a specific event
   */
  _getTypedHooks<K extends ExtensionHookEvent>(hookName: K): HookHandlerMap[K][] {
    const hooks = this._typedHooks.get(hookName);
    return hooks ? Array.from(hooks) as HookHandlerMap[K][] : [];
  }

  /** Adds a ChannelPlugin to the extension registry; emits `channel:register` for observability. */
  registerChannel(registration: { plugin: ChannelPlugin }): void {
    const plugin = registration.plugin;
    this._registry.addChannelPlugin(plugin);
    this._eventBus.emit('channel:register', plugin);
    this._logger.info(`Registered channel plugin: ${plugin.id}`);
  }

  registerHttpRoute(path: string, handler: HttpRequestHandler): void {
    this._eventBus.emit('http:route', { path, handler });
    this._logger.info(`Registered HTTP route: ${path}`);
  }

  registerCommand(command: ExtensionCommand): void {
    const commandId = `ext.${this.id}.${command.name}`;

    const definition: CommandDefinition = {
      id: commandId,
      name: command.name,
      aliases: command.aliases,
      description: command.description,
      category: 'extension',
      scope: command.scope ?? ['global'],
      acceptsArgs: command.acceptsArgs,
      examples: command.examples,
      handler: async (ctx, args) => {
        const extensionCtx: ExtensionCommandContext = {
          sessionKey: ctx.sessionKey,
          source: ctx.source,
          isGroup: ctx.isGroup,
          config: ctx.config as SchemaConfig as ExtensionCommandContext['config'],
          reply: (text: string) => ctx.reply(text),
        };

        const result = await command.handler(args, extensionCtx);

        if (!result) {
          return { content: '', success: true };
        }
        return {
          content: result.content,
          success: result.success ?? true,
        };
      },
    };

    commandRegistry.register(definition);
    this._registeredCommandIds.push(commandId);
    this._registry.addCommand(command);

    this._eventBus.emit('command:register', command);
    this._logger.info(`Registered chat command: /${command.name}`);
  }

  /** Injected from manifest `ui.contributions.commands` by the loader. */
  _setManifestCommands(commands: CommandContribution[]): void {
    this._manifestCommands.clear();
    for (const c of commands) {
      this._manifestCommands.set(c.id, c);
    }
  }

  onCommand(commandId: string, handler: ExtensionCommandHandler): void {
    const meta = this._manifestCommands.get(commandId);
    if (!meta) {
      this._logger.warn(
        `onCommand: unknown command id "${commandId}" — registering runtime-only chat command`,
      );
      const name = commandId.includes('.')
        ? (commandId.split('.').pop() ?? commandId).trim()
        : commandId;
      this.registerCommand({
        name: name || commandId,
        description: commandId,
        handler,
      });
      return;
    }
    let name: string;
    if (meta.chatAlias?.trim()) {
      name = meta.chatAlias.trim().replace(/^\//, '');
    } else {
      name = meta.id.includes('.') ? (meta.id.split('.').pop() ?? meta.id) : meta.id;
    }
    if (!name) {
      name = meta.id;
    }
    this.registerCommand({
      name,
      description: meta.title,
      handler,
    });
    this._logger.info(`Bound manifest command "${commandId}" as /${name}`);
  }

  registerReload(handler: ExtensionReloadHandler): void {
    const prefixes =
      this._reloadConfigPrefixes.length > 0
        ? this._reloadConfigPrefixes
        : [`extensions.${this.id}`];

    this._registry.addReloadRegistration({
      extensionId: this.id,
      handler,
      configPrefixes: prefixes,
    });
    this._logger.info('Registered reload handler');
  }

  /** Called from loader when manifest declares `reload.configPrefixes`. */
  _setReloadConfigPrefixes(prefixes: string[]): void {
    this._reloadConfigPrefixes = [...prefixes];
  }

  registerService(service: ExtensionService): void {
    this._eventBus.emit('service:register', service);
    this._logger.info(`Registered service: ${service.id}`);
  }

  registerGatewayMethod(method: string, handler: GatewayMethodHandler): void {
    this._eventBus.emit('gateway:method', { method, handler });
    this._logger.info(`Registered gateway method: ${method}`);
  }

  registerCli(
    factory: (ctx: { program: Command }) => void,
    opts?: { commands: string[] },
  ): void {
    const reg: ExtensionCliRegistration = {
      extensionId: this.id,
      commands: opts?.commands ?? [],
      factory,
    };
    this._registry.addCliRegistration(reg);
    this._eventBus.emit('cli:register', reg);
    this._logger.info(
      `Registered CLI factory${opts?.commands?.length ? ` (${opts.commands.join(', ')})` : ''}`,
    );
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

  //  Typed Event Bus
  get events(): TypedEventBus {
    return this._typedEventBus;
  }

  //  Unified Registry Methods
  
  /**
   * Register a full ProviderPlugin
   */
  registerProvider(plugin: import('./types/providers.js').ProviderPlugin): void {
    import('../providers/plugin-registry.js').then(({ getProviderRegistry }) => {
      const registry = getProviderRegistry();
      registry.register(plugin);
      this._logger.info(`Extension registered provider: ${plugin.id}`);
    }).catch((err: unknown) => {
      this._logger.error(`Failed to register provider: ${err instanceof Error ? err.message : String(err)}`);
    });
  }

  /**
   * Register a full ProviderPlugin (alias for registerProvider)
   */
  registerProviderPlugin(plugin: import('./types/providers.js').ProviderPlugin): void {
    this.registerProvider(plugin);
  }

  registerFlag(_name: string, _config: FlagConfig): void {
    // this._registry.registerFlag(name, config, this.id);
  }

  getFlag(_name: string): FlagValue {
    return undefined; // this._registry.getFlag(name);
  }

  registerShortcut(_key: string, _config: ShortcutConfig): void {
    // this._registry.registerShortcut(key, config, { extensionId: this.id });
  }

  // Internal methods for extension manager
  _getTools(): Map<string, AgentTool> {
    return this._tools;
  }

  _getHooks(): Map<string, Set<Function>> {
    return this._hooks;
  }

  _getEventBus(): EventEmitter {
    return this._eventBus;
  }

  _cleanup(): void {
    for (const commandId of this._registeredCommandIds) {
      commandRegistry.unregister(commandId);
    }
    this._registeredCommandIds = [];
    this._manifestCommands.clear();

    this._registry.removeReloadRegistration(this.id);

    this._typedEventBus.cleanupAll();
    this._eventBus.removeAllListeners();
    this._hooks.clear();
    this._typedHooks.clear();
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
