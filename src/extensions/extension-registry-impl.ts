/**
 * `ExtensionRegistryImpl` — extracted from `loader.ts` so `api.ts` can use it
 * without going through `loader.ts` (which imports back from `api.ts`,
 * forming a circular cycle).
 *
 * This file is a leaf and only depends on the type definitions in `./types/index.js`.
 */

import type { AgentTool } from '@earendil-works/pi-agent-core';

import type { ChannelPlugin } from '../channels/plugin-types.js';
import { createLogger } from '../utils/logger.js';
import type {
  ExtensionCliRegistration,
  ExtensionCommand,
  ExtensionHookEvent,
  ExtensionHookHandler,
  ExtensionRecord,
  ExtensionRegistry,
  ExtensionMigrationRegistration,
  ExtensionReloadRegistration,
  ExtensionService,
  GatewayMethodHandler,
  HttpRequestHandler,
  TuiExtensionRegistrar,
  TuiExtensionRegistration,
} from './types/index.js';

const log = createLogger('ExtensionRegistry');

export class ExtensionRegistryImpl implements ExtensionRegistry {
  extensions = new Map<string, ExtensionRecord>();
  hooks = new Map<ExtensionHookEvent, ExtensionHookHandler[]>();
  httpRoutes = new Map<string, HttpRequestHandler>();
  commands = new Map<string, ExtensionCommand>();
  services = new Map<string, ExtensionService>();
  gatewayMethods = new Map<string, GatewayMethodHandler>();
  tools: Map<string, AgentTool<any, any>> = new Map();
  private toolExtensionIds = new Map<string, string>();
  private hookOwners = new Map<ExtensionHookEvent, Map<ExtensionHookHandler, string>>();
  private hookPriorities = new Map<ExtensionHookEvent, Map<ExtensionHookHandler, number>>();
  private channelOwners = new Map<string, string>();
  private httpRouteOwners = new Map<string, string>();
  private commandOwners = new Map<string, string>();
  private serviceOwners = new Map<string, string>();
  private gatewayMethodOwners = new Map<string, string>();
  channelPlugins: ChannelPlugin[] = [];
  private cliRegistrations: ExtensionCliRegistration[] = [];
  private reloadRegistrations: ExtensionReloadRegistration[] = [];
  private migrationRegistrations: ExtensionMigrationRegistration[] = [];
  private tuiRegistrations: TuiExtensionRegistration[] = [];

  addExtension(record: ExtensionRecord): void {
    this.extensions.set(record.id, record);
  }

  getExtension(id: string): ExtensionRecord | undefined {
    return this.extensions.get(id);
  }

  getEnabledExtensions(): ExtensionRecord[] {
    return Array.from(this.extensions.values()).filter((p) => p.enabled);
  }

  addHook(
    event: ExtensionHookEvent,
    handler: ExtensionHookHandler,
    extensionId: string,
    priority = 0,
  ): void {
    if (!this.hooks.has(event)) {
      this.hooks.set(event, []);
    }
    const owners = this.hookOwners.get(event) ?? new Map<ExtensionHookHandler, string>();
    const priorities = this.hookPriorities.get(event) ?? new Map<ExtensionHookHandler, number>();
    owners.set(handler, extensionId);
    priorities.set(handler, priority);
    this.hookOwners.set(event, owners);
    this.hookPriorities.set(event, priorities);
    const handlers = this.hooks.get(event)!;
    handlers.push(handler);
    handlers.sort(
      (left, right) =>
        (priorities.get(right) ?? 0) - (priorities.get(left) ?? 0),
    );
  }

  removeHook(event: ExtensionHookEvent, handler: ExtensionHookHandler): void {
    const handlers = this.hooks.get(event);
    if (!handlers) return;
    const next = handlers.filter((candidate) => candidate !== handler);
    if (next.length > 0) this.hooks.set(event, next);
    else this.hooks.delete(event);
    const owners = this.hookOwners.get(event);
    const priorities = this.hookPriorities.get(event);
    owners?.delete(handler);
    priorities?.delete(handler);
    if (owners?.size === 0) this.hookOwners.delete(event);
    if (priorities?.size === 0) this.hookPriorities.delete(event);
  }

  getHooks(event: ExtensionHookEvent): ExtensionHookHandler[] {
    return this.hooks.get(event) || [];
  }

  addChannelPlugin(plugin: ChannelPlugin, extensionId = ''): void {
    this.channelPlugins = this.channelPlugins.filter((p) => p.id !== plugin.id);
    this.channelPlugins.push(plugin);
    this.channelOwners.set(plugin.id, extensionId);
  }

  addHttpRoute(path: string, handler: HttpRequestHandler, extensionId = ''): void {
    const key = this.httpRouteKey(extensionId, path);
    if (this.httpRoutes.has(key)) {
      log.warn({ extensionId, path }, `HTTP route already registered, overwriting`);
    }
    this.httpRoutes.set(key, handler);
    this.httpRouteOwners.set(key, extensionId);
  }

  getHttpRoute(extensionId: string, path: string): HttpRequestHandler | undefined {
    return this.httpRoutes.get(this.httpRouteKey(extensionId, path));
  }

  addCommand(command: ExtensionCommand, extensionId = ''): void {
    if (this.commands.has(command.name)) {
      log.warn({ command: command.name }, `Command already registered, overwriting`);
    }
    this.commands.set(command.name, command);
    this.commandOwners.set(command.name, extensionId);
  }

  getCommand(name: string): ExtensionCommand | undefined {
    return this.commands.get(name);
  }

