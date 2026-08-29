/**
 * Extension Loader and Registry
 * 
 * Supports three-tier extension storage:
 * 1. Workspace level (workspace/.extensions/) - highest priority
 * 2. Global level (~/.xopc/extensions/) - shared across workspaces
 * 3. Bundled level (xopc/extensions/) - shipped with xopc
 */

import { existsSync, readFileSync } from 'fs';
import { join, dirname, isAbsolute } from 'path';
import { fileURLToPath, pathToFileURL } from 'node:url';
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
  ExtensionManifest,
  ResolvedExtensionConfig,
  DiscoveredExtension,
} from './types/index.js';
import type { ActivationContext } from './activation-planner.js';
import { ActivationPlanner, type ActivationLoadPhase } from './activation-planner.js';
import { mergeActivationContext } from './activation-context.js';
import {
  areExtensionsGloballyDisabled,
  discoverExtensionsFromDisk,
  type DiscoverConfig,
  type ExtensionLoaderOptions,
} from './discover-extensions.js';
import type { ExtensionMetadataSnapshot } from './extension-metadata-snapshot.js';
import { ManifestRegistry } from './manifest-registry.js';
import { normalizeExtensionManifest } from './normalize-manifest.js';
import { checkEngineCompatibility } from './engine-check.js';
import { PACKAGE_VERSION } from '../package-version.js';
import { ExtensionApiImpl, createExtensionLogger, createPathResolver } from './api.js';
import { validateSpeechProviderContracts } from './speech-provider-contracts.js';
import { validateMediaUnderstandingProviderContracts } from './media-provider-contracts.js';
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

const DEFAULT_EXTENSION_LOAD_CONCURRENCY = 4;

async function mapWithConcurrency<T>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  if (items.length === 0) {
    return;
  }
  const queue = [...items];
  const workerCount = Math.min(Math.max(1, concurrency), queue.length);
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (queue.length > 0) {
        const item = queue.shift();
        if (item === undefined) {
          break;
        }
        await fn(item);
      }
    }),
  );
}

export type { ExtensionLoaderOptions, ExtensionSourceOrigin } from './discover-extensions.js';
export { areExtensionsGloballyDisabled } from './discover-extensions.js';

// ============================================================================
// Extension Registry
// ============================================================================

// `ExtensionRegistryImpl` moved to `./extension-registry-impl.ts` so `api.ts`
// can use the class without going through loader.ts (which imports back from
// api.ts and formed a circular cycle). Re-exported here for backward-compat.
export { ExtensionRegistryImpl } from './extension-registry-impl.js';
import { ExtensionRegistryImpl } from './extension-registry-impl.js';

// ============================================================================
// Extension Loader
// ============================================================================

export interface ActivationPlanLoadOptions extends Partial<ActivationContext> {
  phase?: ActivationLoadPhase | 'all';
}

