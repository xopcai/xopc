import type { Config } from '../../../config/schema.js';
import type {
  MarketplaceCategoryOption,
  SkillsStoreListParams,
  UnifiedMarketplaceListResponse,
  UnifiedMarketplacePackageDetail,
} from './adapters/store/store-api-client.js';

/**
 * Pluggable skills marketplace (catalog + install). Implementations: xopc Store, SkillHub.
 */
export interface SkillsMarketplaceAdapter {
  readonly id: 'store' | 'skillhub';

  /** Filter chips for the current provider (may be empty). */
  listCategories(config: Config): Promise<MarketplaceCategoryOption[]>;

  listPackages(config: Config, params: SkillsStoreListParams): Promise<UnifiedMarketplaceListResponse>;

  getPackageDetail(config: Config, packageName: string): Promise<UnifiedMarketplacePackageDetail>;

  downloadPackage(
    config: Config,
    packageName: string,
    version?: string,
  ): Promise<{ buffer: Buffer; skillId: string; version: string }>;
}