  addService(service: ExtensionService, extensionId = ''): void {
    if (this.services.has(service.id)) {
      log.warn({ service: service.id }, `Service already registered, overwriting`);
    }
    this.services.set(service.id, service);
    this.serviceOwners.set(service.id, extensionId);
  }

  getService(id: string): ExtensionService | undefined {
    return this.services.get(id);
  }

  addGatewayMethod(method: string, handler: GatewayMethodHandler, extensionId = ''): void {
    if (this.gatewayMethods.has(method)) {
      log.warn({ method }, `Gateway method already registered, overwriting`);
    }
    this.gatewayMethods.set(method, handler);
    this.gatewayMethodOwners.set(method, extensionId);
  }

  getGatewayMethod(method: string): GatewayMethodHandler | undefined {
    return this.gatewayMethods.get(method);
  }

  getServicesForExtension(extensionId: string): ExtensionService[] {
    return [...this.services.entries()]
      .filter(([id]) => this.serviceOwners.get(id) === extensionId)
      .map(([, service]) => service);
  }

  removeExtensionContributions(extensionId: string): void {
    for (const [event, handlers] of this.hooks) {
      for (const handler of [...handlers]) {
        if (this.hookOwners.get(event)?.get(handler) === extensionId) this.removeHook(event, handler);
      }
    }
    for (const [name, owner] of this.toolExtensionIds) {
      if (owner === extensionId) this.removeTool(name);
    }
    this.channelPlugins = this.channelPlugins.filter((plugin) => {
      const owned = this.channelOwners.get(plugin.id) === extensionId;
      if (owned) this.channelOwners.delete(plugin.id);
      return !owned;
    });
    this.removeOwnedEntries(this.httpRoutes, this.httpRouteOwners, extensionId);
    this.removeOwnedEntries(this.commands, this.commandOwners, extensionId);
    this.removeOwnedEntries(this.services, this.serviceOwners, extensionId);
    this.removeOwnedEntries(this.gatewayMethods, this.gatewayMethodOwners, extensionId);
    this.cliRegistrations = this.cliRegistrations.filter((entry) => entry.extensionId !== extensionId);
    this.reloadRegistrations = this.reloadRegistrations.filter((entry) => entry.extensionId !== extensionId);
    this.migrationRegistrations = this.migrationRegistrations.filter((entry) => entry.extensionId !== extensionId);
    this.tuiRegistrations = this.tuiRegistrations.filter((entry) => entry.extensionId !== extensionId);
    this.extensions.delete(extensionId);
  }

  private removeOwnedEntries<T>(
    values: Map<string, T>,
    owners: Map<string, string>,
    extensionId: string,
  ): void {
    for (const [key, owner] of owners) {
      if (owner !== extensionId) continue;
      owners.delete(key);
      values.delete(key);
    }
  }

  private httpRouteKey(extensionId: string, path: string): string {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    return `${extensionId}:${normalizedPath}`;
  }

  // Tools
  addTool(tool: any, extensionId: string): void {
    if (this.tools.has(tool.name)) {
      log.warn({ tool: tool.name }, `Tool already registered, overwriting`);
    }
    this.tools.set(tool.name, tool);
    this.toolExtensionIds.set(tool.name, extensionId);
  }

  removeTool(name: string): void {
    this.tools.delete(name);
    this.toolExtensionIds.delete(name);
  }

  getTools(): Map<string, any> {
    return this.tools;
  }

  getTool(name: string): any | undefined {
    return this.tools.get(name);
  }

  getToolExtensionId(name: string): string | undefined {
    return this.toolExtensionIds.get(name);
  }

  getAllTools(): any[] {
    return Array.from(this.tools.values());
  }

  addCliRegistration(reg: ExtensionCliRegistration): void {
    this.cliRegistrations.push(reg);
  }

  getCliRegistrations(): readonly ExtensionCliRegistration[] {
    return this.cliRegistrations;
  }

  addTuiRegistration(extensionId: string, register: TuiExtensionRegistrar): void {
    this.tuiRegistrations.push({ extensionId, register });
  }

  getTuiRegistrations(): readonly TuiExtensionRegistration[] {
    return this.tuiRegistrations;
  }

  addReloadRegistration(reg: ExtensionReloadRegistration): void {
    this.reloadRegistrations = this.reloadRegistrations.filter(
      (r) => r.extensionId !== reg.extensionId,
    );
    this.reloadRegistrations.push(reg);
  }

  removeReloadRegistration(extensionId: string): void {
    this.reloadRegistrations = this.reloadRegistrations.filter(
      (r) => r.extensionId !== extensionId,
    );
  }

  getReloadRegistrations(): readonly ExtensionReloadRegistration[] {
    return this.reloadRegistrations;
  }

  addMigrationRegistration(reg: ExtensionMigrationRegistration): void {
    this.migrationRegistrations = this.migrationRegistrations.filter(
      (r) => !(r.extensionId === reg.extensionId && r.migration.id === reg.migration.id),
    );
    this.migrationRegistrations.push(reg);
  }

  getMigrationRegistrations(): readonly ExtensionMigrationRegistration[] {
    return this.migrationRegistrations;
  }

  getMatchingReloadRegistrations(changedPaths: string[]): ExtensionReloadRegistration[] {
    return this.reloadRegistrations.filter((reg) => {
      if (reg.configPrefixes.length === 0) {
        return true;
      }
      return reg.configPrefixes.some((prefix) =>
        changedPaths.some((path) => path === prefix || path.startsWith(`${prefix}.`)),
      );
    });
  }
}
