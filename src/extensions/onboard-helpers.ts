/**
 * Onboarding helpers — manifest-only, no extension runtime load.
 */

import type { ManifestRegistry } from './manifest-registry.js';
import type { ProviderAuthChoice } from './types/manifest.js';

export interface OnboardProviderInfo {
  extensionId: string;
  providerId: string;
  extensionName: string;
  envConfigured: boolean;
  configuredEnvVar?: string;
  authChoices: ProviderAuthChoice[];
  modelPrefixes: string[];
}

export interface OnboardChannelInfo {
  extensionId: string;
  channelId: string;
  extensionName: string;
  envConfigured: boolean;
  configuredEnvVar?: string;
}

export function listOnboardProviders(
  registry: ManifestRegistry,
  env: NodeJS.ProcessEnv = process.env,
): OnboardProviderInfo[] {
  const results: OnboardProviderInfo[] = [];

  for (const entry of registry.listProviderExtensions()) {
    const manifest = entry.manifest;
    const providers = manifest.providers || [];

    for (const providerId of providers) {
      const envVars = manifest.providerAuthEnvVars?.[providerId] || [];
      const configuredEnvVar = envVars.find((v) => !!env[v]);

      const authChoices = (manifest.providerAuthChoices || []).filter(
        (c) => c.provider === providerId,
      );

      results.push({
        extensionId: entry.id,
        providerId,
        extensionName: manifest.name || entry.id,
        envConfigured: !!configuredEnvVar,
        configuredEnvVar,
        authChoices,
        modelPrefixes: manifest.modelSupport?.modelPrefixes || [],
      });
    }
  }

  results.sort((a, b) => {
    if (a.envConfigured && !b.envConfigured) return -1;
    if (!a.envConfigured && b.envConfigured) return 1;
    return a.extensionName.localeCompare(b.extensionName);
  });

  return results;
}

export function listOnboardChannels(
  registry: ManifestRegistry,
  env: NodeJS.ProcessEnv = process.env,
): OnboardChannelInfo[] {
  const results: OnboardChannelInfo[] = [];

  for (const entry of registry.listChannelExtensions()) {
    const manifest = entry.manifest;
    const channels = manifest.channels || [];

    for (const channelId of channels) {
      const envVars = manifest.channelEnvVars?.[channelId] || [];
      const configuredEnvVar = envVars.find((v) => !!env[v]);

      results.push({
        extensionId: entry.id,
        channelId,
        extensionName: manifest.name || entry.id,
        envConfigured: !!configuredEnvVar,
        configuredEnvVar,
      });
    }
  }

  results.sort((a, b) => {
    if (a.envConfigured && !b.envConfigured) return -1;
    if (!a.envConfigured && b.envConfigured) return 1;
    return a.extensionName.localeCompare(b.extensionName);
  });

  return results;
}

export function resolveProviderForModel(
  registry: ManifestRegistry,
  modelId: string,
): { extensionId: string; providerId: string } | undefined {
  const entry = registry.findByModelId(modelId);
  if (!entry) return undefined;

  const providers = entry.manifest.providers;
  if (!providers || providers.length === 0) return undefined;

  return {
    extensionId: entry.id,
    providerId: providers[0],
  };
}
