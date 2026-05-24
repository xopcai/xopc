/**
 * Extension Loader and Registry
 * 
 * Supports three-tier extension storage:
 * 1. Workspace level (workspace/.extensions/) - highest priority
 * 2. Global level (~/.xopc/extensions/) - shared across workspaces
 * 3. Bundled level (xopc/extensions/) - shipped with xopc
 */

import { existsSync, readFileSync, readdirSync } from 'fs';
import { join, dirname, isAbsolute } from 'path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createJiti } from 'jiti';
import { resolveDefaultAgentId } from '../agent/agent-scope.js';
import { loadConfig } from '../config/loader.js';
import {
  resolveAgentWorkspaceDir,
  resolveExtensionsDir,
  resolveWorkspaceExtensionsDir,
  resolveBundledExtensionsDir,
  resolveExtensionSdkPath,
} from '../config/paths.js';
import type { Config } from '../config/config-surface.js';
import type { MessageBus } from '../infra/bus/index.js';
import type { SessionIndex } from '../session/manager.js';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import type {
  ExtensionApi,
  ExtensionModule,
  ExtensionRegistry,
  ExtensionCliRegistration,
  GatewayMethodHandler,
  HttpRequestHandler,
  ExtensionCommand,
  ExtensionReloadRegistration,
  ExtensionService,
  ExtensionHookEvent,
  ExtensionHookHandler,
  ExtensionManifest,
  ExtensionRecord,
  ResolvedExtensionConfig,
  DiscoveredExtension,
  TuiExtensionRegistration,
  TuiExtensionRegistrar,
} from './types/index.js';
import type { ActivationContext } from './activation-planner.js';
import { ActivationPlanner } from './activation-planner.js';
import { mergeActivationContext } from './activation-context.js';
import { ManifestRegistry } from './manifest-registry.js';
import { normalizeExtensionManifest } from './normalize-manifest.js';
import { checkEngineCompatibility } from './engine-check.js';
import { PACKAGE_VERSION } from '../package-version.js';
import type { ChannelPlugin } from '../channels/plugin-types.js';
import { bundledChannelPlugins } from '../channels/plugins/bundled.js';
import { ExtensionApiImpl, createExtensionLogger, createPathResolver } from './api.js';
import { createLogger, createServiceLogger } from '../utils/logger.js';

//  Security imports
import {
  checkExtensionPathSafety,
  isExtensionAllowed,
  provenanceTracker,
  logSecurityIssue,
  DEFAULT_SECURITY_CONFIG,
  type SecurityConfig,
  // Note: ExtensionSourceOrigin is defined locally in this file
} from './security.js';

//  Provider imports
import { getProviderRegistry, type ProviderPluginRegistry } from '../providers/plugin-registry.js';

//  Slot imports
import {
  getSlotRegistry,
  type SlotRegistry,
  type SlotKey,
} from './slots.js';

//  Diagnostics imports
import {
  getExtensionCache,
  getExtensionDiagnostics,
  type ExtensionLoaderCache,
  type ExtensionDiagnostics,
} from './diagnostics.js';

const EXTENSION_MANIFEST_FILE = 'xopc.extension.json';

const log = createLogger('ExtensionLoader');

// Extension source origin for debugging
export type ExtensionSourceOrigin = 'workspace' | 'global' | 'bundled' | 'config';

// ============================================================================
// Extension Registry
// ============================================================================

export class ExtensionRegistryImpl implements ExtensionRegistry {
  extensions = new Map<string, ExtensionRecord>();
  hooks = new Map<ExtensionHookEvent, ExtensionHookHandler[]>();
  httpRoutes = new Map<string, HttpRequestHandler>();
  commands = new Map<string, ExtensionCommand>();
  services = new Map<string, ExtensionService>();
  gatewayMethods = new Map<string, GatewayMethodHandler>();
  tools: Map<string, AgentTool<any, any>> = new Map();
  channelPlugins: ChannelPlugin[] = [];
  private cliRegistrations: ExtensionCliRegistration[] = [];
  private reloadRegistrations: ExtensionReloadRegistration[] = [];
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
  addTool(tool: any): void {
    if (this.tools.has(tool.name)) {
      log.warn({ tool: tool.name }, `Tool already registered, overwriting`);
    }
    this.tools.set(tool.name, tool);
  }

  removeTool(name: string): void {
    this.tools.delete(name);
  }

  getTools(): Map<string, any> {
    return this.tools;
  }

