import {
  downloadSkillZipBuffer,
  fetchMarketplacePackageDetail,
  listSkillPackages,
  resolveSkillZipDownloadUrl,
  resolveSkillsStoreBaseUrl,
  skillIdForMarketplaceInstall,
} from './store-api-client.js';

import type { SkillsMarketplaceAdapter } from '../../adapter.types.js';
import { registerMarketplaceAdapter } from '../../registry.js';

export const storeMarketplaceAdapter: SkillsMarketplaceAdapter = {
  id: 'store',

  async listCategories(_config) {
    return [];
  },

  async listPackages(config, params) {
    const base = resolveSkillsStoreBaseUrl(config);
    const response = await listSkillPackages(base, params);
    return {
      items: response.items,
      meta: response.meta,
      provider: 'store',
    };
  },

  async getPackageDetail(config, packageName) {
    const base = resolveSkillsStoreBaseUrl(config);
    const detail = await fetchMarketplacePackageDetail(base, packageName);
    return { ...detail, provider: 'store' };
  },

  async downloadPackage(config, packageName, version) {
    const base = resolveSkillsStoreBaseUrl(config);
    const { downloadUrl, version: resolvedVersion } = await resolveSkillZipDownloadUrl(
      base,
      packageName,
      version,
    );
    const buffer = await downloadSkillZipBuffer(base, downloadUrl);
    return {
      buffer,
      skillId: skillIdForMarketplaceInstall(packageName) ?? packageName,
      version: resolvedVersion,
    };
  },
};

// Self-register into the dynamic marketplace adapter registry.
registerMarketplaceAdapter({
  adapter: storeMarketplaceAdapter,
  displayName: 'xopc Store',
});
