import type { Config } from '../../../config/schema.js';
import type { SkillsMarketplaceProvider } from './adapters/store/store-api-client.js';

import type { SkillsMarketplaceAdapter } from './adapter.types.js';
import { skillhubMarketplaceAdapter } from './adapters/skillhub/adapter.js';
import { storeMarketplaceAdapter } from './adapters/store/adapter.js';

export function resolveSkillsMarketplaceProvider(config: Config): SkillsMarketplaceProvider {
  const env = process.env.XOPC_SKILLS_MARKETPLACE_PROVIDER?.trim().toLowerCase();
  if (env === 'skillhub' || env === 'store') {
    return env;
  }
  const fromConfig = config.gateway?.skillsMarketplaceProvider;
  if (fromConfig === 'skillhub' || fromConfig === 'store') {
    return fromConfig;
  }
  return 'skillhub';
}

export function getMarketplaceProviderDisplayName(provider: SkillsMarketplaceProvider): string {
  switch (provider) {
    case 'skillhub':
      return 'SkillHub (skillhub.cn)';
    case 'store':
    default:
      return 'xopc Store (store.xopc.ai)';
  }
}

export function getMarketplaceAdapter(config: Config): SkillsMarketplaceAdapter {
  const id = resolveSkillsMarketplaceProvider(config);
  switch (id) {
    case 'skillhub':
      return skillhubMarketplaceAdapter;
    default:
      return storeMarketplaceAdapter;
  }
}
