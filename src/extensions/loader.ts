/**
 * Extension Loader and Registry
 * 
 * Supports three-tier extension storage:
 * 1. Workspace level (workspace/.extensions/) - highest priority
 * 2. Global level (~/.xopcbot/extensions/) - shared across workspaces
 * 3. Bundled level (xopcbot/extensions/) - shipped with xopcbot
 */

import { existsSync, readFileSync, readdirSync } from 'fs';
import { join, dirname, isAbsolute } from 'path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createJiti } from 'jiti';
import {
  DEFAULT_PATHS,
  getGlobalExtensionsDir,
  getWorkspaceExtensionsDir,
  getBundledExtensionsDir,
  resolveExtensionSdkPath,
} from '../config/paths.js';
import type {
  ExtensionApi,
  ExtensionTool,
  ExtensionModule,
  ChannelExtension,
  GatewayMethodHandler,
  HttpRequestHandler,
  ExtensionCommand,
  ExtensionService,
  ExtensionHookEvent,
  ExtensionHookHandler,
  ExtensionManifest,
  ExtensionRecord,
  ResolvedExtensionConfig,
} from './types/index.js';
import { ExtensionRegistryImpl as ExtensionRegistry } from './loader.js';
import { ExtensionApiImpl, createExtensionLogger, createPathResolver } from './api.js';
import { createLogger, createServiceLogger } from '../utils/logger.js';

const EXTENSION_MANIFEST_FILE = 'xopcbot.extension.json';

const log = createLogger('ExtensionLoader');

// Extension source origin for debugging
export type ExtensionSourceOrigin = 'workspace' | 'global' | 'bundled' | 'config';

interface DiscoveredExtension {
  id: string;
  path: string;
  source: ExtensionSourceOrigin;
  manifest: ExtensionManifest;
}

// ============================================================================
// Extension Registry
// ============================================================================

export class ExtensionRegistryImpl implements ExtensionRegistry {
  extensions = new Map<string, ExtensionRecord>();
  hooks = new Map<ExtensionHookEvent, ExtensionHookHandler[]>();
  channels = new Map<string, ChannelExtension>();
  httpRoutes = new Map<string, HttpRequestHandler>();
  commands = new Map<string, ExtensionCommand>();
  services = new Map<string, ExtensionService>();
  gatewayMethods = new Map<string, GatewayMethodHandler>();
  tools = new Map<string, ExtensionTool>();

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

  addChannel(channel: ChannelExtension): void {
    if (this.channels.has(channel.name)) {
      log.warn({ channel: channel.name }, `Channel already registered, overwriting`);
    }
    this.channels.set(channel.name, channel);
  }

  getChannel(name: string): ChannelExtension | undefined {
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
  addTool(tool: ExtensionTool): void {
    if (this.tools.has(tool.name)) {
      log.warn({ tool: tool.name }, `Tool already registered, overwriting`);
    }
    this.tools.set(tool.name, tool);
  }

  removeTool(name: string): void {
    this.tools.delete(name);
  }

  getTools(): Map<string, ExtensionTool> {
    return this.tools;
  }

  getTool(name: string): ExtensionTool | undefined {
    return this.tools.get(name);
  }

  getAllTools(): ExtensionTool[] {
    return Array.from(this.tools.values());
  }
}

// ============================================================================
// Extension Loader
// ============================================================================

export interface ExtensionLoaderOptions {
  workspaceDir?: string;
  extensionsDir?: string;
  bundledExtensions?: string[];
}

export class ExtensionLoader {
  private registry: ExtensionRegistryImpl;
  private options: ExtensionLoaderOptions;
  private extensionInstances: Map<string, ExtensionApi> = new Map();
  private jiti: ReturnType<typeof createJiti>;

