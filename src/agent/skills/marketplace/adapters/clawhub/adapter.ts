/**
 * ClawHub (clawhub.ai) skills marketplace adapter.
 */

import { buildSkillMarkdownPreviewFromRaw } from '../../../skill-markdown-preview-from-raw.js';
import type { SkillsMarketplaceAdapter } from '../../adapter.types.js';
import { registerMarketplaceAdapter } from '../../registry.js';

// ─── Constants ───────────────────────────────────────────────────────────────

const DEFAULT_CLAWHUB_BASE = 'https://clawhub.ai';
const MAX_CLAWHUB_FILE_BYTES = 512 * 1024;
const MAX_SKILL_ZIP_BYTES = 15 * 1024 * 1024;
const SKILL_ID_RE = /^[a-zA-Z0-9]([a-zA-Z0-9._-]{0,62})$/;
const LIST_BATCH_SIZE = 200;

const DEFAULT_CACHE_MS = 5 * 60 * 1000;
const MAX_LIST_CACHE_KEYS = 24;
const MAX_DETAIL_CACHE_KEYS = 48;

// ─── Inline helpers ──────────────────────────────────────────────────────────

function isValidSkillId(id: string): boolean {
  return SKILL_ID_RE.test(id);
}

function resolveClawHubBaseUrl(): string {
  const env = process.env.CLAWHUB_REGISTRY?.trim();
  if (env) {
    try {
      return new URL(env).toString().replace(/\/$/, '');
    } catch {
      // fall through
    }
  }
  return DEFAULT_CLAWHUB_BASE;
}

// ─── ClawHub API types ───────────────────────────────────────────────────────

interface ClawHubSkillListItem {
  slug: string;
  displayName: string;
  summary: string;
  tags: Record<string, string>;
  stats: {
    comments: number;
    downloads: number;
    installsAllTime: number;
    installsCurrent: number;
    stars: number;
    versions: number;
  };
  createdAt: number;
  updatedAt: number;
  latestVersion: {
    version: string;
    createdAt: number;
    changelog: string | null;
    license: string | null;
  };
  metadata: { os: string[] | null; systems: string[] | null } | null;
}

interface ClawHubSkillListResponse {
  items: ClawHubSkillListItem[];
  nextCursor: string | null;
}

export interface ClawHubSearchResultItem {
  id?: string;
  score?: number;
  slug: string;
  source?: string;
  downloads?: number;
  canonicalUrl?: string;
  install?: {
    kind?: string;
    reference?: string;
    sourceUrl?: string | null;
  };
  links?: { canonical?: string | null; source?: string | null };
  sourceIdentity?: { owner?: string | null; repo?: string | null };
  publisher?: { handle?: string | null; displayName?: string | null; avatarUrl?: string | null };
  metrics?: { bookmarks?: number; updatedAt?: number };
  trust?: {
    clawHubVerdict?: string | null;
    installability?: string | null;
    upstreamScanners?: Record<string, {
      status?: string | null;
      sourceCheckedAt?: string | null;
      sourceUrl?: string | null;
    }>;
  };
  native?: {
    skill?: {
      stats?: { downloads?: number; stars?: number };
      tags?: Record<string, string>;
      categories?: string[];
    };
  } | null;
  displayName?: string;
  summary?: string;
  version?: string | null;
  updatedAt?: number;
  ownerHandle?: string;
  owner?: {
    handle: string;
    displayName: string;
    image: string | null;
  };
}

export interface ClawHubSearchResponse {
  results: ClawHubSearchResultItem[];
}

interface ClawHubSkillDetail {
  skill: {
    slug: string;
    displayName: string;
    summary: string;
    tags: Record<string, string>;
    stats: {
      comments: number;
      downloads: number;
      installsAllTime: number;
      installsCurrent: number;
      stars: number;
      versions: number;
    };
    createdAt: number;
    updatedAt: number;
  };
  latestVersion: {
    version: string;
    createdAt: number;
    changelog: string | null;
    license: string | null;
  };
  metadata: { os: string[] | null; systems: string[] | null } | null;
  owner: {
    handle: string;
    userId: string;
    displayName: string;
    image: string | null;
  };
  moderation: {
    isSuspicious: boolean;
    isMalwareBlocked: boolean;
    verdict: string;
  } | null;
}

