/**
 * Extension testing helpers (Phase 2): mock API + minimal HTTP gateway fixture.
 */

import type { Command } from 'commander';
import { EventEmitter } from 'node:events';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';

import type { AgentTool } from '@mariozechner/pi-agent-core';

import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import type { ServerType } from '@hono/node-server';

import type { ChannelPlugin } from '../../channels/plugin-types.js';
import type { Config } from '../../config/config-surface.js';
import type {
  ExtensionApi,
  ExtensionCommand,
  ExtensionCommandContext,
  ExtensionCommandHandler,
  ExtensionLogger,
  ExtensionReloadHandler,
  ExtensionRuntime,
  ExtensionService,
  GatewayMethodHandler,
  HttpRequestHandler,
} from '../types/core.js';
import type { FlagConfig, FlagValue, ShortcutConfig } from '../types/phase4.js';
import type {
  ExtensionHookEvent,
  ExtensionHookHandler,
  HookHandlerMap,
  HookOptions,
} from '../types/hooks.js';
import type { CommandContribution } from '../types/manifest.js';
import { TypedEventBus } from '../typed-event-bus.js';

export interface MockExtensionApiOptions {
  id?: string;
  name?: string;
  version?: string;
  source?: string;
  extensionConfig?: Record<string, unknown>;
  config?: Partial<Config>;
  logger?: ExtensionLogger;
  /** Pretend manifest `ui.contributions.commands` for `onCommand` tests. */
  manifestCommands?: CommandContribution[];
}

const noopLogger: ExtensionLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

export interface MockExtensionApi extends ExtensionApi {
  getRegisteredTools(): AgentTool[];
  getRegisteredHooks(): Array<{ event: ExtensionHookEvent; handler: unknown }>;
  getRegisteredCommands(): ExtensionCommand[];
  getRegisteredHttpRoutes(): Array<{ path: string; handler: HttpRequestHandler }>;
  getRegisteredServices(): ExtensionService[];
  getRegisteredGatewayMethods(): Array<{ method: string; handler: GatewayMethodHandler }>;
  getRegisteredChannelPlugins(): ChannelPlugin[];
  getRegisteredReloadHandlers(): ExtensionReloadHandler[];
  getEmittedEvents(): Array<{ event: string; data: unknown }>;
}

export function createMockExtensionApi(options: MockExtensionApiOptions = {}): MockExtensionApi {
  return new MockExtensionApiImpl(options);
}

class MockExtensionApiImpl implements MockExtensionApi {
  readonly id: string;
  readonly name: string;
  readonly version: string | undefined;
  readonly source: string;
  readonly config: Config;
  readonly extensionConfig: Record<string, unknown>;
  readonly logger: ExtensionLogger;
  readonly runtime: ExtensionRuntime;
  readonly events: TypedEventBus;

  private readonly _tools: AgentTool[] = [];
  private readonly _hooks: Array<{ event: ExtensionHookEvent; handler: unknown }> = [];
  private readonly _commands: ExtensionCommand[] = [];
  private readonly _http: Array<{ path: string; handler: HttpRequestHandler }> = [];
  private readonly _services: ExtensionService[] = [];
  private readonly _gw: Array<{ method: string; handler: GatewayMethodHandler }> = [];
  private readonly _channels: ChannelPlugin[] = [];
  private readonly _reload: ExtensionReloadHandler[] = [];
  private readonly _emitted: Array<{ event: string; data: unknown }> = [];
  private readonly _bus = new EventEmitter();
  private readonly _manifestCommands = new Map<string, CommandContribution>();

  constructor(opts: MockExtensionApiOptions) {
    this.id = opts.id ?? 'test-extension';
    this.name = opts.name ?? 'Test Extension';
    this.version = opts.version;
    this.source = opts.source ?? '/test';
    this.extensionConfig = opts.extensionConfig ?? {};
    this.config = (opts.config ?? {}) as Config;
    this.logger = opts.logger ?? noopLogger;
    this.runtime = { config: this.config, log: this.logger };
    this.events = new TypedEventBus({ logger: this.logger });
    if (opts.manifestCommands?.length) {
      for (const c of opts.manifestCommands) {
        this._manifestCommands.set(c.id, c);
      }
    }
  }

