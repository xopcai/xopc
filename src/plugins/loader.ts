/**
 * Plugin Loader and Registry
 */

import { existsSync, readFileSync } from 'fs';
import { join, dirname, basename, isAbsolute } from 'path';
import { createRequire } from 'module';
import type {
  ChannelPlugin,
  GatewayMethodHandler,
  HttpRequestHandler,
  PluginApi,
  PluginCommand,
  PluginDefinition,
  PluginHookEvent,
  PluginHookHandler,
  PluginManifest,
  PluginModule,
  PluginRecord,
  PluginRegistry,
  PluginService,
  ResolvedPluginConfig,
} from './types.js';
import { PluginApiImpl, createPluginLogger, createPathResolver } from './api.js';

const PLUGIN_MANIFEST_FILE = 'xopcbot.plugin.json';

// ============================================================================
// Plugin Registry
// ============================================================================

export class PluginRegistryImpl implements PluginRegistry {
  plugins = new Map<string, PluginRecord>();
  hooks = new Map<PluginHookEvent, PluginHookHandler[]>();
  channels = new Map<string, ChannelPlugin>();
  httpRoutes = new Map<string, HttpRequestHandler>();
  commands = new Map<string, PluginCommand>();
  services = new Map<string, PluginService>();
  gatewayMethods = new Map<string, GatewayMethodHandler>();

  addPlugin(record: PluginRecord): void {
    this.plugins.set(record.definition.id, record);
  }

  getPlugin(id: string): PluginRecord | undefined {
    return this.plugins.get(id);
  }

  getEnabledPlugins(): PluginRecord[] {
    return Array.from(this.plugins.values()).filter(p => p.enabled);
  }

  addHook(event: PluginHookEvent, handler: PluginHookHandler, pluginId: string, priority = 0): void {
    if (!this.hooks.has(event)) {
      this.hooks.set(event, []);
    }
    // Store with priority wrapper
    const priorityHandler: PluginHookHandler = async (eventData: unknown, context: unknown) => {
      return handler(eventData, context);
    };
    (priorityHandler as any)[Symbol.for('pluginId')] = pluginId;
    (priorityHandler as any)[Symbol.for('priority')] = priority;
    this.hooks.get(event)!.push(priorityHandler);
  }

  getHooks(event: PluginHookEvent): PluginHookHandler[] {
    const handlers = this.hooks.get(event);
    if (!handlers) return [];
    // Sort by priority (descending)
    return handlers.slice().sort((a, b) => {
      const pa = ((a as any)[Symbol.for('priority')] as number) || 0;
      const pb = ((b as any)[Symbol.for('priority')] as number) || 0;
      return pb - pa;
    });
  }

  addChannel(channel: ChannelPlugin): void {
    if (this.channels.has(channel.name)) {
      console.warn(`Channel ${channel.name} already registered, overwriting`);
    }
    this.channels.set(channel.name, channel);
  }

  getChannel(name: string): ChannelPlugin | undefined {
    return this.channels.get(name);
  }

  addHttpRoute(path: string, handler: HttpRequestHandler): void {
    if (this.httpRoutes.has(path)) {
      console.warn(`HTTP route ${path} already registered, overwriting`);
    }
    this.httpRoutes.set(path, handler);
  }

  getHttpRoute(path: string): HttpRequestHandler | undefined {
    return this.httpRoutes.get(path);
  }

  addCommand(command: PluginCommand): void {
    if (this.commands.has(command.name)) {
      console.warn(`Command /${command.name} already registered, overwriting`);
    }
    this.commands.set(command.name, command);
  }

  getCommand(name: string): PluginCommand | undefined {
    return this.commands.get(name);
  }

  addService(service: PluginService): void {
    if (this.services.has(service.id)) {
      console.warn(`Service ${service.id} already registered, overwriting`);
    }
    this.services.set(service.id, service);
  }

  getService(id: string): PluginService | undefined {
    return this.services.get(id);
  }

  addGatewayMethod(method: string, handler: GatewayMethodHandler): void {
    if (this.gatewayMethods.has(method)) {
      console.warn(`Gateway method ${method} already registered, overwriting`);
    }
    this.gatewayMethods.set(method, handler);
  }

