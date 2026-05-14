/**
 * Skills marketplace facade: delegates to a {@link SkillsMarketplaceAdapter}
 * (store.xopc.ai or SkillHub).
 */

import type { Config } from '../../config/schema.js';
import type { SkillsMarketplaceProvider } from './marketplace/adapters/store/store-api-client.js';
import {
  getMarketplaceAdapter,
  getMarketplaceAdapterForProvider,
  getMarketplaceProviderDisplayName,
  resolveSkillsMarketplaceProvider,
} from './marketplace/resolve-adapter.js';
import type {
  MarketplaceCategoryOption,
  SkillsStoreListParams,
  UnifiedMarketplaceListResponse,
  UnifiedMarketplacePackageDetail,
} from './marketplace/adapters/store/store-api-client.js';

export type { SkillsMarketplaceAdapter } from './marketplace/adapter.types.js';
export type { SkillsMarketplaceProvider } from './marketplace/adapters/store/store-api-client.js';
export { getMarketplaceAdapter, getMarketplaceProviderDisplayName, resolveSkillsMarketplaceProvider };
export type {
  MarketplaceCategoryOption,
  MarketplacePackageDetail,
  SkillsStoreListParams,
  SkillsStoreListResponse,
  UnifiedMarketplaceListResponse,
  UnifiedMarketplacePackageDetail,
} from './marketplace/adapters/store/store-api-client.js';

function marketplaceAdapter(config: Config, provider?: SkillsMarketplaceProvider) {
  if (provider === 'store' || provider === 'skillhub') {
    return getMarketplaceAdapterForProvider(provider);
  }
  return getMarketplaceAdapter(config);
}

export async function listMarketplaceCategories(
  config: Config,
  provider?: SkillsMarketplaceProvider,
): Promise<{ items: MarketplaceCategoryOption[] }> {
  const items = await marketplaceAdapter(config, provider).listCategories(config);
  return { items };
}

export async function listMarketplacePackages(
  config: Config,
  params: SkillsStoreListParams,
  provider?: SkillsMarketplaceProvider,
): Promise<UnifiedMarketplaceListResponse> {
  return marketplaceAdapter(config, provider).listPackages(config, params);
}

export async function getMarketplacePackageDetail(
  config: Config,
  packageName: string,
  provider?: SkillsMarketplaceProvider,
): Promise<UnifiedMarketplacePackageDetail> {
  return marketplaceAdapter(config, provider).getPackageDetail(config, packageName);
}

export async function downloadFromMarketplace(
  config: Config,
  packageName: string,
  version?: string,
  provider?: SkillsMarketplaceProvider,
): Promise<{ buffer: Buffer; skillId: string; version: string }> {
  return marketplaceAdapter(config, provider).downloadPackage(config, packageName, version);
}
