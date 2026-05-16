import { basename } from 'node:path';

import { isValidSkillId } from '../../../managed-store.js';
import type { SkillMarkdownPreviewPayload } from '../../../types.js';
import { buildSkillMarkdownPreviewFromRaw } from '../../../skill-markdown-preview-from-raw.js';
import type { MarketplaceCategoryOption, MarketplacePackageListItem } from '../store/store-api-client.js';
import {
  curatedSkillsToPackageItems,
  downloadSkillHubZipFromEcosystem,
  resolveSkillHubEcosystemUrls,
  searchSkillHubLightmake,
} from './ecosystem-client.js';
import {
  getSkillHubSkill,
  getSkillHubSkillFileText,
  getSkillHubSkillFiles,
  pickSkillHubDocFilePath,
  downloadSkillHubZipBuffer,
  searchSkillHubSkills,
  type SkillHubSkill,
} from './registry-client.js';
import {
  cachedBatchGetSkillHubSkills,
  cachedFetchSkillHubCuratedIndex,
  cachedGetDefaultSkillSlugs,
  cachedListSkillHubRegistryCategories,
} from './skillhub-fetch-cache.js';

import { sortMarketplaceCategories } from '../../marketplace-category-order.js';
import type { SkillsMarketplaceAdapter } from '../../adapter.types.js';

/** Batch size for POST /api/v1/skills/batch (slug lists from default discovery). */
const REGISTRY_SKILL_BATCH_CHUNK = 80;

