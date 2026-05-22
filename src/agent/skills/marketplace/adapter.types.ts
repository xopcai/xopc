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
  /** Unique adapter identifier. Built-in: 'store' | 'skillhub' | 'clawhub'. Extensions may add arbitrary ids. */
  readonly id: string;

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
