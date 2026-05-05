import { isValidSkillId } from '../../../managed-store.js';
import type { MarketplacePackageListItem } from '../store/store-api-client.js';
import {
  curatedSkillsToPackageItems,
  downloadSkillHubZipFromEcosystem,
  fetchSkillHubCuratedIndex,
  resolveSkillHubEcosystemUrls,
  searchSkillHubLightmake,
} from './ecosystem-client.js';
import {
  batchGetSkillHubSkills,
  getDefaultSkillSlugs,
  getSkillHubSkill,
  getSkillHubSkillFiles,
  downloadSkillHubZipBuffer,
  searchSkillHubSkills,
  type SkillHubSkill,
} from './registry-client.js';

import type { SkillsMarketplaceAdapter } from '../../adapter.types.js';

function convertSkillHubToPackageListItem(detail: SkillHubSkill): MarketplacePackageListItem {
  return {
    id: detail.slug,
    name: detail.slug,
    type: 'skill',
    description: detail.summary_zh || detail.summary,
    downloads: detail.stats.downloads,
    author: {
      username: detail.source || 'skillhub',
      avatarUrl: null,
    },
    latestVersion: detail.tags.latest || '1.0.0',
    updatedAt: String(detail.updatedAt),
  };
}

export const skillhubMarketplaceAdapter: SkillsMarketplaceAdapter = {
  id: 'skillhub',

  async listPackages(_config, params) {
    const pageSize = params.pageSize ?? 20;
    const page = params.page ?? 1;
    const ecoUrls = resolveSkillHubEcosystemUrls();

    if (params.q?.trim()) {
      const q = params.q.trim();
      let rows: MarketplacePackageListItem[] = [];
      try {
        const fromLightmake = await searchSkillHubLightmake(ecoUrls, q, 100);
        rows = fromLightmake as MarketplacePackageListItem[];
      } catch {
        rows = [];
      }
      if (rows.length === 0) {
        const searchResult = await searchSkillHubSkills(q, 200);
        const details = await batchGetSkillHubSkills(searchResult.slugs);
        rows = details.map((d) => convertSkillHubToPackageListItem(d.skill));
      }
      if (params.sort === 'downloads') {
        rows = [...rows].sort((a, b) => b.downloads - a.downloads);
      } else if (params.sort === 'newest') {
        rows = [...rows].sort((a, b) => Number(b.updatedAt) - Number(a.updatedAt));
      }
      const total = rows.length;
      const start = (page - 1) * pageSize;
      const items = rows.slice(start, start + pageSize);
      const totalPages = Math.max(1, Math.ceil(total / pageSize));
      return {
        items,
        meta: { page, pageSize, total, totalPages },
        provider: 'skillhub',
      };
    }

    try {
      const idx = await fetchSkillHubCuratedIndex(ecoUrls);
      let skills = [...idx.skills].filter((s) => s.slug?.trim());
      if (params.sort === 'downloads') {
        skills.sort((a, b) => (b.downloads ?? 0) - (a.downloads ?? 0));
      } else if (params.sort === 'newest') {
        skills.sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999));
      }
      const rows = curatedSkillsToPackageItems(skills) as MarketplacePackageListItem[];
      const total = rows.length;
      const start = (page - 1) * pageSize;
      const items = rows.slice(start, start + pageSize);
      const totalPages = Math.max(1, Math.ceil(total / pageSize));
      return {
        items,
        meta: { page, pageSize, total, totalPages },
        provider: 'skillhub',
      };
    } catch {
      // fall through
    }

    const slugs = await getDefaultSkillSlugs();
    const total = slugs.length;
    const start = (page - 1) * pageSize;
    const paginatedSlugs = slugs.slice(start, start + pageSize);
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const details = await batchGetSkillHubSkills(paginatedSlugs);
    const items = details.map((d) => convertSkillHubToPackageListItem(d.skill));

    return {
      items,
      meta: { page, pageSize, total, totalPages },
      provider: 'skillhub',
    };
  },

  async getPackageDetail(_config, packageName) {
    const detail = await getSkillHubSkill(packageName);
    return {
      id: detail.skill.slug,
      name: detail.skill.slug,
      type: 'skill',
      description: detail.skill.summary_zh || detail.skill.summary,
      readme: detail.latestVersion?.changelog ?? null,
      downloads: detail.skill.stats.downloads,
      author: {
        username: detail.owner.handle,
        avatarUrl: detail.owner.image,
      },
      latestVersion: {
        version: detail.latestVersion.version,
        changelog: detail.latestVersion.changelog,
        publishedAt: String(detail.latestVersion.createdAt),
      },
      provider: 'skillhub',
      skillHubInfo: {
        category: detail.skill.category,
        installs: detail.skill.stats.installs,
        stars: detail.skill.stats.stars,
        securityReports: detail.latestVersion.securityReports,
      },
    };
  },

  async downloadPackage(_config, packageName, version) {
    const slug = packageName.trim();
    if (version?.trim()) {
      const { buffer, version: resolvedVersion } = await downloadSkillHubZipBuffer(slug, version);
      return {
        buffer,
        skillId: isValidSkillId(slug) ? slug : 'unknown',
        version: resolvedVersion,
      };
    }

    const ecoUrls = resolveSkillHubEcosystemUrls();
    try {
      const buffer = await downloadSkillHubZipFromEcosystem(ecoUrls, slug);
      let resolvedVersion = '1.0.0';
      try {
        resolvedVersion = (await getSkillHubSkillFiles(slug)).version;
      } catch {
        // keep default
      }
      return {
        buffer,
        skillId: isValidSkillId(slug) ? slug : 'unknown',
        version: resolvedVersion,
      };
    } catch {
      const { buffer, version: resolvedVersion } = await downloadSkillHubZipBuffer(slug);
      return {
        buffer,
        skillId: isValidSkillId(slug) ? slug : 'unknown',
        version: resolvedVersion,
      };
    }
  },
};
