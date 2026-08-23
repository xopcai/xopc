import { buildSkillMarkdownPreviewFromRaw } from '../../../skill-markdown-preview-from-raw.js';
import {
  downloadSkillZipBuffer,
  fetchMarketplacePackageDetail,
  listSkillCategories,
  listSkillPackages,
  resolveSkillZipDownloadUrl,
  resolveSkillsStoreBaseUrl,
  skillIdForMarketplaceInstall,
  verifyStoreArtifactSha256,
} from './store-api-client.js';

import type { SkillsMarketplaceAdapter } from '../../adapter.types.js';
import { registerMarketplaceAdapter } from '../../registry.js';

export const storeMarketplaceAdapter: SkillsMarketplaceAdapter = {
  id: 'store',

  async listCategories(config, options) {
    return listSkillCategories(resolveSkillsStoreBaseUrl(config), options?.locale);
  },

  async listPackages(config, params) {
    const base = resolveSkillsStoreBaseUrl(config);
    const response = await listSkillPackages(base, params);
    return {
      items: response.items.map((item) => ({
        ...item,
        categories: item.category ? [item.category] : [],
      })),
      meta: response.meta,
      provider: 'store',
    };
  },

  async getPackageDetail(config, packageName) {
    const base = resolveSkillsStoreBaseUrl(config);
    const detail = await fetchMarketplacePackageDetail(base, packageName);
    const readme = detail.readme?.trim();
    if (!readme) {
      throw new Error(`Store skill package [${packageName}] did not include readme`);
    }
    return {
      ...detail,
      readme,
      provider: 'store',
      skillDocPreview: buildSkillMarkdownPreviewFromRaw(readme, {
        name: detail.name,
        description: detail.description,
      }),
    };
  },

  async downloadPackage(config, packageName, version) {
    const base = resolveSkillsStoreBaseUrl(config);
    const { downloadUrl, version: resolvedVersion, sha256 } = await resolveSkillZipDownloadUrl(
      base,
      packageName,
      version,
    );
    const buffer = await downloadSkillZipBuffer(base, downloadUrl);
    verifyStoreArtifactSha256(buffer, sha256);
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
  displayName: 'XOPC Store',
});