export class ExtensionLoader {
  private registry: ExtensionRegistryImpl;
  private options: ExtensionLoaderOptions;
  private extensionInstances: Map<string, ExtensionApi> = new Map();
  private jiti: ReturnType<typeof createJiti>;
  private _appConfig?: Config;
  private _runtimeContext?: {
    bus?: MessageBus;
    sessionManager?: SessionIndex;
    scheduleWebchatContinuation?: (sessionKey: string, message: string) => void;
    setLabel?: (entryId: string, label: string | undefined) => void;
    sendUserMessage?: import('./types/index.js').ExtensionRuntime['sendUserMessage'];
    appendEntry?: import('./types/index.js').ExtensionRuntime['appendEntry'];
    sendMessage?: import('./types/index.js').ExtensionRuntime['sendMessage'];
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
  private manifestSnapshot: ExtensionMetadataSnapshot | null = null;

  constructor(options?: ExtensionLoaderOptions) {
    this.registry = new ExtensionRegistryImpl();
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

    // Build jiti aliases for the public, host-provided extension SDK contract.
    // Extensions must import from @xopcai/xopc/extension-sdk; private aliases
    // are intentionally not registered.
    const alias: Record<string, string> = {};
    const sdkPath = resolveExtensionSdkPath();
    if (sdkPath) {
      const sdkDir = dirname(sdkPath);
      const sdkSubpaths = [
        'core',
        'lazy',
        'provider',
        'channel',
        'hooks',
        'tools',
        'testing',
        'speech',
        'media',
      ];
      const prefix = '@xopcai/xopc/extension-sdk';
      alias[prefix] = sdkPath;
      for (const subpath of sdkSubpaths) {
        alias[`${prefix}/${subpath}`] = join(sdkDir, `${subpath}.ts`);
      }
    }

    // Initialize jiti with TypeScript support and SDK alias
    this.jiti = createJiti(fileURLToPath(import.meta.url), {
      interopDefault: true,
      extensions: ['.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.cjs', '.json'],
      alias,
    });
  }

  /**
   * Reuse a pre-built metadata snapshot (avoids duplicate filesystem discovery).
   */
  setManifestSnapshot(snapshot: ExtensionMetadataSnapshot | null): void {
    this.manifestSnapshot = snapshot;
    this.manifestRegistry = snapshot?.manifestRegistry ?? null;
  }

  getManifestSnapshot(): ExtensionMetadataSnapshot | null {
    return this.manifestSnapshot;
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
    bus?: MessageBus;
    sessionManager?: SessionIndex;
    scheduleWebchatContinuation?: (sessionKey: string, message: string) => void;
    setLabel?: (entryId: string, label: string | undefined) => void;
    sendUserMessage?: import('./types/index.js').ExtensionRuntime['sendUserMessage'];
    appendEntry?: import('./types/index.js').ExtensionRuntime['appendEntry'];
    sendMessage?: import('./types/index.js').ExtensionRuntime['sendMessage'];
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
   * Build the manifest registry from filesystem manifests without loading extension code.
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
   * Plan activation from manifest metadata with pure logic.
   */
  planActivation(_context?: Partial<ActivationContext>): ActivationPlanner {
    return new ActivationPlanner(this.buildManifestRegistry());
  }

  /**
   * Load only extensions selected by the activation plan.
   */
  async loadByActivationPlan(context?: ActivationPlanLoadOptions): Promise<void> {
    if (areExtensionsGloballyDisabled(this._appConfig as DiscoverConfig | undefined)) {
      log.debug('Extension loading skipped (extensions globally disabled)');
      return;
    }

    const registry = this.buildManifestRegistry();
    const planner = new ActivationPlanner(registry);
    const fullContext = mergeActivationContext(this._appConfig, context);
    let activatedIds = planner.getActivatedIds(fullContext).sort((a, b) => a.localeCompare(b));

    const phase = context?.phase ?? 'all';
    if (phase === 'startup' || phase === 'deferred') {
      activatedIds = planner.filterActivatedIdsByLoadPhase(activatedIds, phase);
    }

    const concurrency = Number.parseInt(
      process.env.XOPC_EXTENSION_LOAD_CONCURRENCY ?? '',
      10,
    );
    const loadConcurrency = Number.isFinite(concurrency) && concurrency > 0
      ? concurrency
      : DEFAULT_EXTENSION_LOAD_CONCURRENCY;

    await mapWithConcurrency(activatedIds, loadConcurrency, async (extensionId) => {
      if (this.extensionInstances.has(extensionId)) {
        return;
      }
      const entry = registry.getEntry(extensionId);
      if (!entry) {
        log.debug(
          { extensionId },
          'Activation plan references extension id that was not discovered on disk',
        );
        return;
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
    });
  }

  getManifestRegistry(): ManifestRegistry {
    return this.buildManifestRegistry();
  }

  invalidateManifestCache(): void {
    this.manifestSnapshot = null;
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
    if (this.manifestSnapshot) {
      return this.manifestSnapshot.discovered;
    }
    return discoverExtensionsFromDisk(this.options, this._appConfig as DiscoverConfig | undefined);
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

      if (this.securityConfig.checkPermissions && !safetyResult.safe) {
        logSecurityIssue(config.id, safetyResult);
        this.diagnostics.error(config.id, `Unsafe extension path: ${safetyResult.detail}`);
        log.error(
          { extensionId: config.id, reason: safetyResult.reason },
          'Extension blocked because its path is unsafe',
        );
        return null;
      }

      // Filesystem safety and publisher trust are independent boundaries. A safely-owned
      // directory must not bypass allowUntrusted=false for non-bundled code.
      if (source !== 'bundled' && !isExtensionAllowed(config.id, this.securityConfig)) {
        this.diagnostics.error(config.id, 'Extension is not present in extensions.security.allow');
        log.error(
          { extensionId: config.id, source },
          'Extension blocked because it is not trusted by security policy',
        );
        return null;
      }

      // Trust checks must run before both local and shared cache hits so a policy change cannot
      // keep previously-loaded third-party code authorized.
      const cacheKey = this.cache.buildKey(this.options, [config.id]);
      const cached = this.cache.get<ExtensionApi>(cacheKey);
      if (cached) {
        log.debug({ extensionId: config.id }, 'Extension loaded from cache');
        return cached;
      }

      if (this.extensionInstances.has(config.id)) {
        return this.extensionInstances.get(config.id)!;
      }

      // Track provenance 
      provenanceTracker.track(config.id, source);

      const manifest = this.loadManifest(extensionPath);
      if (!manifest) {
        log.error({ extensionId: config.id, extensionPath }, `Failed to load manifest for extension`);
        this.diagnostics.error(config.id, `Failed to load manifest`);
        return null;
      }

      if (!manifest.main || !/\.(js|mjs|cjs)$/i.test(manifest.main)) {
        const reason = `Extension manifest main must point at built JavaScript (.js/.mjs/.cjs): ${manifest.main ?? '(missing)'}`;
        log.warn({ extensionId: config.id, main: manifest.main }, reason);
        this.diagnostics.error(config.id, reason);
        return null;
      }

      if (!manifest.engines?.xopc) {
        const reason = 'Extension manifest must declare engines.xopc';
        log.warn({ extensionId: config.id }, reason);
        this.diagnostics.error(config.id, reason);
        return null;
      }
      const range = manifest.engines.xopc;
      const engineResult = checkEngineCompatibility(PACKAGE_VERSION, range);
      if (engineResult.parseWarning) {
        const reason = engineResult.reason ?? `Could not parse engines.xopc: ${range}`;
        log.warn({ extensionId: config.id, range, reason }, 'Extension engine range parse failure — skipping load');
        this.diagnostics.error(config.id, reason);
        return null;
      }
      if (!engineResult.compatible) {
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

      validateSpeechProviderContracts({
        extensionId: config.id,
        manifest,
        registeredProviderIds: (api as ExtensionApiImpl).getRegisteredSpeechProviderIds(),
        logger: api.logger,
      });

      validateMediaUnderstandingProviderContracts({
        extensionId: config.id,
        manifest,
        registeredProviderIds: (api as ExtensionApiImpl).getRegisteredMediaUnderstandingProviderIds(),
        logger: api.logger,
      });

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
        this.registry.addTool(tool, config.id);
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
      'speech-provider': 'tts',
      'web-search': 'webSearch',
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

    return null;
  }

  private moduleEntryCandidates(manifest: ExtensionManifest): string[] {
    if (!manifest.main) return [];
    return [manifest.main];
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
          if (!/\.(js|mjs|cjs)$/.test(fullPath)) {
            throw new Error(`Extension runtime entry must be built JavaScript: ${entry}`);
          }
          const mod = await import(pathToFileURL(fullPath).href);
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
            setLabel: this._runtimeContext.setLabel,
            sendUserMessage: this._runtimeContext.sendUserMessage,
            appendEntry: this._runtimeContext.appendEntry,
            sendMessage: this._runtimeContext.sendMessage,
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
      manifest.contracts ?? {},
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

  return null;
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