  getTool(name: string): any | undefined {
    return this.tools.get(name);
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
  private _appConfig?: Config;
  private _runtimeContext?: {
    bus: MessageBus;
    sessionManager?: SessionIndex;
    scheduleWebchatContinuation?: (sessionKey: string, message: string) => void;
  };
  
  //  Security
  private securityConfig: SecurityConfig;
  
  //  Provider Registry
  private providerRegistry: ProviderPluginRegistry;
  
  //  Slot Registry & Config
  private slotRegistry: SlotRegistry;
  private slotsConfig: Partial<Record<SlotKey, string>> = {};
  
  //  Cache and Diagnostics
  private cache: ExtensionLoaderCache;
  private diagnostics: ExtensionDiagnostics;

  /** Manifest-only registry cache (no runtime module load). */
  private manifestRegistry: ManifestRegistry | null = null;

  constructor(options?: ExtensionLoaderOptions) {
    this.registry = new ExtensionRegistryImpl();
    for (const p of bundledChannelPlugins) {
      this.registry.addChannelPlugin(p);
    }
    this.options = options || (() => {
      const c = loadConfig();
      const aid = resolveDefaultAgentId(c);
      return {
        workspaceDir: resolveAgentWorkspaceDir(c, aid),
        extensionsDir: resolveWorkspaceExtensionsDir(c, aid),
      };
    })();

    // Initialize security config
    this.securityConfig = DEFAULT_SECURITY_CONFIG;
    
    // Initialize provider registry
    this.providerRegistry = getProviderRegistry();
    
    // Initialize slot registry
    this.slotRegistry = getSlotRegistry();
    
    // Initialize cache and diagnostics 
    this.cache = getExtensionCache();
    this.diagnostics = getExtensionDiagnostics();

    // Build jiti alias for extension-sdk (+ subpath entry points)
    const alias: Record<string, string> = {};
    const sdkPath = resolveExtensionSdkPath();
    if (sdkPath) {
      alias['xopc/extension-sdk'] = sdkPath;
      const sdkDir = dirname(sdkPath);
      alias['xopc/extension-sdk/core'] = join(sdkDir, 'core.ts');
      alias['xopc/extension-sdk/lazy'] = join(sdkDir, 'lazy.ts');
      alias['xopc/extension-sdk/provider'] = join(sdkDir, 'provider.ts');
      alias['xopc/extension-sdk/channel'] = join(sdkDir, 'channel.ts');
      alias['xopc/extension-sdk/hooks'] = join(sdkDir, 'hooks.ts');
      alias['xopc/extension-sdk/tools'] = join(sdkDir, 'tools.ts');
      alias['xopc/extension-sdk/testing'] = join(sdkDir, 'testing.ts');
    }

    // Initialize jiti with TypeScript support and SDK alias
    this.jiti = createJiti(fileURLToPath(import.meta.url), {
      interopDefault: true,
      extensions: ['.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.cjs', '.json'],
      alias,
    });
  }

  /**
   * Set security configuration 
   */
  setSecurityConfig(config: Partial<SecurityConfig>): void {
    this.securityConfig = { ...this.securityConfig, ...config };
  }

  /**
   * Get security configuration 
   */
  getSecurityConfig(): SecurityConfig {
    return this.securityConfig;
  }

  /**
   * Get provider registry 
   */
  getProviderRegistry(): ProviderPluginRegistry {
    return this.providerRegistry;
  }

  /**
   * Get slot registry 
   */
  getSlotRegistry(): SlotRegistry {
    return this.slotRegistry;
  }

  /**
   * Get diagnostics 
   */
  getDiagnostics(): ExtensionDiagnostics {
    return this.diagnostics;
  }

  /**
   * Set configuration from main Config object 
   */
  setConfig(config: Config): void {
    this._appConfig = config;
    // Wire slot config
    const slots = (config.extensions as any)?.slots || {};
    this.slotsConfig = {
      memory: slots.memory,
      tts: slots.tts,
      imageGeneration: slots.imageGeneration,
      webSearch: slots.webSearch,
    };

    // Wire security config
    const security = (config.extensions as any)?.security;
    if (security) {
      this.securityConfig = {
        checkPermissions: security.checkPermissions ?? true,
        allowUntrusted: security.allowUntrusted ?? false,
        allow: security.allow ?? [],
        trackProvenance: security.trackProvenance ?? true,
        allowPromptInjection: security.allowPromptInjection ?? false,
      };
    }
  }

  /**
   * Inject MessageBus and optional SessionManager for ExtensionApi.runtime (Gateway).
   */
  setRuntimeContext(ctx: {
    bus: MessageBus;
    sessionManager?: SessionIndex;
    scheduleWebchatContinuation?: (sessionKey: string, message: string) => void;
  }): void {
    this._runtimeContext = ctx;
    // ExtensionApi snapshots `runtime` at construction and is tied to this loader's registry.
    // CLI startup loads extensions with `{ bus }` first; a global cache hit would reuse that
    // api for the gateway loader (no sessionManager, wrong registry) — breaks extensions that need SessionManager.
    this.cache.invalidate();
  }

  getRegistry(): ExtensionRegistryImpl {
    return this.registry;
  }

  /**
   * Phase 1: build manifest registry (filesystem manifests only, no extension code load).
   */
  buildManifestRegistry(): ManifestRegistry {
    if (this.manifestRegistry) {
      return this.manifestRegistry;
    }
    const discovered = this.discoverExtensions();
    this.manifestRegistry = ManifestRegistry.fromDiscovered(discovered);
    return this.manifestRegistry;
  }

  /**
   * Phase 2: activation planner over the manifest registry (pure logic).
   */
  planActivation(_context?: Partial<ActivationContext>): ActivationPlanner {
    return new ActivationPlanner(this.buildManifestRegistry());
  }

  /**
   * Phase 3: load only extensions selected by the activation plan.
   */
  async loadByActivationPlan(context?: Partial<ActivationContext>): Promise<void> {
    const registry = this.buildManifestRegistry();
    const planner = new ActivationPlanner(registry);
    const fullContext = mergeActivationContext(this._appConfig, context);
    const activatedIds = planner.getActivatedIds(fullContext).sort((a, b) => a.localeCompare(b));

    for (const extensionId of activatedIds) {
      if (this.extensionInstances.has(extensionId)) continue;
      const entry = registry.getEntry(extensionId);
      if (!entry) {
        log.debug(
          { extensionId },
          'Activation plan references extension id that was not discovered on disk',
        );
        continue;
      }

      const config: ResolvedExtensionConfig = {
        id: extensionId,
        name: entry.manifest.name || extensionId,
        source: entry.source,
        path: entry.path,
        enabled: true,
        config: this.resolveExtensionConfig(extensionId),
      };

      await this.loadExtension(config);
    }
  }

  getManifestRegistry(): ManifestRegistry {
    return this.buildManifestRegistry();
  }

  invalidateManifestCache(): void {
    this.manifestRegistry = null;
  }

  private resolveExtensionConfig(extensionId: string): Record<string, unknown> {
    if (!this._appConfig) return {};
    const extensionsConfig = (this._appConfig as Record<string, unknown>).extensions as
      | Record<string, unknown>
      | undefined;
    if (!extensionsConfig || typeof extensionsConfig !== 'object') return {};
    const raw = extensionsConfig[extensionId];
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      return raw as Record<string, unknown>;
    }
    return {};
  }

