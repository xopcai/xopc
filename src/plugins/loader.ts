/**
 * Plugin Loader and Registry
 * 
 * Supports three-tier plugin storage:
 * 1. Workspace level (workspace/.plugins/) - highest priority
 * 2. Global level (~/.xopcbot/plugins/) - shared across workspaces
 * 3. Bundled level (xopcbot/plugins/) - shipped with xopcbot
 */

import { existsSync, readFileSync, readdirSync } from 'fs';
import { join, dirname, isAbsolute } from 'path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createJiti } from 'jiti';
import {
  DEFAULT_PATHS,
  getGlobalPluginsDir,
  getWorkspacePluginsDir,
  getBundledPluginsDir,
  resolvePluginSdkPath,
} from '../config/paths.js';
import type {
  ChannelPlugin,
  GatewayMethodHandler,
  HttpRequestHandler,
  PluginApi,
  PluginCommand,
  PluginHookEvent,
  PluginHookHandler,
  PluginManifest,
  PluginModule,
  PluginRecord,
  PluginRegistry,
  PluginService,
  PluginTool,
  ResolvedPluginConfig,
} from './types.js';
import { PluginApiImpl, createPluginLogger, createPathResolver } from './api.js';
import { createLogger, createServiceLogger } from '../utils/logger.js';

const PLUGIN_MANIFEST_FILE = 'xopcbot.plugin.json';

const log = createLogger('PluginLoader');

// Plugin source origin for debugging
export type PluginSourceOrigin = 'workspace' | 'global' | 'bundled' | 'config';