  constructor(options?: ExtensionLoaderOptions) {
    this.registry = new ExtensionRegistryImpl();
    this.options = options || {
      workspaceDir: DEFAULT_PATHS.workspace,
      extensionsDir: DEFAULT_PATHS.extensions,
    };

    // Build jiti alias for extension-sdk
    const alias: Record<string, string> = {};
    const sdkPath = resolveExtensionSdkPath();
    if (sdkPath) {
      alias['xopcbot/extension-sdk'] = sdkPath;
    }

    // Initialize jiti with TypeScript support and SDK alias
    this.jiti = createJiti(fileURLToPath(import.meta.url), {
      interopDefault: true,
      extensions: ['.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.cjs', '.json'],
      alias,
    });
  }

  getRegistry(): ExtensionRegistryImpl {
    return this.registry;
  }

  /**
   * Discover extensions from all three tiers:
   * 1. Workspace (.extensions/) - highest priority
   * 2. Global (~/.xopcbot/extensions/) - shared
   * 3. Bundled (xopcbot/extensions/) - lowest priority
   */
  discoverExtensions(): DiscoveredExtension[] {
    const discovered = new Map<string, DiscoveredExtension>();

    // Priority 3: Bundled extensions (lowest)
    const bundledDir = getBundledExtensionsDir();
    if (bundledDir) {
      this.discoverInDirectory(bundledDir, 'bundled', discovered);
    }

    // Priority 2: Global extensions
    const globalDir = getGlobalExtensionsDir();
    this.discoverInDirectory(globalDir, 'global', discovered);

    // Priority 1: Workspace extensions (highest, can override)
    const workspaceDir = this.options.workspaceDir || DEFAULT_PATHS.workspace;
    const workspaceExtensionsDir = getWorkspaceExtensionsDir(workspaceDir);
    this.discoverInDirectory(workspaceExtensionsDir, 'workspace', discovered);

    return Array.from(discovered.values());
  }

  private discoverInDirectory(
    dir: string,
    source: ExtensionSourceOrigin,
    discovered: Map<string, DiscoveredExtension>,
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
      const extensionPath = join(dir, entry);

      // Check if it's a directory
      try {
        const stat = existsSync(extensionPath);
        if (!stat) continue;
      } catch {
        continue;
      }

      // Try to load manifest
      const manifest = this.loadManifest(extensionPath);
      if (!manifest) continue;

      const extensionId = manifest.id || entry;

      // Higher priority origins can override lower ones
      const existing = discovered.get(extensionId);
      if (existing) {
        const priority = { workspace: 3, global: 2, bundled: 1, config: 0 };
        if (priority[source] <= priority[existing.source]) {
          log.debug(
            { extensionId, from: source, existing: existing.source },
            'Skipping lower priority extension',
          );
          continue;
        }
        log.info(
          { extensionId, from: source, overriding: existing.source },
          'Extension override by higher priority source',
        );
      }

      discovered.set(extensionId, {
        id: extensionId,
        path: extensionPath,
        source,
        manifest,
      });
    }
  }

  /**
   * Load all discovered extensions
   */
  async loadAllExtensions(enabledIds?: string[]): Promise<void> {
    const extensions = this.discoverExtensions();

    for (const extension of extensions) {
      // If enabledIds specified, only load those
      if (enabledIds && !enabledIds.includes(extension.id)) {
        continue;
      }

      const config: ResolvedExtensionConfig = {
        id: extension.id,
        name: extension.manifest.name || extension.id,
        source: extension.source,
        path: extension.path,
        enabled: true,
        config: {},
      };

      await this.loadExtension(config);
    }
  }

  async loadExtensions(configs: ResolvedExtensionConfig[]): Promise<void> {
    for (const extensionConfig of configs) {
      if (extensionConfig.enabled) {
        await this.loadExtension(extensionConfig);
      }
    }
  }