  getGatewayMethod(method: string): GatewayMethodHandler | undefined {
    return this.gatewayMethods.get(method);
  }
}

// ============================================================================
// Plugin Loader
// ============================================================================

export interface PluginLoaderOptions {
  workspaceDir?: string;
  pluginsDir?: string;
  bundedPlugins?: string[];
}

export class PluginLoader {
  private registry: PluginRegistryImpl;
  private options: PluginLoaderOptions;
  private pluginInstances: Map<string, PluginApi> = new Map();

  constructor(options?: PluginLoaderOptions) {
    this.registry = new PluginRegistryImpl();
    this.options = options || {
      workspaceDir: join(process.env.HOME || '', '.xopcbot', 'workspace'),
      pluginsDir: join(process.env.HOME || '', '.xopcbot', 'plugins'),
    };
  }

  getRegistry(): PluginRegistryImpl {
    return this.registry;
  }

  async loadPlugins(configs: ResolvedPluginConfig[]): Promise<void> {
    for (const pluginConfig of configs) {
      if (pluginConfig.enabled) {
        await this.loadPlugin(pluginConfig);
      }
    }
  }

  async loadPlugin(config: ResolvedPluginConfig): Promise<PluginApi | null> {
    try {
      // Check if already loaded
      if (this.pluginInstances.has(config.id)) {
        return this.pluginInstances.get(config.id)!;
      }

      const manifest = await this.loadManifest(config.path);
      if (!manifest) {
        console.error(`Failed to load manifest for plugin: ${config.id}`);
        return null;
      }

      // Create plugin API
      const pluginDir = dirname(config.path);
      const api = this.createPluginApi(manifest, config, pluginDir);

      // Load plugin module
      const module = await this.loadModule(config.path, manifest);
      if (!module) {
        console.error(`Failed to load module for plugin: ${config.id}`);
        return null;
      }

      // Initialize plugin
      await this.initializePlugin(module, api, manifest);

      // Register to registry
      this.registry.addPlugin({
        definition: manifest,
        module,
        source: config.path,
        enabled: true,
        loaded: true,
      });

      this.pluginInstances.set(config.id, api);
      console.log(`Loaded plugin: ${manifest.name} (${manifest.id})`);
      
      return api;
    } catch (error) {
      console.error(`Error loading plugin ${config.id}:`, error);
      return null;
    }
  }

  private async loadManifest(pluginPath: string): Promise<PluginManifest | null> {
    const manifestPath = join(pluginPath, PLUGIN_MANIFEST_FILE);
    
    if (!existsSync(manifestPath)) {
      // Try to infer from package.json
      const packagePath = join(pluginPath, 'package.json');
      if (existsSync(packagePath)) {
        try {
          const packageJson = JSON.parse(readFileSync(packagePath, 'utf-8'));
          if (packageJson.xopcbot?.plugin) {
            return {
              id: packageJson.name,
              name: packageJson.xopcbot.name || packageJson.name,
              description: packageJson.description,
              version: packageJson.version,
              main: packageJson.main,
              configSchema: packageJson.xopcbot.configSchema,
              ...packageJson.xopcbot,
            };
          }
        } catch {
          // Ignore
        }
      }
      return null;
    }

    try {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
      return manifest as PluginManifest;
    } catch (error) {
      console.error(`Failed to parse manifest: ${manifestPath}`, error);
      return null;
    }
  }

  private async loadModule(pluginPath: string, manifest: PluginManifest): Promise<PluginModule | null> {
    const require = createRequire(import.meta.url);
    
    // Determine entry point
    const entryPoints = [
      manifest.main,
      'index.js',
      'index.ts',
      'plugin.js',
      'plugin.ts',
    ].filter(Boolean) as string[];

    for (const entry of entryPoints) {
      const fullPath = isAbsolute(entry) ? entry : join(pluginPath, entry);
      
      if (existsSync(fullPath)) {
        try {
          // Dynamic import for ESM
          if (fullPath.endsWith('.ts')) {
            // For TypeScript, we need to use the tsx or ts-node
            // In production, plugins should be pre-compiled
            const dynamicImport = await import(fullPath);
            return dynamicImport.default || dynamicImport;
          } else {
            const dynamicImport = await import(fullPath);
            return dynamicImport.default || dynamicImport;
          }
        } catch (error) {
          console.warn(`Failed to load module ${fullPath}:`, error);
        }
      }
    }

    return null;
  }

