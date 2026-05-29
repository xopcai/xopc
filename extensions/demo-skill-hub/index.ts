/**
 * Demo Skill Hub — example skills marketplace extension.
 *
 * How to build your own marketplace extension:
 * 1. Copy `extensions/demo-skill-hub/` (or scaffold with `xopc extension init`).
 * 2. Pick a unique adapter id (e.g. `my-catalog`) — do not reuse built-in `store` / `skillhub` / `clawhub`
 *    unless you intentionally override them.
 * 3. Implement `SkillsMarketplaceAdapter` (listCategories, listPackages, getPackageDetail, downloadPackage).
 * 4. In `register()`, call `api.registerMarketplaceAdapter({ adapter, displayName })`.
 * 5. Enable the extension in Apps (or add to `extensions.enabled` in xopc.json).
 *
 * ClawHub remains a built-in provider. This demo registers **demo-skill-hub** as a separate
 * catalog that talks to clawhub.ai so you can see a second marketplace tab in Skills.
 */

import type { ExtensionApi } from 'xopc/extension-sdk';

const ADAPTER_ID = 'demo-skill-hub';
const DEFAULT_REGISTRY_BASE = 'https://clawhub.ai';
const LIST_BATCH_SIZE = 200;
const MAX_ZIP_BYTES = 15 * 1024 * 1024;

type ExtensionConfig = { registryBaseUrl?: string };

interface ClawHubListItem {
  slug: string;
  displayName: string;
  summary: string;
  stats: { downloads: number; stars: number };
  updatedAt: number;
  latestVersion: { version: string };
  metadata: { os: string[] | null } | null;
}

interface ClawHubListResponse {
  items: ClawHubListItem[];
}

interface ClawHubSearchHit {
  slug: string;
  displayName: string;
  summary: string;
  version: string | null;
  updatedAt: number;
  owner?: { handle: string; image: string | null };
  ownerHandle?: string;
}

function resolveRegistryBase(config: ExtensionConfig): string {
  const fromExt =
    typeof config.registryBaseUrl === 'string' ? config.registryBaseUrl.trim() : '';
  if (fromExt) {
    try {
      return new URL(fromExt).toString().replace(/\/$/, '');
    } catch {
      // fall through
    }
  }
  const env = process.env.CLAWHUB_REGISTRY?.trim();
  if (env) {
    try {
      return new URL(env).toString().replace(/\/$/, '');
    } catch {
      // fall through
    }
  }
  return DEFAULT_REGISTRY_BASE;
}