interface ClawHubVersionFile {
  path: string;
  size: number;
  sha256: string;
  contentType: string;
}

interface ClawHubVersionDetail {
  skill: { slug: string; displayName: string };
  version: {
    version: string;
    createdAt: number;
    changelog: string | null;
    changelogSource: string | null;
    license: string | null;
    files: ClawHubVersionFile[];
    security: {
      status: string;
      hasWarnings: boolean;
      hasScanResult: boolean;
    } | null;
  };
}

type ClawHubListSort = 'updated' | 'newest' | 'downloads' | 'stars' | 'trending';

interface ClawHubListParams {
  limit?: number;
  cursor?: string;
  sort?: ClawHubListSort;
}

// ─── ClawHub HTTP helpers ────────────────────────────────────────────────────

async function clawHubFetch(path: string, init?: { signal?: AbortSignal }): Promise<Response> {
  const base = resolveClawHubBaseUrl();
  const url = `${base}${path}`;
  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: init?.signal,
  });
  return res as unknown as Response;
}

function assertOk(res: Response, context: string): void {
  if (!res.ok) {
    throw new Error(`ClawHub ${context} failed (${res.status})`);
  }
}

async function listClawHubSkills(params?: ClawHubListParams): Promise<ClawHubSkillListResponse> {
  const sp = new URLSearchParams();
  if (params?.limit) sp.set('limit', String(params.limit));
  if (params?.cursor) sp.set('cursor', params.cursor);
  if (params?.sort) sp.set('sort', params.sort);
  sp.set('nonSuspiciousOnly', 'true');
  const qs = sp.toString();
  const res = await clawHubFetch(`/api/v1/skills${qs ? `?${qs}` : ''}`);
  assertOk(res, 'list skills');
  return (await res.json()) as ClawHubSkillListResponse;
}

async function searchClawHubSkills(query: string, limit?: number): Promise<ClawHubSearchResponse> {
  const sp = new URLSearchParams({ q: query, nonSuspiciousOnly: 'true' });
  if (limit) sp.set('limit', String(limit));
  const res = await clawHubFetch(`/api/v1/search?${sp.toString()}`);
  assertOk(res, 'search');
  return (await res.json()) as ClawHubSearchResponse;
}

/** Public federated search used by the read-only marketplace discovery tool. */
export async function searchClawHubFederatedSkills(
  query: string,
  limit?: number,
): Promise<ClawHubSearchResponse> {
  return cachedSearchClawHubSkills(query, limit);
}

async function getClawHubSkillDetail(slug: string): Promise<ClawHubSkillDetail> {
  const enc = encodeURIComponent(slug.trim());
  const res = await clawHubFetch(`/api/v1/skills/${enc}`);
  assertOk(res, `skill detail [${slug}]`);
  return (await res.json()) as ClawHubSkillDetail;
}

async function getClawHubVersionDetail(slug: string, version: string): Promise<ClawHubVersionDetail> {
  const enc = encodeURIComponent(slug.trim());
  const ver = encodeURIComponent(version.trim());
  const res = await clawHubFetch(`/api/v1/skills/${enc}/versions/${ver}`);
  assertOk(res, `version detail [${slug}@${version}]`);
  return (await res.json()) as ClawHubVersionDetail;
}

async function getClawHubSkillFileText(slug: string, filePath: string, version?: string): Promise<string> {
  const enc = encodeURIComponent(slug.trim());
  const sp = new URLSearchParams({ path: filePath });
  if (version?.trim()) sp.set('version', version.trim());
  const base = resolveClawHubBaseUrl();
  const url = `${base}/api/v1/skills/${enc}/file?${sp.toString()}`;
  const res = await fetch(url, { headers: { Accept: 'text/markdown,text/plain,*/*' } });
  if (!res.ok) {
    throw new Error(`ClawHub file fetch [${slug}/${filePath}] failed (${res.status})`);
  }
  const text = await res.text();
  return text.length > MAX_CLAWHUB_FILE_BYTES ? text.slice(0, MAX_CLAWHUB_FILE_BYTES) : text;
}