  /**
   * Discover extensions from all three tiers:
   * 1. Workspace (.extensions/) - highest priority
   * 2. Global (~/.xopc/extensions/) - shared
   * 3. Bundled (xopc/extensions/) - lowest priority
   */
  discoverExtensions(): DiscoveredExtension[] {
    const discovered = new Map<string, DiscoveredExtension>();

    // Priority 3: Bundled extensions (lowest)
    const bundledDir = resolveBundledExtensionsDir();
    if (bundledDir) {
      this.discoverInDirectory(bundledDir, 'bundled', discovered);
    }

    // Priority 2: Global extensions
    const globalDir = resolveExtensionsDir();
    this.discoverInDirectory(globalDir, 'global', discovered);

    // Priority 1: Workspace extensions (highest, can override)
    const c = loadConfig();
    const aid = resolveDefaultAgentId(c);
    const workspaceExtensionsDir = resolveWorkspaceExtensionsDir(c, aid);
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
      //  Check cache first
      const cacheKey = this.cache.buildKey(this.options, [config.id]);
      const cached = this.cache.get<ExtensionApi>(cacheKey);
      if (cached) {
        log.debug({ extensionId: config.id }, 'Extension loaded from cache');
        return cached;
      }

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
        this.diagnostics.error(config.id, `Could not resolve extension path: ${config.path}`);
        return null;
      }

      log.debug({ extensionId: config.id, extensionPath }, 'Resolved extension path');

      //  Security check
      const source = config.source || 'bundled';
      const safetyResult = checkExtensionPathSafety(extensionPath, extensionPath, source);
      