function humanizeRegistryCategoryKey(slug: string): string {
  return slug
    .replace(/_/g, '-')
    .split('-')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

function sourceLabelFromSkillSource(source: string | undefined): string | undefined {
  const s = source?.trim();
  if (!s) return undefined;
  const lower = s.toLowerCase();
  if (lower === 'clawhub') return 'ClawHub';
  if (lower === 'lightmake') return 'Lightmake';
  if (lower === 'skillhub') return 'SkillHub';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function filterByCategory(
  rows: MarketplacePackageListItem[],
  category?: string,
): MarketplacePackageListItem[] {
  const want = category?.trim();
  if (!want) return rows;
  return rows.filter((r) => (r.categories ?? []).includes(want));
}

async function collectRegistryCategoryKeysFromSlugs(slugs: string[]): Promise<Set<string>> {
  const used = new Set<string>();
  for (let i = 0; i < slugs.length; i += REGISTRY_SKILL_BATCH_CHUNK) {
    const chunk = slugs.slice(i, i + REGISTRY_SKILL_BATCH_CHUNK);
    const details = await cachedBatchGetSkillHubSkills(chunk);
    for (const d of details) {
      const k = d.skill.category?.trim();
      if (k) used.add(k);
    }
  }
  return used;
}

function isPipelineOnlyChangelog(text: string | null | undefined): boolean {
  if (!text?.trim()) return true;
  return /^synced by skillhub pipeline\.?$/i.test(text.trim());
}

function skillHubFallbackReadmeMarkdown(detail: {
  skill: SkillHubSkill;
  latestVersion: { version: string };
}): string {
  const s = detail.skill;
  const title = s.displayName?.trim() || s.slug;
  const zh = s.summary_zh?.trim();
  const en = s.summary?.trim();
  const body =
    zh && en && zh !== en
      ? `${zh}\n\n${en}`
      : zh || en || '_No description._';
  return `## ${title}\n\n**${s.slug}** · v${detail.latestVersion.version}\n\n${body}`;
}

function convertSkillHubToPackageListItem(detail: SkillHubSkill): MarketplacePackageListItem {
  const cat = detail.category?.trim();
  return {
    id: detail.slug,
    name: detail.displayName?.trim() || detail.slug,
    type: 'skill',
    description: detail.summary_zh || detail.summary,
    downloads: detail.stats.downloads,
    author: {
      username: detail.source || 'skillhub',
      avatarUrl: null,
    },
    latestVersion: detail.tags.latest || '1.0.0',
    updatedAt: String(detail.updatedAt),
    categories: cat ? [cat] : [],
    stars: detail.stats.stars,
    sourceLabel: sourceLabelFromSkillSource(detail.source),
  };
}

export const skillhubMarketplaceAdapter: SkillsMarketplaceAdapter = {
  id: 'skillhub',

  async listCategories(_config) {
    const sortByLabel = (a: MarketplaceCategoryOption, b: MarketplaceCategoryOption) =>
      a.label.localeCompare(b.label, 'zh-Hans-CN', { sensitivity: 'base' });

    const ecoUrls = resolveSkillHubEcosystemUrls();
    try {
      const idx = await cachedFetchSkillHubCuratedIndex(ecoUrls);
      if (idx.skills?.length) {
        const map = new Map<string, MarketplaceCategoryOption>();
        for (const s of idx.skills) {
          for (const raw of s.categories ?? []) {
            const label = String(raw).trim();
            if (label) map.set(label, { id: label, label });
          }
        }
        return sortMarketplaceCategories(
          Array.from(map.values()).filter((c) => c.id.trim() && c.label.trim()),
          sortByLabel,
        );
      }
    } catch {
      /* fall through: registry-backed catalog */
    }

    try {
      const [taxonomy, slugs] = await Promise.all([
        cachedListSkillHubRegistryCategories(),
        cachedGetDefaultSkillSlugs(),
      ]);
      const usedKeys = await collectRegistryCategoryKeysFromSlugs(slugs);
      const taxByKey = new Map(taxonomy.map((t) => [t.key, t] as const));
      const options: MarketplaceCategoryOption[] = [];
      for (const key of usedKeys) {
        const t = taxByKey.get(key);
        const label =
          t?.name?.trim() || t?.nameEn?.trim() || humanizeRegistryCategoryKey(key).trim();
        if (!label) continue;
        options.push({ id: key, label });
      }
      return sortMarketplaceCategories(options, (a, b) => {
        const oa = taxByKey.get(a.id)?.sortOrder ?? 999;
        const ob = taxByKey.get(b.id)?.sortOrder ?? 999;
        if (oa !== ob) return oa - ob;
        return sortByLabel(a, b);
      });
    } catch {
      return [];
    }
  },

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
        const details = await cachedBatchGetSkillHubSkills(searchResult.slugs);
        rows = details.map((d) => convertSkillHubToPackageListItem(d.skill));
      }
      rows = filterByCategory(rows, params.category);
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
      const idx = await cachedFetchSkillHubCuratedIndex(ecoUrls);
      let skills = [...idx.skills].filter((s) => s.slug?.trim());
      if (params.category?.trim()) {
        const want = params.category.trim();
        skills = skills.filter((s) =>
          (s.categories ?? []).some((x) => String(x).trim() === want),
        );
      }
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

    const slugs = await cachedGetDefaultSkillSlugs();
    if (params.category?.trim()) {
      const details = await cachedBatchGetSkillHubSkills(slugs);
      let allItems = details.map((d) => convertSkillHubToPackageListItem(d.skill));
      allItems = filterByCategory(allItems, params.category);
      if (params.sort === 'downloads') {
        allItems = [...allItems].sort((a, b) => b.downloads - a.downloads);
      } else if (params.sort === 'newest') {
        allItems = [...allItems].sort((a, b) => Number(b.updatedAt) - Number(a.updatedAt));
      }
      const total = allItems.length;
      const start = (page - 1) * pageSize;
      const items = allItems.slice(start, start + pageSize);
      const totalPages = Math.max(1, Math.ceil(total / pageSize));
      return {
        items,
        meta: { page, pageSize, total, totalPages },
        provider: 'skillhub',
      };
    }

    const total = slugs.length;
    const start = (page - 1) * pageSize;
    const paginatedSlugs = slugs.slice(start, start + pageSize);
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const details = await cachedBatchGetSkillHubSkills(paginatedSlugs);
    const items = details.map((d) => convertSkillHubToPackageListItem(d.skill));

    return {
      items,
      meta: { page, pageSize, total, totalPages },
      provider: 'skillhub',
    };
  },

  async getPackageDetail(_config, packageName) {
    const detail = await getSkillHubSkill(packageName);
    const slug = detail.skill.slug;
    const version = detail.latestVersion.version;
    const changelog = detail.latestVersion.changelog;

    let readme: string | null = null;
    let docPath: string | null = null;
    try {
      const { files } = await getSkillHubSkillFiles(slug, version);
      docPath = pickSkillHubDocFilePath(files);
      if (docPath) {
        readme = await getSkillHubSkillFileText(slug, docPath, version);
      }
    } catch {
      readme = null;
    }

    const trimmed = readme?.trim() ?? '';
    const docBase = docPath ? basename(docPath.replace(/\\/g, '/')).toLowerCase() : '';
    const isSkillMd = docBase === 'skill.md';

    let skillDocPreview: SkillMarkdownPreviewPayload | undefined;

    if (!trimmed) {
      readme = skillHubFallbackReadmeMarkdown(detail);
    } else if (isSkillMd) {
      try {
        skillDocPreview = buildSkillMarkdownPreviewFromRaw(trimmed, {
          name: detail.skill.slug,
          description: detail.skill.summary_zh || detail.skill.summary || '',
        });
        readme = skillDocPreview.bodyMarkdown;
        if (changelog?.trim() && !isPipelineOnlyChangelog(changelog)) {
          readme = `${readme}\n\n---\n\n## Changelog\n\n${changelog.trim()}`;
        }
      } catch {
        readme = trimmed;
        if (changelog?.trim() && !isPipelineOnlyChangelog(changelog)) {
          readme = `${trimmed}\n\n---\n\n## Changelog\n\n${changelog.trim()}`;
        }
      }
    } else {
      readme = trimmed;
      if (changelog?.trim() && !isPipelineOnlyChangelog(changelog)) {
        readme = `${trimmed}\n\n---\n\n## Changelog\n\n${changelog.trim()}`;
      }
    }

    return {
      id: detail.skill.slug,
      name: detail.skill.slug,
      type: 'skill',
      description: detail.skill.summary_zh || detail.skill.summary,
      readme,
      skillDocPreview,
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