async function registryFetch(base: string, path: string): Promise<Response> {
  const res = await fetch(`${base}${path}`, { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    throw new Error(`Demo Skill Hub request failed (${res.status}): ${path}`);
  }
  return res;
}

function paginate<T>(rows: T[], page: number, pageSize: number) {
  const total = rows.length;
  const start = (page - 1) * pageSize;
  return {
    items: rows.slice(start, start + pageSize),
    meta: {
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    },
  };
}

export default function register(api: ExtensionApi) {
  const extensionConfig = api.extensionConfig as ExtensionConfig;
  const registryBase = resolveRegistryBase(extensionConfig);

  api.registerMarketplaceAdapter({
    displayName: 'Demo Skill Hub',
    adapter: {
      id: ADAPTER_ID,

      async listCategories() {
        return [];
      },

      async listPackages(_config, params) {
        const pageSize = params.pageSize ?? 20;
        const page = params.page ?? 1;

        if (params.q?.trim()) {
          const sp = new URLSearchParams({
            q: params.q.trim(),
            nonSuspiciousOnly: 'true',
            limit: String(LIST_BATCH_SIZE),
          });
          const res = await registryFetch(registryBase, `/api/v1/search?${sp}`);
          const data = (await res.json()) as { results: ClawHubSearchHit[] };
          let rows = data.results.map((hit) => ({
            id: hit.slug,
            name: hit.displayName || hit.slug,
            type: 'skill',
            description: hit.summary || '',
            downloads: 0,
            author: {
              username: hit.owner?.handle ?? hit.ownerHandle ?? 'demo-skill-hub',
              avatarUrl: hit.owner?.image ?? null,
            },
            latestVersion: hit.version ?? '1.0.0',
            updatedAt: String(hit.updatedAt),
            categories: [] as string[],
            stars: 0,
            sourceLabel: 'Demo Skill Hub',
          }));
          if (params.sort === 'downloads') {
            rows = [...rows].sort((a, b) => b.downloads - a.downloads);
          }
          const { items, meta } = paginate(rows, page, pageSize);
          return { items, meta, provider: ADAPTER_ID };
        }

        const sp = new URLSearchParams({ limit: String(LIST_BATCH_SIZE), nonSuspiciousOnly: 'true' });
        if (params.sort === 'downloads') sp.set('sort', 'downloads');
        else if (params.sort === 'newest') sp.set('sort', 'newest');
        const res = await registryFetch(registryBase, `/api/v1/skills?${sp}`);
        const data = (await res.json()) as ClawHubListResponse;
        const rows = data.items.map((item) => ({
          id: item.slug,
          name: item.displayName || item.slug,
          type: 'skill',
          description: item.summary || '',
          downloads: item.stats.downloads,
          author: { username: 'demo-skill-hub', avatarUrl: null },
          latestVersion: item.latestVersion?.version ?? '1.0.0',
          updatedAt: String(item.updatedAt),
          categories: item.metadata?.os ?? [],
          stars: item.stats.stars,
          sourceLabel: 'Demo Skill Hub',
        }));
        const { items, meta } = paginate(rows, page, pageSize);
        return { items, meta, provider: ADAPTER_ID };
      },

      async getPackageDetail(_config, packageName) {
        const slug = packageName.trim();
        const enc = encodeURIComponent(slug);
        const res = await registryFetch(registryBase, `/api/v1/skills/${enc}`);
        const detail = (await res.json()) as {
          skill: { slug: string; displayName: string; summary: string; stats: { downloads: number } };
          latestVersion: { version: string; changelog: string | null; createdAt: number };
          owner: { handle: string; image: string | null };
        };
        const version = detail.latestVersion.version;
        let readme = `## ${detail.skill.displayName || slug}\n\n**${slug}** · v${version}\n\n${detail.skill.summary || '_No description._'}`;
        const changelog = detail.latestVersion.changelog?.trim();
        if (changelog) readme += `\n\n---\n\n## Changelog\n\n${changelog}`;

        return {
          id: slug,
          name: slug,
          type: 'skill',
          description: detail.skill.summary || '',
          readme,
          downloads: detail.skill.stats.downloads,
          author: { username: detail.owner.handle, avatarUrl: detail.owner.image },
          latestVersion: {
            version,
            changelog: detail.latestVersion.changelog,
            publishedAt: String(detail.latestVersion.createdAt),
          },
          provider: ADAPTER_ID,
        };
      },

      async downloadPackage(_config, packageName, version) {
        const slug = packageName.trim();
        const enc = encodeURIComponent(slug);
        const qs = version?.trim() ? `?version=${encodeURIComponent(version.trim())}` : '';
        const url = `${registryBase}/api/v1/packages/${enc}/download${qs}`;
        const res = await fetch(url, { redirect: 'follow' });
        if (!res.ok) {
          const body = await res.text().catch(() => '');
          throw new Error(`Demo Skill Hub download failed (${res.status}): ${body.slice(0, 200)}`);
        }
        const arrayBuf = await res.arrayBuffer();
        if (arrayBuf.byteLength > MAX_ZIP_BYTES) {
          throw new Error(`Package exceeds size limit (${arrayBuf.byteLength} > ${MAX_ZIP_BYTES})`);
        }
        return {
          buffer: Buffer.from(arrayBuf),
          skillId: slug,
          version: version?.trim() || 'latest',
        };
      },
    },
  });

  api.logger.info(
    `Registered marketplace adapter "${ADAPTER_ID}" (registry: ${registryBase}) — open Skills → Marketplace to browse`,
  );
}
