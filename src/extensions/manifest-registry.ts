/**
 * Manifest registry — indexes extension manifests without loading runtime code.
 */

import type { DiscoveredExtension } from './types/loader.js';
import type { ExtensionManifest, ModelSupportDeclaration } from './types/manifest.js';

export interface ManifestRegistryEntry {
  id: string;
  manifest: ExtensionManifest;
  source: 'workspace' | 'global' | 'bundled' | 'config';
  path: string;
}

export class ManifestRegistry {
  private entries = new Map<string, ManifestRegistryEntry>();

  private providerIndex = new Map<string, string>();
  private channelIndex = new Map<string, string>();
  private modelPrefixIndex = new Map<string, string>();
  private envVarIndex = new Map<string, string>();

  static fromDiscovered(discovered: DiscoveredExtension[]): ManifestRegistry {
    const registry = new ManifestRegistry();
    for (const ext of discovered) {
      registry.addEntry({
        id: ext.id,
        manifest: ext.manifest,
        source: ext.source,
        path: ext.path,
      });
    }
    return registry;
  }

  addEntry(entry: ManifestRegistryEntry): void {
    this.entries.set(entry.id, entry);
    this.buildIndexesForEntry(entry);
  }

  private buildIndexesForEntry(entry: ManifestRegistryEntry): void {
    const manifest = entry.manifest;

    if (manifest.providers) {
      for (const providerId of manifest.providers) {
        this.providerIndex.set(providerId, entry.id);
      }
    }

    if (manifest.channels) {
      for (const channelId of manifest.channels) {
        this.channelIndex.set(channelId, entry.id);
      }
    }

    if (manifest.modelSupport?.modelPrefixes) {
      for (const prefix of manifest.modelSupport.modelPrefixes) {
        this.modelPrefixIndex.set(prefix, entry.id);
      }
    }

    if (manifest.providerAuthEnvVars) {
      for (const envVars of Object.values(manifest.providerAuthEnvVars)) {
        for (const envVar of envVars) {
          this.envVarIndex.set(envVar, entry.id);
        }
      }
    }
    if (manifest.channelEnvVars) {
      for (const envVars of Object.values(manifest.channelEnvVars)) {
        for (const envVar of envVars) {
          this.envVarIndex.set(envVar, entry.id);
        }
      }
    }
  }

  getAllEntries(): ManifestRegistryEntry[] {
    return Array.from(this.entries.values());
  }

  getEntry(id: string): ManifestRegistryEntry | undefined {
    return this.entries.get(id);
  }

  findByProvider(providerId: string): ManifestRegistryEntry | undefined {
    const extensionId = this.providerIndex.get(providerId);
    return extensionId ? this.entries.get(extensionId) : undefined;
  }

  findByChannel(channelId: string): ManifestRegistryEntry | undefined {
    const extensionId = this.channelIndex.get(channelId);
    return extensionId ? this.entries.get(extensionId) : undefined;
  }

  findByModelId(modelId: string): ManifestRegistryEntry | undefined {
    const normalizedModelId = modelId.toLowerCase();

    for (const [prefix, extensionId] of this.modelPrefixIndex) {
      if (normalizedModelId.startsWith(prefix.toLowerCase())) {
        return this.entries.get(extensionId);
      }
    }

    for (const entry of this.entries.values()) {
      if (this.matchesModelPatterns(normalizedModelId, entry.manifest.modelSupport)) {
        return entry;
      }
    }

    return undefined;
  }

  findByEnvVar(envVarName: string): ManifestRegistryEntry | undefined {
    const extensionId = this.envVarIndex.get(envVarName);
    return extensionId ? this.entries.get(extensionId) : undefined;
  }

  detectAvailableByEnv(env: NodeJS.ProcessEnv): ManifestRegistryEntry[] {
    const found = new Set<string>();
    const results: ManifestRegistryEntry[] = [];

    for (const [envVar, extensionId] of this.envVarIndex) {
      if (env[envVar] && !found.has(extensionId)) {
        found.add(extensionId);
        const entry = this.entries.get(extensionId);
        if (entry) {
          results.push(entry);
        }
      }
    }

    return results;
  }

  listProviderExtensions(): ManifestRegistryEntry[] {
    return this.getAllEntries().filter(
      (entry) => entry.manifest.providers && entry.manifest.providers.length > 0,
    );
  }

  listChannelExtensions(): ManifestRegistryEntry[] {
    return this.getAllEntries().filter(
      (entry) => entry.manifest.channels && entry.manifest.channels.length > 0,
    );
  }

  listEnabledByDefault(): ManifestRegistryEntry[] {
    return this.getAllEntries().filter((entry) => entry.manifest.enabledByDefault === true);
  }

  private matchesModelPatterns(
    modelId: string,
    modelSupport?: ModelSupportDeclaration,
  ): boolean {
    if (!modelSupport?.modelPatterns) {
      return false;
    }

    for (const pattern of modelSupport.modelPatterns) {
      try {
        const regex = new RegExp(pattern, 'i');
        if (regex.test(modelId)) {
          return true;
        }
      } catch {
        // Invalid regex, skip
      }
    }

    return false;
  }
}