async function downloadClawHubSkillZip(
  reference: string,
  version?: string,
): Promise<{ buffer: Buffer; version: string; slug: string }> {
  const normalized = reference.trim().replace(/^@/, '');
  const parts = normalized.split('/').filter(Boolean);
  const ownerHandle = parts.length === 2 ? parts[0] : undefined;
  const slug = parts.length === 2 ? parts[1]! : parts.length === 1 ? parts[0]! : '';
  if (!isValidSkillId(slug) || (ownerHandle && !isValidSkillId(ownerHandle))) {
    throw new Error(`Invalid ClawHub install reference: ${reference}`);
  }
  const sp = new URLSearchParams({ slug });
  if (ownerHandle) sp.set('ownerHandle', ownerHandle);
  if (version?.trim()) sp.set('version', version.trim());
  const base = resolveClawHubBaseUrl();
  const url = `${base}/api/v1/download?${sp.toString()}`;
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`ClawHub download [${slug}] failed (${res.status}): ${body.slice(0, 200)}`);
  }
  const contentType = res.headers.get('content-type') ?? '';
  if (!contentType.includes('zip') && !contentType.includes('octet-stream')) {
    throw new Error(`ClawHub download [${slug}] unexpected content-type: ${contentType}`);
  }
  const arrayBuf = await res.arrayBuffer();
  if (arrayBuf.byteLength > MAX_SKILL_ZIP_BYTES) {
    throw new Error(
      `ClawHub download [${slug}] exceeds size limit (${arrayBuf.byteLength} > ${MAX_SKILL_ZIP_BYTES})`,
    );
  }
  return { buffer: Buffer.from(arrayBuf), version: version?.trim() || 'latest', slug };
}

function pickClawHubDocFilePath(files: ClawHubVersionFile[]): string | null {
  const rows = files.map((f) => ({
    path: f.path.replace(/\\/g, '/'),
    base: f.path.replace(/\\/g, '/').split('/').pop()?.toLowerCase() ?? '',
  }));
  const find = (name: string) => rows.find((r) => r.base === name.toLowerCase());
  const skillMd = find('SKILL.md') ?? find('skill.md');
  if (skillMd) return skillMd.path;
  const readme = find('README.md') ?? find('readme.md');
  if (readme) return readme.path;
  return null;
}

// ─── In-memory TTL cache ─────────────────────────────────────────────────────

type CacheEntry<T> = { value: T; expiresAt: number };

function cacheTtlMs(): number {
  const raw = process.env.XOPC_CLAWHUB_CACHE_MS?.trim();
  if (raw === '0' || raw === 'false') return 0;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_CACHE_MS;
  return parsed;
}

function getFresh<T>(entry: CacheEntry<T> | undefined): T | undefined {
  if (!entry || entry.expiresAt <= Date.now()) return undefined;
  return entry.value;
}

function evictOldest<T>(map: Map<string, CacheEntry<T>>): void {
  const first = map.keys().next().value;
  if (first !== undefined) map.delete(first);
}

const listCache = new Map<string, CacheEntry<ClawHubSkillListResponse>>();
const searchCache = new Map<string, CacheEntry<ClawHubSearchResponse>>();
const detailCache = new Map<string, CacheEntry<ClawHubSkillDetail>>();

async function cachedListClawHubSkills(params?: ClawHubListParams): Promise<ClawHubSkillListResponse> {
  const ttl = cacheTtlMs();
  const key = JSON.stringify(params ?? {});
  if (ttl > 0) {
    const hit = getFresh(listCache.get(key));
    if (hit) return hit;
  }
  const value = await listClawHubSkills(params);
  if (ttl > 0) {
    while (listCache.size >= MAX_LIST_CACHE_KEYS) evictOldest(listCache);
    listCache.set(key, { value, expiresAt: Date.now() + ttl });
  }
  return value;
}