  private createPluginApi(
    manifest: PluginManifest,
    config: ResolvedPluginConfig,
    pluginDir: string,
  ): PluginApi {
    const logger = createPluginLogger(`[${manifest.id}]`);
    const resolvePath = createPathResolver(pluginDir, this.options.workspaceDir || '');

    return new PluginApiImpl(
      manifest.id,
      manifest.name,
      manifest.version,
      pluginDir,
      config.config as any,  // Simplified for now
      config.config,
      logger,
      resolvePath,
    );
  }

  private async initializePlugin(
    module: PluginModule,
    api: PluginApi,
    manifest: PluginManifest,
  ): Promise<void> {
    if (typeof module === 'function') {
      // Module is a function that receives the API
      await module(api);
    } else if (typeof module === 'object' && module.register) {
      // Module is a PluginDefinition with register method
      await module.register(api);
    }
  }

  async startServices(): Promise<void> {
    const services = Array.from(this.registry.services.values());
    
    for (const service of services) {
      try {
        await service.start({
          config: {} as any,  // Simplified
          workspaceDir: this.options.workspaceDir || '',
          stateDir: join(this.options.workspaceDir || '', '.state'),
          logger: {
            debug: (msg) => console.debug(`[${service.id}] DEBUG: ${msg}`),
            info: (msg) => console.log(`[${service.id}] INFO: ${msg}`),
            warn: (msg) => console.warn(`[${service.id}] WARN: ${msg}`),
            error: (msg) => console.error(`[${service.id}] ERROR: ${msg}`),
          },
        });
        console.log(`Started service: ${service.id}`);
      } catch (error) {
        console.error(`Failed to start service ${service.id}:`, error);
      }
    }
  }

  async stopServices(): Promise<void> {
    const services = Array.from(this.registry.services.values()).reverse();
    
    for (const service of services) {
      if (service.stop) {
        try {
          await service.stop({
            config: {} as any,
            workspaceDir: this.options.workspaceDir || '',
            stateDir: join(this.options.workspaceDir || '', '.state'),
            logger: {
              debug: () => {},
              info: () => {},
              warn: () => {},
              error: () => {},
            },
          });
          console.log(`Stopped service: ${service.id}`);
        } catch (error) {
          console.error(`Failed to stop service ${service.id}:`, error);
        }
      }
    }
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

export function resolvePluginPath(id: string, options: PluginLoaderOptions): string | null {
  const { pluginsDir } = options;
  
  if (!pluginsDir) return null;
  
  // Check if it's a built-in plugin
  const builtinPath = join(__dirname, '..', '..', 'plugins', id);
  if (existsSync(builtinPath)) return builtinPath;
  
  // Check plugins directory
  const pluginPath = join(pluginsDir, id);
  if (existsSync(pluginPath)) return pluginPath;
  
  // Check if it's an npm package
  try {
    const require = createRequire(import.meta.url);
    const resolved = require.resolve(id);
    return dirname(resolved);
  } catch {
    return null;
  }
}

export function normalizePluginConfig(
  rawConfig: Record<string, unknown>,
): ResolvedPluginConfig[] {
  const plugins: ResolvedPluginConfig[] = [];
  
  const enabled = (rawConfig.enabled as string[]) || [];
  const disabled = (rawConfig.disabled as string[]) || [];
  
  // Parse enabled plugins
  for (const id of enabled) {
    const config = (rawConfig[id] as Record<string, unknown>) || {};
    plugins.push({
      id,
      origin: 'config',
      path: id,
      enabled: true,
      config,
    });
  }
  
  // Parse disabled plugins
  for (const id of disabled) {
    if (!plugins.find(p => p.id === id)) {
      const config = (rawConfig[id] as Record<string, unknown>) || {};
      plugins.push({
        id,
        origin: 'config',
        path: id,
        enabled: false,
        config,
      });
    }
  }
  
  return plugins;
}
