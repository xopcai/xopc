/**
 * xopc Extension System
 * 
 * @module extensions
 */

// Core Types
export * from './types/index.js';

// Extension API
export { ExtensionApiImpl, createExtensionLogger, createPathResolver } from './api.js';

// Extension Loader and Registry
export { ExtensionRegistryImpl, ExtensionLoader, normalizeExtensionConfig, resolveExtensionPath, areExtensionsGloballyDisabled } from './loader.js';
export type { ActivationPlanLoadOptions } from './loader.js';
export type { ExtensionRegistry } from './types/core.js';

// Manifest-first control plane
export { ManifestRegistry, type ManifestRegistryEntry } from './manifest-registry.js';
export {
  ActivationPlanner,
  type ActivationContext,
  type ActivationDecision,
  type ActivationReason,
  type ActivationLoadPhase,
} from './activation-planner.js';
export {
  mergeActivationContext,
  collectConfiguredChannelIds,
  collectConfiguredProviderIds,
} from './activation-context.js';
export {
  listOnboardProviders,
  listOnboardChannels,
  resolveProviderForModel,
  type OnboardProviderInfo,
  type OnboardChannelInfo,
} from './onboard-helpers.js';
export { normalizeExtensionManifest } from './normalize-manifest.js';
export {
  buildExtensionMetadataSnapshot,
  resolveExtensionLoaderOptionsFromConfig,
  type ExtensionMetadataSnapshot,
} from './extension-metadata-snapshot.js';
export {
  discoverExtensionsFromDisk,
  type ExtensionLoaderOptions,
  type ExtensionSourceOrigin,
} from './discover-extensions.js';

// Hook System
export { ExtensionHookRunner, createHookContext, isHookEvent } from './hooks.js';