  _setManifestCommands(commands: CommandContribution[]): void {
    this._manifestCommands.clear();
    for (const c of commands) {
      this._manifestCommands.set(c.id, c);
    }
  }

  getRegisteredTools(): AgentTool[] {
    return [...this._tools];
  }
  getRegisteredHooks(): Array<{ event: ExtensionHookEvent; handler: unknown }> {
    return [...this._hooks];
  }
  getRegisteredCommands(): ExtensionCommand[] {
    return [...this._commands];
  }
  getRegisteredHttpRoutes(): Array<{ path: string; handler: HttpRequestHandler }> {
    return [...this._http];
  }
  getRegisteredServices(): ExtensionService[] {
    return [...this._services];
  }
  getRegisteredGatewayMethods(): Array<{ method: string; handler: GatewayMethodHandler }> {
    return [...this._gw];
  }
  getRegisteredChannelPlugins(): ChannelPlugin[] {
    return [...this._channels];
  }
  getRegisteredReloadHandlers(): ExtensionReloadHandler[] {
    return [...this._reload];
  }
  getEmittedEvents(): Array<{ event: string; data: unknown }> {
    return [...this._emitted];
  }

  registerTool(tool: AgentTool): void {
    this._tools.push(tool);
  }

  registerHook(
    event: ExtensionHookEvent,
    handler: ExtensionHookHandler,
    _opts?: HookOptions,
  ): void {
    this._hooks.push({ event, handler });
  }

  onHook<K extends ExtensionHookEvent>(_hookName: K, _handler: HookHandlerMap[K]): void {
    /* optional for tests */
  }

  registerChannel(registration: { plugin: ChannelPlugin }): void {
    this._channels.push(registration.plugin);
  }

  registerHttpRoute(path: string, handler: HttpRequestHandler): void {
    this._http.push({ path, handler });
  }

  registerCommand(command: ExtensionCommand): void {
    this._commands.push(command);
  }

  onCommand(commandId: string, handler: ExtensionCommandHandler): void {
    const meta = this._manifestCommands.get(commandId);
    if (!meta) {
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
    if (!name) name = meta.id;
    this.registerCommand({ name, description: meta.title, handler });
  }

  registerReload(handler: ExtensionReloadHandler): void {
    this._reload.push(handler);
  }

  registerService(service: ExtensionService): void {
    this._services.push(service);
  }

  registerGatewayMethod(method: string, handler: GatewayMethodHandler): void {
    this._gw.push({ method, handler });
  }

  registerCli(_factory: (ctx: { program: Command }) => void, _opts?: { commands: string[] }): void {
    /* noop */
  }

  resolvePath(input: string): string {
    const base = this.source.replace(/\/$/, '');
    const p = input.replace(/^\//, '');
    return `${base}/${p}`;
  }

  emit(event: string, data: unknown): void {
    this._emitted.push({ event, data });
    this._bus.emit(event, data);
  }

  on(event: string, handler: (data: unknown) => void): void {
    this._bus.on(event, handler);
  }

  off(event: string, handler: (data: unknown) => void): void {
    this._bus.off(event, handler);
  }

  registerProvider(_plugin: unknown): void {
    /* noop */
  }

  registerProviderPlugin(_plugin: unknown): void {
    /* noop */
  }

  registerFlag(_name: string, _config: FlagConfig): void {
    /* noop */
  }

  getFlag(_name: string): FlagValue {
    return undefined;
  }

  registerShortcut(_key: string, _config: ShortcutConfig): void {
    /* noop */
  }
}

export interface TestGateway {
  baseUrl: string;
  fetch: (path: string, init?: RequestInit) => Promise<Response>;
  close: () => Promise<void>;
}

export async function createTestGateway(): Promise<TestGateway> {
  const app = new Hono();
  app.get('/health', (c) => c.json({ ok: true }));

  const server: ServerType = serve({
    fetch: app.fetch,
    port: 0,
    hostname: '127.0.0.1',
  });

  if (!server.listening) {
    await once(server, 'listening');
  }
  const addr = server.address() as AddressInfo;
  const port = addr.port;
  const baseUrl = `http://127.0.0.1:${port}`;

  return {
    baseUrl,
    fetch: (path, init) =>
      fetch(`${baseUrl}${path.startsWith('/') ? path : `/${path}`}`, init),
    close: () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

export type { ExtensionCommandContext };
