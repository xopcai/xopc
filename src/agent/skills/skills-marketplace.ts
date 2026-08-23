/**
 * Skills marketplace facade: delegates to a {@link SkillsMarketplaceAdapter}
 * resolved from the dynamic adapter registry.
 */

import type { Config } from '../../config/schema.js';
import {
  getMarketplaceAdapter,
  getMarketplaceAdapterForProvider,
  getMarketplaceProviderDisplayName,
  resolveSkillsMarketplaceProvider,
  listRegisteredProviders,
  isRegisteredProvider,
} from './marketplace/resolve-adapter.js';
import type {
  MarketplaceCategoryOption,
  SkillsStoreListParams,
  UnifiedMarketplaceListResponse,
  UnifiedMarketplacePackageDetail,
} from './marketplace/adapters/store/store-api-client.js';

export type { SkillsMarketplaceAdapter } from './marketplace/adapter.types.js';
export {
  getMarketplaceAdapter,
  getMarketplaceProviderDisplayName,
  resolveSkillsMarketplaceProvider,
  listRegisteredProviders,
  isRegisteredProvider,
};
export { registerMarketplaceAdapter } from './marketplace/registry.js';
export type { MarketplaceAdapterRegistration } from './marketplace/registry.js';
export type {
  MarketplaceCategoryOption,
  MarketplacePackageDetail,
  SkillsStoreListParams,
  SkillsStoreListResponse,
  UnifiedMarketplaceListResponse,
  UnifiedMarketplacePackageDetail,
} from './marketplace/adapters/store/store-api-client.js';

function marketplaceAdapter(config: Config, provider?: string) {
  if (provider && isRegisteredProvider(provider)) {
    return getMarketplaceAdapterForProvider(provider);
  }
  return getMarketplaceAdapter(config);
}

export async function listMarketplaceCategories(
  config: Config,
  provider?: string,
  locale?: string,
): Promise<{ items: MarketplaceCategoryOption[] }> {
  const items = await marketplaceAdapter(config, provider).listCategories(config, { locale });
  return { items };
}

export async function listMarketplacePackages(
  config: Config,
  params: SkillsStoreListParams,
  provider?: string,
): Promise<UnifiedMarketplaceListResponse> {
  return marketplaceAdapter(config, provider).listPackages(config, params);
}

export async function getMarketplacePackageDetail(
  config: Config,
  packageName: string,
  provider?: string,
): Promise<UnifiedMarketplacePackageDetail> {
  return marketplaceAdapter(config, provider).getPackageDetail(config, packageName);
}

export async function downloadFromMarketplace(
  config: Config,
  packageName: string,
  version?: string,
  provider?: string,
): Promise<{ buffer: Buffer; skillId: string; version: string }> {
  return marketplaceAdapter(config, provider).downloadPackage(config, packageName, version);
}