  async loadExtension(config: ResolvedExtensionConfig): Promise<ExtensionApi | null> {
    try {
      // Check if already loaded
      if (this.extensionInstances.has(config.id)) {
        return this.extensionInstances.get(config.id)!;
      }

      // Resolve extension path using resolveExtensionPath
      let extensionPath: string | null;
      if (isAbsolute(config.path)) {
        extensionPath = config.path;
      } else {
        // Try to resolve extension ID to actual path
        extensionPath = resolveExtensionPath(config.path, this.options) ||
                     resolveExtensionPath(config.id, this.options);
      }
      
      if (!extensionPath) {
        log.error({ extensionId: config.id, path: config.path }, `Could not resolve extension path`);
        return null;
      }

      log.debug({ extensionId: config.id, extensionPath }, 'Resolved extension path');

      const manifest = this.loadManifest(extensionPath);
      if (!manifest) {
        log.error({ extensionId: config.id, extensionPath }, `Failed to load manifest for extension`);
        return null;
      }

      // Validate extension config against schema (basic validation)
      if (manifest.configSchema) {
        try {
          const schema = manifest.configSchema as Record<string, unknown>;
          const extensionConfig = config.config as Record<string, unknown>;
          
          // Basic validation: check required fields and types
          if (schema.type === 'object' && schema.properties) {
            const props = schema.properties as Record<string, Record<string, unknown>>;
            const required = (schema.required as string[]) || [];
            
            for (const field of required) {
              if (extensionConfig[field] === undefined) {
                log.error({ 
                  extensionId: config.id, 
                  field 
                }, 'Extension config validation failed: missing required field');
                return null;
              }
            }
            
            for (const [key, value] of Object.entries(extensionConfig)) {
              const propSchema = props[key];
              if (propSchema) {
                if (propSchema.type && !this.validateType(value, propSchema.type as string)) {
                  log.error({ 
                    extensionId: config.id, 
                    field: key,
                    expected: propSchema.type,
                    actual: typeof value
                  }, 'Extension config validation failed: type mismatch');
                  return null;
                }
              }
            }
          }
          
          log.debug({ extensionId: config.id }, 'Extension config validated');
        } catch (err) {
          log.warn({ err, extensionId: config.id }, 'Config schema validation skipped');
        }
      }

      // Create extension API
      const extensionDir = dirname(extensionPath);
      const api = this.createExtensionApi(manifest, config, extensionDir);

      // Load extension module
      const module = await this.loadModule(extensionPath, manifest);
      if (!module) {
        log.error({ extensionId: config.id }, `Failed to load module for extension`);
        return null;
      }

      // Initialize extension
      await this.initializeExtension(module, api, manifest);

      // Register to registry
      this.registry.addExtension({
        id: config.id,
        name: manifest.name,
        version: manifest.version,
        path: extensionPath,
        module,
        config: config.config,
        enabled: true,
        source: config.source,
      });

      this.extensionInstances.set(config.id, api);
      log.info({ name: manifest.name, id: manifest.id, source: config.source }, `Loaded extension`);

      return api;
    } catch (error) {
      log.error({ err: error, extensionId: config.id }, `Error loading extension`);
      return null;
    }
  }