async function cachedSearchClawHubSkills(query: string, limit?: number): Promise<ClawHubSearchResponse> {
  const ttl = cacheTtlMs();
  const key = `${query}::${limit ?? ''}`;
  if (ttl > 0) {
    const hit = getFresh(searchCache.get(key));
    if (hit) return hit;
  }
  const value = await searchClawHubSkills(query, limit);
  if (ttl > 0) {
    while (searchCache.size >= MAX_LIST_CACHE_KEYS) evictOldest(searchCache);
    searchCache.set(key, { value, expiresAt: Date.now() + ttl });
  }
  return value;
}

async function cachedGetClawHubSkillDetail(slug: string): Promise<ClawHubSkillDetail> {
  const ttl = cacheTtlMs();
  const key = slug.trim();
  if (ttl > 0) {
    const hit = getFresh(detailCache.get(key));
    if (hit) return hit;
  }
  const value = await getClawHubSkillDetail(slug);
  if (ttl > 0) {
    while (detailCache.size >= MAX_DETAIL_CACHE_KEYS) evictOldest(detailCache);
    detailCache.set(key, { value, expiresAt: Date.now() + ttl });
  }
  return value;
}

// ─── Adapter conversion helpers ──────────────────────────────────────────────

interface PackageListItem {
  id: string;
  name: string;
  type: string;
  description: string;
  downloads: number;
  author: { username: string; avatarUrl: string | null };
  latestVersion?: string;
  updatedAt: string;
  categories?: string[];
  stars?: number;
  sourceLabel?: string;
}

function convertListItemToPackageItem(item: ClawHubSkillListItem): PackageListItem {
  return {
    id: item.slug,
    name: item.displayName || item.slug,
    type: 'skill',
    description: item.summary || '',
    downloads: item.stats.downloads,
    author: { username: 'clawhub', avatarUrl: null },
    latestVersion: item.latestVersion?.version ?? item.tags.latest ?? '1.0.0',
    updatedAt: String(item.updatedAt),
    categories: item.metadata?.os ?? [],
    stars: item.stats.stars,
    sourceLabel: 'ClawHub',
  };
}

function convertSearchResultToPackageItem(
  item: ClawHubSearchResultItem,
  enrichment?: ClawHubSkillListItem,
): PackageListItem {
  return {
    id: item.id ?? item.install?.reference ?? item.slug,
    name: item.displayName || item.slug,
    type: 'skill',
    description: item.summary || '',
    downloads: item.downloads ?? item.native?.skill?.stats?.downloads ?? enrichment?.stats.downloads ?? 0,
    author: {
      username:
        item.publisher?.handle
        ?? item.sourceIdentity?.owner
        ?? item.owner?.handle
        ?? item.ownerHandle
        ?? 'clawhub',
      avatarUrl: item.publisher?.avatarUrl ?? item.owner?.image ?? null,
    },
    latestVersion: item.version ?? enrichment?.latestVersion?.version ?? '1.0.0',
    updatedAt: String(item.metrics?.updatedAt ?? item.updatedAt ?? ''),
    categories: item.native?.skill?.categories ?? enrichment?.metadata?.os ?? [],
    stars: item.native?.skill?.stats?.stars ?? item.metrics?.bookmarks ?? enrichment?.stats.stars ?? 0,
    sourceLabel: item.source === 'skills-sh' ? 'skills.sh' : 'ClawHub',
  };
}

function mapSortParam(sort?: string): ClawHubListSort | undefined {
  if (sort === 'downloads') return 'downloads';
  if (sort === 'newest') return 'newest';
  return undefined;
}

function fallbackReadmeMarkdown(detail: {
  skill: { slug: string; displayName: string; summary: string };
  latestVersion: { version: string };
}): string {
  const title = detail.skill.displayName || detail.skill.slug;
  const body = detail.skill.summary || '_No description._';
  return `## ${title}\n\n**${detail.skill.slug}** · v${detail.latestVersion.version}\n\n${body}`;
}

