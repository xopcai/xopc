/**
 * `ExtensionRegistryImpl` — extracted from `loader.ts` so `api.ts` can use it
 * without going through `loader.ts` (which imports back from `api.ts`,
 * forming a circular cycle).
 *
 * `loader.ts` still re-exports the class for backward-compat; this file is a
 * leaf and only depends on the type definitions in `./types/index.js`.
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
    _extensionId: string,
    _priority = 0,
  ): void {
    if (!this.hooks.has(event)) {
      this.hooks.set(event, []);
    }
    this.hooks.get(event)!.push(handler);
  }

  getHooks(event: ExtensionHookEvent): ExtensionHookHandler[] {
    return this.hooks.get(event) || [];
  }

  addChannelPlugin(plugin: ChannelPlugin): void {
    this.channelPlugins = this.channelPlugins.filter((p) => p.id !== plugin.id);
    this.channelPlugins.push(plugin);
  }

  addHttpRoute(path: string, handler: HttpRequestHandler): void {
    if (this.httpRoutes.has(path)) {
      log.warn({ path }, `HTTP route already registered, overwriting`);
    }
    this.httpRoutes.set(path, handler);
  }

  getHttpRoute(path: string): HttpRequestHandler | undefined {
    return this.httpRoutes.get(path);
  }

  addCommand(command: ExtensionCommand): void {
    if (this.commands.has(command.name)) {
      log.warn({ command: command.name }, `Command already registered, overwriting`);
    }
    this.commands.set(command.name, command);
  }

  getCommand(name: string): ExtensionCommand | undefined {
    return this.commands.get(name);
  }

  addService(service: ExtensionService): void {
    if (this.services.has(service.id)) {
      log.warn({ service: service.id }, `Service already registered, overwriting`);
    }
    this.services.set(service.id, service);
  }

  getService(id: string): ExtensionService | undefined {
    return this.services.get(id);
  }

  addGatewayMethod(method: string, handler: GatewayMethodHandler): void {
    if (this.gatewayMethods.has(method)) {
      log.warn({ method }, `Gateway method already registered, overwriting`);
    }
    this.gatewayMethods.set(method, handler);
  }

  getGatewayMethod(method: string): GatewayMethodHandler | undefined {
    return this.gatewayMethods.get(method);
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