interface DiscoveredPlugin {
  id: string;
  path: string;
  origin: PluginSourceOrigin;
  manifest: PluginManifest;
}

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
  tools = new Map<string, PluginTool>();

  addPlugin(record: PluginRecord): void {
    this.plugins.set(record.definition.id, record);
  }

  getPlugin(id: string): PluginRecord | undefined {
    return this.plugins.get(id);
  }

  getEnabledPlugins(): PluginRecord[] {
    return Array.from(this.plugins.values()).filter((p) => p.enabled);
  }

  addHook(
    event: PluginHookEvent,
    handler: PluginHookHandler,
    pluginId: string,
    priority = 0,
  ): void {
    if (!this.hooks.has(event)) {
      this.hooks.set(event, []);
    }
    // Store with priority wrapper
    const priorityHandler: PluginHookHandler = async (eventData: unknown, context: unknown) => {
      return handler(eventData, context);
    };
    (priorityHandler as unknown as Record<symbol, unknown>)[Symbol.for('pluginId')] = pluginId;
    (priorityHandler as unknown as Record<symbol, unknown>)[Symbol.for('priority')] = priority;
    this.hooks.get(event)!.push(priorityHandler);
  }

  getHooks(event: PluginHookEvent): PluginHookHandler[] {
    const handlers = this.hooks.get(event);
    if (!handlers) return [];
    // Sort by priority (descending)
    return handlers.slice().sort((a, b) => {
      const pa =
        ((a as unknown as Record<symbol, unknown>)[Symbol.for('priority')] as number) || 0;
      const pb =
        ((b as unknown as Record<symbol, unknown>)[Symbol.for('priority')] as number) || 0;
      return pb - pa;
    });
  }

  addChannel(channel: ChannelPlugin): void {
    if (this.channels.has(channel.name)) {
      log.warn({ channel: channel.name }, `Channel already registered, overwriting`);
    }
    this.channels.set(channel.name, channel);
  }

  getChannel(name: string): ChannelPlugin | undefined {
    return this.channels.get(name);
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

  addCommand(command: PluginCommand): void {
    if (this.commands.has(command.name)) {
      log.warn({ command: command.name }, `Command already registered, overwriting`);
    }
    this.commands.set(command.name, command);
  }

  getCommand(name: string): PluginCommand | undefined {
    return this.commands.get(name);
  }

  addService(service: PluginService): void {
    if (this.services.has(service.id)) {
      log.warn({ service: service.id }, `Service already registered, overwriting`);
    }
    this.services.set(service.id, service);
  }

  getService(id: string): PluginService | undefined {
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
  addTool(tool: PluginTool): void {
    if (this.tools.has(tool.name)) {
      log.warn({ tool: tool.name }, `Tool already registered, overwriting`);
    }
    this.tools.set(tool.name, tool);
  }

  getTool(name: string): PluginTool | undefined {
    return this.tools.get(name);
  }

  getAllTools(): PluginTool[] {
    return Array.from(this.tools.values());
  }
}

// ============================================================================
// Plugin Loader
// ============================================================================

export interface PluginLoaderOptions {
  workspaceDir?: string;
  pluginsDir?: string;
  bundledPlugins?: string[];
}

export class PluginLoader {
  private registry: PluginRegistryImpl;
  private options: PluginLoaderOptions;
  private pluginInstances: Map<string, PluginApi> = new Map();
  private jiti: ReturnType<typeof createJiti>;

  constructor(options?: PluginLoaderOptions) {
    this.registry = new PluginRegistryImpl();
    this.options = options || {
      workspaceDir: DEFAULT_PATHS.workspace,
      pluginsDir: DEFAULT_PATHS.plugins,
    };

    // Build jiti alias for plugin-sdk
    const alias: Record<string, string> = {};
    const sdkPath = resolvePluginSdkPath();
    if (sdkPath) {
      alias['xopcbot/plugin-sdk'] = sdkPath;
    }

    // Initialize jiti with TypeScript support and SDK alias
    this.jiti = createJiti(fileURLToPath(import.meta.url), {
      interopDefault: true,
      extensions: ['.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.cjs', '.json'],
      alias,
    });
  }

  getRegistry(): PluginRegistryImpl {
    return this.registry;
  }

  /**
   * Discover plugins from all three tiers:
   * 1. Workspace (.plugins/) - highest priority
   * 2. Global (~/.xopcbot/plugins/) - shared
   * 3. Bundled (xopcbot/plugins/) - lowest priority
   */
  discoverPlugins(): DiscoveredPlugin[] {
    const discovered = new Map<string, DiscoveredPlugin>();

    // Priority 3: Bundled plugins (lowest)
    const bundledDir = getBundledPluginsDir();
    if (bundledDir) {
      this.discoverInDirectory(bundledDir, 'bundled', discovered);
    }

    // Priority 2: Global plugins
    const globalDir = getGlobalPluginsDir();
    this.discoverInDirectory(globalDir, 'global', discovered);

    // Priority 1: Workspace plugins (highest, can override)
    const workspaceDir = this.options.workspaceDir || DEFAULT_PATHS.workspace;
    const workspacePluginsDir = getWorkspacePluginsDir(workspaceDir);
    this.discoverInDirectory(workspacePluginsDir, 'workspace', discovered);

    return Array.from(discovered.values());
  }

  private discoverInDirectory(
    dir: string,
    origin: PluginSourceOrigin,
    discovered: Map<string, DiscoveredPlugin>,
  ): void {
    if (!existsSync(dir)) {
      return;
    }

    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }

    for (const entry of entries) {
      const pluginPath = join(dir, entry);

      // Check if it's a directory
      try {
        const stat = existsSync(pluginPath);
        if (!stat) continue;
      } catch {
        continue;
      }

      // Try to load manifest
      const manifest = this.loadManifest(pluginPath);
      if (!manifest) continue;

      const pluginId = manifest.id || entry;

      // Higher priority origins can override lower ones
      const existing = discovered.get(pluginId);
      if (existing) {
        const priority = { workspace: 3, global: 2, bundled: 1, config: 0 };
        if (priority[origin] <= priority[existing.origin]) {
          log.debug(
            { pluginId, from: origin, existing: existing.origin },
            'Skipping lower priority plugin',
          );
          continue;
        }
        log.info(
          { pluginId, from: origin, overriding: existing.origin },
          'Plugin override by higher priority source',
        );
      }

      discovered.set(pluginId, {
        id: pluginId,
        path: pluginPath,
        origin,
        manifest,
      });
    }
  }

  /**
   * Load all discovered plugins
   */
  async loadAllPlugins(enabledIds?: string[]): Promise<void> {
    const plugins = this.discoverPlugins();

    for (const plugin of plugins) {
      // If enabledIds specified, only load those
      if (enabledIds && !enabledIds.includes(plugin.id)) {
        continue;
      }

      const config: ResolvedPluginConfig = {
        id: plugin.id,
        origin: plugin.origin,
        path: plugin.path,
        enabled: true,
        config: {},
      };

      await this.loadPlugin(config);
    }
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

      // Resolve plugin path using resolvePluginPath
      let pluginPath: string | null;
      if (isAbsolute(config.path)) {
        pluginPath = config.path;
      } else {
        // Try to resolve plugin ID to actual path
        pluginPath = resolvePluginPath(config.path, this.options) ||
                     resolvePluginPath(config.id, this.options);
      }
      
      if (!pluginPath) {
        log.error({ pluginId: config.id, path: config.path }, `Could not resolve plugin path`);
        return null;
      }

      log.debug({ pluginId: config.id, pluginPath }, 'Resolved plugin path');

      const manifest = this.loadManifest(pluginPath);
      if (!manifest) {
        log.error({ pluginId: config.id, pluginPath }, `Failed to load manifest for plugin`);
        return null;
      }

      // Create plugin API
      const pluginDir = dirname(pluginPath);
      const api = this.createPluginApi(manifest, config, pluginDir);

      // Load plugin module
      const module = await this.loadModule(pluginPath, manifest);
      if (!module) {
        log.error({ pluginId: config.id }, `Failed to load module for plugin`);
        return null;
      }

      // Initialize plugin
      await this.initializePlugin(module, api, manifest);

      // Register to registry
      this.registry.addPlugin({
        definition: manifest,
        module,
        source: pluginPath,
        enabled: true,
        loaded: true,
      });

      this.pluginInstances.set(config.id, api);
      log.info({ name: manifest.name, id: manifest.id, origin: config.origin }, `Loaded plugin`);

      return api;
    } catch (error) {
      log.error({ err: error, pluginId: config.id }, `Error loading plugin`);
      return null;
    }
  }

  loadManifest(pluginPath: string): PluginManifest | null {
    const manifestPath = join(pluginPath, PLUGIN_MANIFEST_FILE);

    // First try to load xopcbot.plugin.json
    if (existsSync(manifestPath)) {
      try {
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
        return manifest as PluginManifest;
      } catch (error) {
        log.error({ err: error, manifestPath }, `Failed to parse manifest`);
        return null;
      }
    }

    // Fallback to package.json
    const packagePath = join(pluginPath, 'package.json');
    if (existsSync(packagePath)) {
      try {
        const packageJson = JSON.parse(readFileSync(packagePath, 'utf-8'));
        
        // Check for xopcbot.plugin marker
        if (packageJson.xopcbot?.plugin) {
          const xopcbotConfig = packageJson.xopcbot;
          return {
            id: xopcbotConfig.id || packageJson.name,
            name: xopcbotConfig.name || packageJson.name,
            description: xopcbotConfig.description || packageJson.description,
            version: xopcbotConfig.version || packageJson.version || '1.0.0',
            kind: xopcbotConfig.kind || 'utility',
            main: xopcbotConfig.main || packageJson.main || 'index.js',
            configSchema: xopcbotConfig.configSchema,
          };
        }
        
        // Also support xopcbot-plugin-* naming convention
        if (packageJson.name?.startsWith('xopcbot-plugin-')) {
          const id = packageJson.name.replace('xopcbot-plugin-', '');
          return {
            id,
            name: packageJson.name,
            description: packageJson.description,
            version: packageJson.version || '1.0.0',
            kind: 'utility',
            main: packageJson.main || 'index.js',
          };
        }
      } catch (error) {
        log.error({ err: error, packagePath }, `Failed to parse package.json`);
      }
    }

    return null;
  }

  private async loadModule(
    pluginPath: string,
    manifest: PluginManifest,
  ): Promise<PluginModule | null> {
    // Determine entry point - .ts files prioritized for development
    const entryPoints = [
      manifest.main,
      'index.ts',
      'index.js',
      'plugin.ts',
      'plugin.js',
    ].filter(Boolean) as string[];

    for (const entry of entryPoints) {
      const fullPath = isAbsolute(entry) ? entry : join(pluginPath, entry);

      if (existsSync(fullPath)) {
        try {
          // Use jiti to load both .ts and .js files
          const mod = this.jiti(fullPath);
          return mod.default || mod;
        } catch (error) {
          log.warn({ err: error, path: fullPath }, `Failed to load module`);
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
      config.config as unknown as Record<string, unknown>,
      config.config,
      logger,
      resolvePath,
      this.registry, // Pass registry to sync tools
    );
  }

  private async initializePlugin(
    module: PluginModule,
    api: PluginApi,
    _manifest: PluginManifest,
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
      const serviceLog = createServiceLogger(service.id);
      try {
        await service.start({
          config: {} as unknown as Record<string, unknown>,
          workspaceDir: this.options.workspaceDir || '',
          stateDir: join(this.options.workspaceDir || '', '.state'),
          logger: createPluginLogger(`[${service.id}]`),
        });
        serviceLog.info(`Started service`);
      } catch (error) {
        serviceLog.error({ err: error }, `Failed to start service`);
      }
    }
  }

  async stopServices(): Promise<void> {
    const services = Array.from(this.registry.services.values()).reverse();

    for (const service of services) {
      if (service.stop) {
        const serviceLog = createServiceLogger(service.id);
        try {
          await service.stop({
            config: {} as unknown as Record<string, unknown>,
            workspaceDir: this.options.workspaceDir || '',
            stateDir: join(this.options.workspaceDir || '', '.state'),
            logger: {
              debug: () => {},
              info: () => {},
              warn: () => {},
              error: () => {},
            },
          });
          serviceLog.info(`Stopped service`);
        } catch (error) {
          serviceLog.error({ err: error }, `Failed to stop service`);
        }
      }
    }
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

export function resolvePluginPath(id: string, options: PluginLoaderOptions): string | null {
  // Priority 1: Workspace
  const workspaceDir = options.workspaceDir || DEFAULT_PATHS.workspace;
  const workspacePath = join(getWorkspacePluginsDir(workspaceDir), id);
  if (existsSync(workspacePath)) return workspacePath;

  // Priority 2: Global
  const globalPath = join(getGlobalPluginsDir(), id);
  if (existsSync(globalPath)) return globalPath;

  // Priority 3: Bundled
  const bundledDir = getBundledPluginsDir();
  if (bundledDir) {
    const bundledPath = join(bundledDir, id);
    if (existsSync(bundledPath)) return bundledPath;
  }

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
    if (!plugins.find((p) => p.id === id)) {
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