export const clawHubMarketplaceAdapter: SkillsMarketplaceAdapter = {
  id: 'clawhub',

  async listCategories() {
    return [];
  },

  async listPackages(_config, params) {
    const pageSize = params.pageSize ?? 20;
    const page = params.page ?? 1;

    if (params.q?.trim()) {
      // Search results from /search omit downloads/stars/metadata. We pull the cached list
      // snapshot in parallel and merge by slug — costs nothing when the list cache is hot
      // (which it is after any preceding browse), and adds at most one round-trip on a cold
      // cache. We still tolerate a list-fetch failure: enrichment becomes a no-op.
      const [searchResponse, listSettled] = await Promise.allSettled([
        cachedSearchClawHubSkills(params.q.trim(), LIST_BATCH_SIZE),
        cachedListClawHubSkills({ limit: LIST_BATCH_SIZE }),
      ]);
      if (searchResponse.status === 'rejected') throw searchResponse.reason;
      const enrichmentBySlug = new Map<string, ClawHubSkillListItem>();
      if (listSettled.status === 'fulfilled') {
        for (const it of listSettled.value.items) enrichmentBySlug.set(it.slug, it);
      }
      // The general ClawHub catalog remains installable through the ClawHub adapter, so
      // federated skills.sh rows are surfaced only by skills_marketplace_search, where their
      // canonical source and install reference can be preserved.
      let rows = searchResponse.value.results
        .filter((r) => !r.source || r.source === 'clawhub')
        .map((r) => convertSearchResultToPackageItem(r, enrichmentBySlug.get(r.slug)));
      if (params.sort === 'downloads') {
        rows = [...rows].sort((a, b) => b.downloads - a.downloads);
      } else if (params.sort === 'newest') {
        rows = [...rows].sort((a, b) => Number(b.updatedAt) - Number(a.updatedAt));
      }
      const total = rows.length;
      const start = (page - 1) * pageSize;
      const items = rows.slice(start, start + pageSize);
      const totalPages = Math.max(1, Math.ceil(total / pageSize));
      return { items, meta: { page, pageSize, total, totalPages }, provider: 'clawhub' };
    }

    const sort = mapSortParam(params.sort);
    const listResponse = await cachedListClawHubSkills({ limit: LIST_BATCH_SIZE, sort });
    const rows = listResponse.items.map(convertListItemToPackageItem);
    const total = rows.length;
    const start = (page - 1) * pageSize;
    const items = rows.slice(start, start + pageSize);
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    return { items, meta: { page, pageSize, total, totalPages }, provider: 'clawhub' };
  },

  async getPackageDetail(_config, packageName) {
    const detail = await cachedGetClawHubSkillDetail(packageName);
    const slug = detail.skill.slug;
    const version = detail.latestVersion.version;

    let readme: string | null = null;

    try {
      const versionDetail = await getClawHubVersionDetail(slug, version);
      const docPath = pickClawHubDocFilePath(versionDetail.version.files);
      if (docPath) {
        const rawText = await getClawHubSkillFileText(slug, docPath, version);
        const trimmed = rawText.trim();
        if (trimmed) readme = trimmed;
      }
    } catch {
      // version detail or file fetch failed — use fallback
    }

    if (!readme) {
      readme = fallbackReadmeMarkdown(detail);
    }

    const changelog = detail.latestVersion.changelog?.trim();
    if (changelog) {
      readme = `${readme}\n\n---\n\n## Changelog\n\n${changelog}`;
    }

    const description = detail.skill.summary || '';
    const skillDocPreview = buildSkillMarkdownPreviewFromRaw(readme, {
      name: slug,
      description,
    });

    return {
      id: slug,
      name: slug,
      type: 'skill',
      description,
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
      provider: 'clawhub',
    };
  },

  async downloadPackage(_config, packageName, version) {
    const result = await downloadClawHubSkillZip(packageName, version);
    return {
      buffer: result.buffer,
      skillId: result.slug,
      version: result.version,
    };
  },
};

registerMarketplaceAdapter({
  adapter: clawHubMarketplaceAdapter,
  displayName: 'ClawHub',
});