      if (!safetyResult.safe) {
        logSecurityIssue(config.id, safetyResult);
        
        if (this.securityConfig.checkPermissions && source !== 'bundled') {
          // Check allowlist
          if (!isExtensionAllowed(config.id, this.securityConfig)) {
            this.diagnostics.error(config.id, `Extension not allowed: ${safetyResult.detail}`);
            log.error({ extensionId: config.id, reason: safetyResult.reason }, 'Extension blocked by security policy');
            return null;
          }
        }
      }

      // Track provenance 
      provenanceTracker.track(config.id, source);

      const manifest = this.loadManifest(extensionPath);
      if (!manifest) {
        log.error({ extensionId: config.id, extensionPath }, `Failed to load manifest for extension`);
        this.diagnostics.error(config.id, `Failed to load manifest`);
        return null;
      }

      if (manifest.engines?.xopc) {
        const range = manifest.engines.xopc;
        const engineResult = checkEngineCompatibility(PACKAGE_VERSION, range);
        if (engineResult.parseWarning) {
          log.warn(
            { extensionId: config.id, range, reason: engineResult.reason },
            'Engine range parse warning — loading anyway',
          );
        } else if (!engineResult.compatible) {
          log.warn(
            { extensionId: config.id, range, currentVersion: PACKAGE_VERSION },
            'Extension engine requirement not met (engines.xopc) — skipping load',
          );
          this.diagnostics.error(
            config.id,
            engineResult.reason ?? 'Incompatible xopc version (engines.xopc)',
          );
          return null;
        }
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
        this.diagnostics.error(config.id, `Failed to load module`);
        return null;
      }