  loadManifest(extensionPath: string): ExtensionManifest | null {
    const manifestPath = join(extensionPath, EXTENSION_MANIFEST_FILE);

    // First try to load xopcbot.extension.json
    if (existsSync(manifestPath)) {
      try {
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
        return manifest as ExtensionManifest;
      } catch (error) {
        log.error({ err: error, manifestPath }, `Failed to parse manifest`);
        return null;
      }
    }

    // Fallback to package.json
    const packagePath = join(extensionPath, 'package.json');
    if (existsSync(packagePath)) {
      try {
        const packageJson = JSON.parse(readFileSync(packagePath, 'utf-8'));
        
        // Check for xopcbot.extension marker
        if (packageJson.xopcbot?.extension) {
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
        
        // Also support xopcbot-extension-* naming convention
        if (packageJson.name?.startsWith('xopcbot-extension-')) {
          const id = packageJson.name.replace('xopcbot-extension-', '');
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
    extensionPath: string,
    manifest: ExtensionManifest,
  ): Promise<ExtensionModule | null> {
    // Determine entry point - .ts files prioritized for development
    const entryPoints = [
      manifest.main,
      'index.ts',
      'index.js',
      'extension.ts',
      'extension.js',
    ].filter(Boolean) as string[];

    for (const entry of entryPoints) {
      const fullPath = isAbsolute(entry) ? entry : join(extensionPath, entry);

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

  private createExtensionApi(
    manifest: ExtensionManifest,
    config: ResolvedExtensionConfig,
    extensionDir: string,
  ): ExtensionApi {
    const logger = createExtensionLogger(`[${manifest.id}]`);
    const resolvePath = createPathResolver(extensionDir, this.options.workspaceDir || '');

    return new ExtensionApiImpl(
      manifest.id,
      manifest.name,
      manifest.version,
      extensionDir,
      config.config as unknown as Record<string, unknown>,
      config.config,
      logger,
      resolvePath,
      this.registry, // Pass registry to sync tools
    );
  }

  private async initializeExtension(
    module: ExtensionModule,
    api: ExtensionApi,
    _manifest: ExtensionManifest,
  ): Promise<void> {
    if (typeof module === 'function') {
      // Module is a function that receives the API
      await module(api);
    } else if (typeof module === 'object' && module.register) {
      // Module is a ExtensionDefinition with register method
      await module.register(api);
    }
  }

  async startServices(): Promise<void> {
    const services = Array.from(this.registry.services.values());

    for (const service of services) {
      const serviceLog = createServiceLogger(service.id);
      try {
        await service.start?.();
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
          await service.stop();
          serviceLog.info(`Stopped service`);
        } catch (error) {
          serviceLog.error({ err: error }, `Failed to stop service`);
        }
      }
    }
  }

  /**
   * Basic type validation for config values
   */
  private validateType(value: unknown, expectedType: string): boolean {
    if (expectedType === 'string') return typeof value === 'string';
    if (expectedType === 'number' || expectedType === 'integer') return typeof value === 'number';
    if (expectedType === 'boolean') return typeof value === 'boolean';
    if (expectedType === 'array') return Array.isArray(value);
    if (expectedType === 'object') return typeof value === 'object' && value !== null && !Array.isArray(value);
    return true;
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

export function resolveExtensionPath(id: string, options: ExtensionLoaderOptions): string | null {
  // Priority 1: Workspace
  const workspaceDir = options.workspaceDir || DEFAULT_PATHS.workspace;
  const workspacePath = join(getWorkspaceExtensionsDir(workspaceDir), id);
  if (existsSync(workspacePath)) return workspacePath;

  // Priority 2: Global
  const globalPath = join(getGlobalExtensionsDir(), id);
  if (existsSync(globalPath)) return globalPath;

  // Priority 3: Bundled
  const bundledDir = getBundledExtensionsDir();
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

export function normalizeExtensionConfig(
  rawConfig: Record<string, unknown>,
): ResolvedExtensionConfig[] {
  const extensions: ResolvedExtensionConfig[] = [];

  const enabled = (rawConfig.enabled as string[]) || [];
  const disabled = (rawConfig.disabled as string[]) || [];

  // Parse enabled extensions
  for (const id of enabled) {
    const config = (rawConfig[id] as Record<string, unknown>) || {};
    extensions.push({
      id,
      name: id,
      source: 'config',
      path: id,
      enabled: true,
      config,
    });
  }

  // Parse disabled extensions
  for (const id of disabled) {
    if (!extensions.find((p) => p.id === id)) {
      const config = (rawConfig[id] as Record<string, unknown>) || {};
      extensions.push({
        id,
        name: id,
        source: 'config',
        path: id,
        enabled: false,
        config,
      });
    }
  }

  return extensions;
}
