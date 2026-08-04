import { existsSync } from 'node:fs';

import { CredentialResolver } from '../../../../auth/credentials.js';
import { getModelsJsonPath, loadModelsJson } from '../../../../config/models-json.js';
import { classifyHost } from '../../../../media-shared/http/index.js';
import type { CheckResult, DoctorContext } from '../types.js';

export async function checkImageProviders(_ctx: DoctorContext): Promise<CheckResult> {
  const path = getModelsJsonPath();
  if (!existsSync(path)) {
    return {
      id: 'image-providers',
      label: 'Image providers',
      status: 'skip',
      message: 'No models.json file; custom image providers are not configured.',
      hints: [],
    };
  }

  const loaded = loadModelsJson(path);
  if (loaded.error) {
    return {
      id: 'image-providers',
      label: 'Image providers',
      status: 'fail',
      message: 'models.json image provider configuration is invalid.',
      hints: [loaded.error, path],
    };
  }
  const entries = Object.entries(loaded.config.providers).filter(
    (entry): entry is [string, typeof entry[1] & { imageGeneration: NonNullable<typeof entry[1]['imageGeneration']> }] =>
      Boolean(entry[1].imageGeneration),
  );
  if (entries.length === 0) {
    return {
      id: 'image-providers',
      label: 'Image providers',
      status: 'skip',
      message: 'No custom image providers are configured.',
      hints: [path],
    };
  }

  const blockedEndpoints: string[] = [];
  const missingCredentials: string[] = [];
  const resolver = new CredentialResolver();
  for (const [providerId, provider] of entries) {
    const hostname = new URL(provider.baseUrl!).hostname.toLowerCase();
    const hostClass = classifyHost(hostname);
    const allowedHosts = (provider.imageGeneration.network?.allowedHosts ?? [])
      .map((entry) => entry.toLowerCase());
    if (hostClass !== 'public' && !allowedHosts.includes(hostname)) {
      blockedEndpoints.push(`${providerId}: ${hostname}`);
    }
    if (
      provider.imageGeneration.auth.type !== 'none'
      && !(await resolver.resolveApiKey(providerId))
    ) {
      missingCredentials.push(providerId);
    }
  }

  if (blockedEndpoints.length > 0) {
    return {
      id: 'image-providers',
      label: 'Image providers',
      status: 'fail',
      message: `${blockedEndpoints.length} custom image provider endpoint(s) are blocked by private-network policy.`,
      hints: [
        ...blockedEndpoints,
        'Add each exact private hostname to imageGeneration.network.allowedHosts only when you trust it.',
      ],
    };
  }
  if (missingCredentials.length > 0) {
    return {
      id: 'image-providers',
      label: 'Image providers',
      status: 'warn',
      message: `${missingCredentials.length} custom image provider(s) need an API key.`,
      hints: missingCredentials.map((providerId) => `Configure a credential for ${providerId}.`),
    };
  }
  return {
    id: 'image-providers',
    label: 'Image providers',
    status: 'pass',
    message: `${entries.length} custom image provider(s) validate and are ready.`,
    hints: [path],
  };
}