      //  Check and claim slots
      const slotClaimed = this.claimExtensionSlots(config.id, manifest);
      if (!slotClaimed) {
        log.warn({ extensionId: config.id }, 'Failed to claim required slots');
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

      // Register extension tools to registry (so AgentManager can access them)
      // Note: api is actually ExtensionApiImpl at runtime
      const apiImpl = api as unknown as { _getTools: () => Map<string, AgentTool> };
      const extensionTools = apiImpl._getTools();
      for (const tool of extensionTools.values()) {
        this.registry.addTool(tool);
      }

      this.extensionInstances.set(config.id, api);
      
      //  Cache the loaded extension
      this.cache.set(cacheKey, api);

      this.diagnostics.info(config.id, `Loaded extension: ${manifest.name}`);
      log.info({ name: manifest.name, id: manifest.id, source: config.source }, `Loaded extension`);

      return api;
    } catch (error) {
      log.error({ err: error, extensionId: config.id }, `Error loading extension`);
      this.diagnostics.error(config.id, `Error loading extension: ${error}`);
      return null;
    }
  }

  /**
   *  Claim extension slots based on manifest kind
   * Respects configured preferred plugin from config.extensions.slots
   */
  private claimExtensionSlots(extensionId: string, manifest: ExtensionManifest): boolean {
    const kind = manifest.kind as string;
    
    // Map extension kind to slot
    const slotMap: Record<string, SlotKey> = {
      'memory': 'memory',
      'tts': 'tts',
      'image-generation': 'imageGeneration',
      'imageGeneration': 'imageGeneration',
      'web-search': 'webSearch',
      'webSearch': 'webSearch',
    };
    
    const slotKey = slotMap[kind];
    if (!slotKey) {
      return true; // No slot required
    }
    
    // Check if slot is reserved for a different plugin in config
    const preferredPlugin = this.slotsConfig[slotKey];
    if (preferredPlugin && preferredPlugin !== extensionId) {
      log.info(
        { extensionId, slotKey, preferredPlugin },
        `Skipping slot claim: slot "${slotKey}" is reserved for "${preferredPlugin}"`
      );
      this.diagnostics.info(
        extensionId,
        `Slot "${slotKey}" is reserved for "${preferredPlugin}", skipping claim`
      );
      return false;
    }
    
    const claimed = this.slotRegistry.claim(slotKey, extensionId, null);
    if (!claimed) {
      this.diagnostics.warn(extensionId, `Slot "${slotKey}" already claimed by another extension`);
    }
    return claimed;
  }

  loadManifest(extensionPath: string): ExtensionManifest | null {
    const manifestPath = join(extensionPath, EXTENSION_MANIFEST_FILE);

    // First try to load xopc.extension.json
    if (existsSync(manifestPath)) {
      try {
        const raw = JSON.parse(readFileSync(manifestPath, 'utf-8'));
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
          log.error({ manifestPath }, 'Manifest root must be a JSON object');
          return null;
        }
        return normalizeExtensionManifest(raw as Record<string, unknown>);
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
        
        // Check for xopc.extension marker
        if (packageJson.xopc?.extension) {
          const xopcConfig = packageJson.xopc;
          return normalizeExtensionManifest({
            id: xopcConfig.id || packageJson.name,
            name: xopcConfig.name || packageJson.name,
            description: xopcConfig.description || packageJson.description,
            version: xopcConfig.version || packageJson.version || '1.0.0',
            kind: xopcConfig.kind || 'utility',
            main: xopcConfig.main || packageJson.main || 'index.js',
            configSchema: xopcConfig.configSchema,
          });
        }

        // Also support xopc-extension-* naming convention
        if (packageJson.name?.startsWith('xopc-extension-')) {
          const id = packageJson.name.replace('xopc-extension-', '');
          return normalizeExtensionManifest({
            id,
            name: packageJson.name,
            description: packageJson.description,
            version: packageJson.version || '1.0.0',
            kind: 'utility',
            main: packageJson.main || 'index.js',
          });
        }
      } catch (error) {
        log.error({ err: error, packagePath }, `Failed to parse package.json`);
      }
    }

    return null;
  }

  /**
   * Build candidate extension entry paths. After `tsdown`, manifests may still
   * point at `*.ts` while the shipped tree only contains the emitted `*.js`.
   */
  private moduleEntryCandidates(manifest: ExtensionManifest): string[] {
    const raw = [
      manifest.main,
      'index.ts',
      'index.js',
      'extension.ts',
      'extension.js',
    ].filter(Boolean) as string[];

    const out: string[] = [];
    for (const entry of raw) {
      out.push(entry);
      if (entry.endsWith('.tsx')) {
        out.push(`${entry.slice(0, -4)}.js`);
      } else if (entry.endsWith('.ts')) {
        out.push(`${entry.slice(0, -3)}.js`);
      } else if (entry.endsWith('.mts')) {
        out.push(`${entry.slice(0, -4)}.mjs`);
      } else if (entry.endsWith('.cts')) {
        out.push(`${entry.slice(0, -4)}.cjs`);
      }
    }
    return [...new Set(out)];
  }

  private async loadModule(
    extensionPath: string,
    manifest: ExtensionManifest,
  ): Promise<ExtensionModule | null> {
    const entryPoints = this.moduleEntryCandidates(manifest);

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
    resolved: ResolvedExtensionConfig,
    extensionDir: string,
  ): ExtensionApi {
    const logger = createExtensionLogger(`[${manifest.id}]`);
    const resolvePath = createPathResolver(extensionDir, this.options.workspaceDir || '');

    const appConfig = this._appConfig ?? ({} as Config);
    const extensionOnly = (resolved.config ?? {}) as Record<string, unknown>;

    const runtime =
      this._appConfig && this._runtimeContext
        ? {
            config: this._appConfig,
            bus: this._runtimeContext.bus,
            log: logger,
            sessionManager: this._runtimeContext.sessionManager,
            scheduleWebchatContinuation: this._runtimeContext.scheduleWebchatContinuation,
          }
        : this._appConfig
          ? {
              config: this._appConfig,
              log: logger,
            }
          : undefined;

    const api = new ExtensionApiImpl(
      manifest.id,
      manifest.name,
      manifest.version,
      extensionDir,
      appConfig,
      extensionOnly,
      logger,
      resolvePath,
      this.registry,
      runtime,
    );
    if (manifest.reload?.configPrefixes?.length) {
      api._setReloadConfigPrefixes(manifest.reload.configPrefixes);
    }
    const manifestCommands = manifest.ui?.contributions?.commands;
    if (manifestCommands?.length) {
      (api as ExtensionApiImpl)._setManifestCommands(manifestCommands);
    }
    return api;
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

export function resolveExtensionPath(id: string, _options: ExtensionLoaderOptions): string | null {
  const c = loadConfig();
  const aid = resolveDefaultAgentId(c);
  // Priority 1: Workspace
  const workspacePath = join(resolveWorkspaceExtensionsDir(c, aid), id);
  if (existsSync(workspacePath)) return workspacePath;

  // Priority 2: Global
  const globalPath = join(resolveExtensionsDir(), id);
  if (existsSync(globalPath)) return globalPath;

  // Priority 3: Bundled
  const bundledDir = resolveBundledExtensionsDir();
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
