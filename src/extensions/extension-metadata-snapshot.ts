/**
 * One-shot extension manifest discovery for config load + gateway bootstrap reuse.
 */

import { resolveDefaultAgentId } from '../agent/agent-scope.js';
import type { Config } from '../config/schema.js';
import {
  resolveAgentWorkspaceDir,
  resolveExtensionsDir,
  resolveWorkspaceExtensionsDir,
} from '../config/paths.js';
import {
  discoverExtensionsFromDisk,
  type DiscoverConfig,
  type ExtensionLoaderOptions,
} from './discover-extensions.js';
import { ManifestRegistry } from './manifest-registry.js';
import type { DiscoveredExtension } from './types/loader.js';

export interface ExtensionMetadataSnapshot {
  discovered: DiscoveredExtension[];
  manifestRegistry: ManifestRegistry;
}

/**
 * Scan extension directories once and build a manifest registry snapshot.
 * Pass the result to {@link ExtensionLoader.setManifestSnapshot} to avoid rediscovery.
 */
export function buildExtensionMetadataSnapshot(
  options: ExtensionLoaderOptions,
  config?: DiscoverConfig,
): ExtensionMetadataSnapshot {
  const discovered = discoverExtensionsFromDisk(options, config);
  return {
    discovered,
    manifestRegistry: ManifestRegistry.fromDiscovered(discovered),
  };
}

/**
 * Resolve loader options from app config when caller omits workspace paths.
 */
export function resolveExtensionLoaderOptionsFromConfig(
  config: DiscoverConfig,
): ExtensionLoaderOptions {
  const cfg = config as Config;
  const aid = resolveDefaultAgentId(cfg);
  return {
    workspaceDir: resolveAgentWorkspaceDir(cfg, aid),
    extensionsDir: resolveExtensionsDir(),
    workspaceExtensionsDir: resolveWorkspaceExtensionsDir(cfg, aid),
  };
}
