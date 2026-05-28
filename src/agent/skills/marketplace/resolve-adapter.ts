import type { Config } from '../../../config/schema.js';

import type { SkillsMarketplaceAdapter } from './adapter.types.js';
import {
  getRegisteredAdapter,
  getProviderDisplayName,
  isRegisteredProvider,
  getRegisteredAdapterIds,
} from './registry.js';

// Side-effect imports: each built-in adapter self-registers into the registry.
import './adapters/store/adapter.js';
import './adapters/skillhub/adapter.js';
import './adapters/clawhub/adapter.js';

/** Resolve the default marketplace provider from env / config. */
export function resolveSkillsMarketplaceProvider(config: Config): string {
  const env = process.env.XOPC_SKILLS_MARKETPLACE_PROVIDER?.trim().toLowerCase();
  if (env && isRegisteredProvider(env)) {
    return env;
  }
  const fromConfig = config.gateway?.skillsMarketplaceProvider?.trim().toLowerCase();
  if (fromConfig && isRegisteredProvider(fromConfig)) {
    return fromConfig;
  }
  return 'skillhub';
}

export function getMarketplaceProviderDisplayName(provider: string): string {
  return getProviderDisplayName(provider);
}

export function getMarketplaceAdapterForProvider(id: string): SkillsMarketplaceAdapter {
  const adapter = getRegisteredAdapter(id);
  if (!adapter) {
    throw new Error(`Unknown marketplace provider: "${id}". Registered: ${getRegisteredAdapterIds().join(', ')}`);
  }
  return adapter;
}

export function getMarketplaceAdapter(config: Config): SkillsMarketplaceAdapter {
  return getMarketplaceAdapterForProvider(resolveSkillsMarketplaceProvider(config));
}

export { listRegisteredProviders, isRegisteredProvider } from './registry.js';
