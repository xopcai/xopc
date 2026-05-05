/**
 * Skills marketplace facade: delegates to a {@link SkillsMarketplaceAdapter}
 * (store.xopc.ai or SkillHub).
 */

import type { Config } from '../../config/schema.js';
import {
  getMarketplaceAdapter,
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

export async function listMarketplaceCategories(
  config: Config,
): Promise<{ items: MarketplaceCategoryOption[] }> {
  const items = await getMarketplaceAdapter(config).listCategories(config);
  return { items };
}

export async function listMarketplacePackages(
  config: Config,
  params: SkillsStoreListParams,
): Promise<UnifiedMarketplaceListResponse> {
  return getMarketplaceAdapter(config).listPackages(config, params);
}

export async function getMarketplacePackageDetail(
  config: Config,
  packageName: string,
): Promise<UnifiedMarketplacePackageDetail> {
  return getMarketplaceAdapter(config).getPackageDetail(config, packageName);
}

export async function downloadFromMarketplace(
  config: Config,
  packageName: string,
  version?: string,
): Promise<{ buffer: Buffer; skillId: string; version: string }> {
  return getMarketplaceAdapter(config).downloadPackage(config, packageName, version);
}
