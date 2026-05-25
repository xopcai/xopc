/**
 * SkillHub Extension — skillhub.cn skills marketplace adapter.
 *
 * Registers a marketplace adapter so users can browse, search and install
 * skills from skillhub.cn directly in the XOPC gateway console.
 */

import type { ExtensionApi } from 'xopc/extension-sdk';
import { fetch, type RequestInit } from 'undici';
import { basename } from 'node:path';

// ─── Constants ───────────────────────────────────────────────────────────────

const SKILLHUB_API_BASE = 'https://api.skillhub.cn';
const MAX_SKILL_ZIP_BYTES = 15 * 1024 * 1024;
const MAX_SKILLHUB_README_BYTES = 512 * 1024;
const SKILL_ID_RE = /^[a-zA-Z0-9]([a-zA-Z0-9._-]{0,62})$/;
const REGISTRY_SKILL_BATCH_CHUNK = 80;

const DEFAULT_SKILLS_INDEX_URL = 'https://skillhub-1388575217.cos.ap-guangzhou.myqcloud.com/skills.json';
const DEFAULT_SEARCH_URL = 'https://lightmake.site/api/v1/search';
const DEFAULT_PRIMARY_DOWNLOAD_TEMPLATE = 'https://lightmake.site/api/v1/download?slug={slug}';
const DEFAULT_FALLBACK_DOWNLOAD_TEMPLATE =
  'https://skillhub-1388575217.cos.ap-guangzhou.myqcloud.com/skills/{slug}.zip';
const DEFAULT_ALLOWED_DOWNLOAD_HOSTS = new Set([
  'lightmake.site',
  'api.skillhub.cn',
  'skillhub-1388575217.cos.ap-guangzhou.myqcloud.com',
]);
const LIGHTMAKE_SEARCH_MAX = 100;
const SKILLSET_DISCOVERY_PAGE_CAP = 25;
const MAX_DEFAULT_SLUGS = 200;

const DEFAULT_CACHE_MS = 5 * 60 * 1000;
const MAX_BATCH_CACHE_KEYS = 48;

// ─── Inline helpers ──────────────────────────────────────────────────────────

function isValidSkillId(id: string): boolean {
  return SKILL_ID_RE.test(id);
}

// ─── Category order (from marketplace-category-order.ts) ─────────────────────

interface CategoryOption { id: string; label: string }

const CATCH_ALL_ID = new Set(['other', 'others', 'misc', 'miscellaneous']);
const CATCH_ALL_LABEL = new Set(['其他', 'other', 'others', 'misc', 'miscellaneous']);

function isMarketplaceCatchAllCategory(category: CategoryOption): boolean {
  return CATCH_ALL_ID.has(category.id.trim().toLowerCase()) ||
    CATCH_ALL_LABEL.has(category.label.trim().toLowerCase());
}

function sortMarketplaceCategories<T extends CategoryOption>(
  items: T[],
  compare: (a: T, b: T) => number,
): T[] {
  const regular: T[] = [];
  const catchAll: T[] = [];
  for (const item of items) {
    (isMarketplaceCatchAllCategory(item) ? catchAll : regular).push(item);
  }
  regular.sort(compare);
  catchAll.sort(compare);
  return [...regular, ...catchAll];
}

// ─── SkillHub registry types ─────────────────────────────────────────────────

interface SkillHubSkill {
  slug: string;
  displayName: string;
  summary: string;
  summary_zh?: string;
  category: string;
  iconUrl: string | null;
  source: string;
  labels: { requires_api_key?: string };
  stats: {
    downloads: number;
    installs: number;
    stars: number;
    comments: number;
    versions: number;
  };
  createdAt: number;
  updatedAt: number;
  tags: Record<string, string>;
}

interface SkillHubSkillDetail {
  skill: SkillHubSkill;
  latestVersion: {
    version: string;
    changelog: string | null;
    createdAt: number;
    securityReports?: {
      keen?: { status: string; statusText: string; reportUrl?: string };
      sanbu?: { status: string; statusText: string; reportUrl?: string };
    };
  };
  owner: { handle: string; displayName: string; image: string | null };
}

interface SkillHubFile { path: string; sha256: string; size: number }

interface SkillHubRegistryCategoryItem {
  key: string;
  name: string;
  nameEn: string;
  sortOrder: number;
  active: boolean;
}

interface SkillHubSkillset {
  id: number;
  slug: string;
  displayName: string;
  summary: string;
  scene: string;
  subScene: string;
  content: string;
  skillSlugs: string[];
  skillCount: number;
  createdAt: number;
  updatedAt: number;
}

// ─── Ecosystem types ─────────────────────────────────────────────────────────

interface EcosystemUrls {
  skillsIndexUrl: string;
  searchUrl: string;
  primaryDownloadTemplate: string;
  fallbackDownloadTemplate: string;
}

interface CuratedIndexSkill {
  rank?: number;
  slug: string;
  name?: string;
  description?: string;
  version?: string;
  homepage?: string;
  downloads?: number;
  stars?: number;
  score?: number;
  categories?: string[];
}

interface CuratedIndex {
  total?: number;
  skills: CuratedIndexSkill[];
}

interface LightmakeSearchHit {
  slug: string;
  displayName?: string;
  name?: string;
  summary?: string;
  description?: string;
  description_zh?: string;
  version?: string;
  downloads?: number;
  installs?: number;
  stars?: number;
  owner_name?: string;
  category?: string;
  score?: number;
  updatedAt?: number;
  updated_at?: number;
}

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

// ─── Registry HTTP helpers ───────────────────────────────────────────────────

async function registryFetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { Accept: 'application/json', ...(init?.headers as Record<string, string> | undefined) },
  });
  const text = await res.text();
  if (!res.ok) {
    let msg = `SkillHub request failed (${res.status})`;
    try {
      const j = JSON.parse(text) as { message?: string; error?: string };
      if (j.message) msg = j.message;
      else if (j.error) msg = j.error;
    } catch { if (text) msg = text.slice(0, 200); }
    throw new Error(msg);
  }
  try { return JSON.parse(text) as T; }
  catch { throw new Error('SkillHub returned invalid JSON'); }
}

function basenameSkillPath(p: string): string {
  const norm = p.replace(/\\/g, '/');
  const parts = norm.split('/');
  return parts[parts.length - 1] || norm;
}

function pickSkillHubDocFilePath(files: SkillHubFile[]): string | null {
  const rows = files.map((f) => ({
    path: f.path.replace(/\\/g, '/'),
    base: basenameSkillPath(f.path).toLowerCase(),
  }));
  const firstBase = (name: string) => rows.find((r) => r.base === name.toLowerCase());
  const skillMd = firstBase('SKILL.md') ?? firstBase('skill.md');
  if (skillMd) return skillMd.path;
  const readme = firstBase('README.md') ?? firstBase('readme.md');
  if (readme) return readme.path;
  const how = firstBase('HOW_TO_USE.md');
  if (how) return how.path;
  return null;
}

function assertSkillHubReadmeResponseUrl(finalUrl: string): void {
  let u: URL;
  try { u = new URL(finalUrl); } catch { throw new Error('Invalid SkillHub file response URL'); }
  if (u.protocol !== 'https:') throw new Error('SkillHub file response must use HTTPS');
  const host = u.hostname.toLowerCase();
  if (host === 'api.skillhub.cn') return;
  if (host.endsWith('.myqcloud.com')) return;
  throw new Error('SkillHub file redirect host is not allowlisted');
}

async function getSkillHubSkillFileText(slug: string, filePath: string, version?: string): Promise<string> {
  const enc = encodeURIComponent(slug.trim());
  const normPath = filePath.replace(/\\/g, '/');
  const sp = new URLSearchParams({ path: normPath });
  if (version?.trim()) sp.set('version', version.trim());
  const url = `${SKILLHUB_API_BASE}/api/v1/skills/${enc}/file?${sp.toString()}`;
  const res = await fetch(url, { redirect: 'follow', headers: { Accept: 'text/markdown,text/plain,*/*' } });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let msg = `SkillHub file request failed (${res.status})`;
    try {
      const j = JSON.parse(text) as { message?: string; error?: string };
      if (typeof j.message === 'string') msg = j.message;
      else if (typeof j.error === 'string') msg = j.error;
    } catch { if (text) msg = text.slice(0, 200); }
    throw new Error(msg);
  }
  assertSkillHubReadmeResponseUrl(res.url);
  const len = res.headers.get('content-length');
  if (len) {
    const n = Number(len);
    if (Number.isFinite(n) && n > MAX_SKILLHUB_README_BYTES) throw new Error(`SkillHub file exceeds max size`);
  }
  const ab = await res.arrayBuffer();
  if (ab.byteLength > MAX_SKILLHUB_README_BYTES) throw new Error(`SkillHub file exceeds max size`);
  return new TextDecoder('utf-8').decode(ab);
}

async function getSkillHubSkill(slug: string): Promise<SkillHubSkillDetail> {
  return registryFetchJson<SkillHubSkillDetail>(`${SKILLHUB_API_BASE}/api/v1/skills/${encodeURIComponent(slug.trim())}`);
}

async function getSkillHubSkillFiles(slug: string, version?: string): Promise<{ files: SkillHubFile[]; version: string }> {
  const enc = encodeURIComponent(slug.trim());
  const sp = version ? `?version=${encodeURIComponent(version)}` : '';
  return registryFetchJson<{ files: SkillHubFile[]; version: string }>(`${SKILLHUB_API_BASE}/api/v1/skills/${enc}/files${sp}`);
}

async function downloadSkillHubZipBuffer(slug: string, version?: string): Promise<{ buffer: Buffer; version: string }> {
  const enc = encodeURIComponent(slug.trim());
  let url = `${SKILLHUB_API_BASE}/api/v1/download?slug=${enc}`;
  if (version?.trim()) url += `&version=${encodeURIComponent(version.trim())}`;
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`Failed to download skill archive (${res.status})`);
  const len = res.headers.get('content-length');
  if (len) { const n = Number(len); if (Number.isFinite(n) && n > MAX_SKILL_ZIP_BYTES) throw new Error(`Zip exceeds max size`); }
  const ab = await res.arrayBuffer();
  const buf = Buffer.from(ab);
  if (buf.length > MAX_SKILL_ZIP_BYTES) throw new Error(`Zip exceeds max size`);
  let resolvedVersion = version ?? '1.0.0';
  if (!version?.trim()) {
    try { resolvedVersion = (await getSkillHubSkillFiles(slug)).version; } catch { /* keep default */ }
  }
  return { buffer: buf, version: resolvedVersion };
}

async function batchGetSkillHubSkills(slugs: string[]): Promise<SkillHubSkillDetail[]> {
  if (slugs.length === 0) return [];
  const response = await registryFetchJson<{ count: number; items: SkillHubSkillDetail[]; missing: string[] }>(
    `${SKILLHUB_API_BASE}/api/v1/skills/batch`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slugs }) },
  );
  return response.items ?? [];
}

async function listSkillHubRegistryCategories(): Promise<SkillHubRegistryCategoryItem[]> {
  const raw = await registryFetchJson<{ count?: number; items?: SkillHubRegistryCategoryItem[] }>(
    `${SKILLHUB_API_BASE}/api/v1/categories`,
  );
  const items = Array.isArray(raw.items) ? raw.items : [];
  return items.filter((c) => c && typeof c.key === 'string' && c.key.trim().length > 0 && c.active !== false);
}

async function listSkillHubSkillsets(opts: { page?: number; pageSize?: number; keyword?: string; scene?: string } = {}): Promise<{ skillSets: SkillHubSkillset[]; total: number }> {
  const page = opts.page ?? 1;
  const pageSize = opts.pageSize ?? 20;
  const sp = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (opts.keyword?.trim()) sp.set('keyword', opts.keyword.trim());
  if (opts.scene?.trim()) sp.set('scene', opts.scene.trim());
  return registryFetchJson<{ skillSets: SkillHubSkillset[]; total: number }>(`${SKILLHUB_API_BASE}/api/v1/skillsets?${sp.toString()}`);
}

async function getDefaultSkillSlugs(): Promise<string[]> {
  const slugs = new Set<string>();
  let page = 1;
  const pageSize = 50;
  let total = Infinity;
  while (page <= SKILLSET_DISCOVERY_PAGE_CAP && slugs.size < MAX_DEFAULT_SLUGS) {
    const response = await listSkillHubSkillsets({ page, pageSize });
    total = response.total;
    for (const skillset of response.skillSets) {
      for (const slug of skillset.skillSlugs) slugs.add(slug);
    }
    if (page * pageSize >= total) break;
    page += 1;
  }
  return Array.from(slugs).slice(0, MAX_DEFAULT_SLUGS);
}

async function searchSkillHubSkills(query: string, maxSlugs = 200): Promise<{ slugs: string[]; total: number }> {
  const keyword = query.trim();
  if (!keyword) return { slugs: [], total: 0 };
  const slugs: string[] = [];
  const seen = new Set<string>();
  let page = 1;
  const batchSize = 50;
  while (page <= SKILLSET_DISCOVERY_PAGE_CAP) {
    const response = await listSkillHubSkillsets({ page, pageSize: batchSize, keyword });
    for (const skillset of response.skillSets) {
      for (const slug of skillset.skillSlugs) {
        if (!seen.has(slug)) { seen.add(slug); slugs.push(slug); }
      }
    }
    if (page * batchSize >= response.total) break;
    page += 1;
  }
  const capped = slugs.slice(0, maxSlugs);
  return { slugs: capped, total: capped.length };
}

// ─── Ecosystem helpers ───────────────────────────────────────────────────────

function templateWithSlug(template: string, slug: string): string {
  const raw = template.trim();
  if (!raw) return '';
  if (raw.includes('{slug}')) return raw.replaceAll('{slug}', encodeURIComponent(slug.trim()));
  const base = raw.replace(/\/$/, '');
  return `${base}/${encodeURIComponent(slug.trim())}.zip`;
}

function hostFromTemplate(template: string): string | undefined {
  const t = templateWithSlug(template, 'x');
  try { return new URL(t).hostname.toLowerCase(); } catch { return undefined; }
}

function resolveSkillHubEcosystemUrls(): EcosystemUrls {
  return {
    skillsIndexUrl: process.env.XOPC_SKILLHUB_SKILLS_INDEX_URL?.trim() || DEFAULT_SKILLS_INDEX_URL,
    searchUrl: process.env.XOPC_SKILLHUB_SEARCH_URL?.trim() || DEFAULT_SEARCH_URL,
    primaryDownloadTemplate: process.env.XOPC_SKILLHUB_PRIMARY_DOWNLOAD_TEMPLATE?.trim() || DEFAULT_PRIMARY_DOWNLOAD_TEMPLATE,
    fallbackDownloadTemplate: process.env.XOPC_SKILLHUB_FALLBACK_DOWNLOAD_TEMPLATE?.trim() || DEFAULT_FALLBACK_DOWNLOAD_TEMPLATE,
  };
}

function allowedDownloadHosts(urls: EcosystemUrls): Set<string> {
  const hosts = new Set(DEFAULT_ALLOWED_DOWNLOAD_HOSTS);
  for (const h of [hostFromTemplate(urls.primaryDownloadTemplate), hostFromTemplate(urls.fallbackDownloadTemplate)]) { if (h) hosts.add(h); }
  try { hosts.add(new URL(urls.skillsIndexUrl).hostname.toLowerCase()); } catch { /* ignore */ }
  try { hosts.add(new URL(urls.searchUrl).hostname.toLowerCase()); } catch { /* ignore */ }
  return hosts;
}

function assertSkillHubDownloadUrlAllowed(downloadUrl: string, urls: EcosystemUrls): URL {
  let u: URL;
  try { u = new URL(downloadUrl); } catch { throw new Error('Invalid SkillHub download URL'); }
  if (u.protocol !== 'https:') throw new Error('SkillHub download URL must use HTTPS');
  if (!allowedDownloadHosts(urls).has(u.hostname.toLowerCase())) throw new Error('SkillHub download URL host is not allowlisted');
  return u;
}

async function ecoFetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { Accept: 'application/json', ...init?.headers } });
  const text = await res.text();
  if (!res.ok) {
    let msg = `SkillHub ecosystem request failed (${res.status})`;
    try { const j = JSON.parse(text) as { message?: string; error?: string }; if (j.message) msg = j.message; else if (j.error) msg = j.error; } catch { if (text) msg = text.slice(0, 200); }
    throw new Error(msg);
  }
  try { return JSON.parse(text) as T; } catch { throw new Error('SkillHub ecosystem returned invalid JSON'); }
}

async function fetchSkillHubCuratedIndex(urls: EcosystemUrls): Promise<CuratedIndex> {
  const raw = await ecoFetchJson<unknown>(urls.skillsIndexUrl);
  if (Array.isArray(raw)) return { skills: raw as CuratedIndexSkill[] };
  if (raw && typeof raw === 'object' && Array.isArray((raw as CuratedIndex).skills)) return raw as CuratedIndex;
  throw new Error('SkillHub index JSON must be an object with a skills array');
}

function sourceLabelFromHomepage(homepage?: string): string | undefined {
  const h = homepage?.trim().toLowerCase() ?? '';
  if (h.includes('clawhub')) return 'ClawHub';
  if (h.includes('skillhub')) return 'SkillHub';
  return undefined;
}

function curatedSkillsToPackageItems(skills: CuratedIndexSkill[]): PackageListItem[] {
  return skills.map((s) => ({
    id: s.slug,
    name: (s.name ?? s.slug).trim() || s.slug,
    type: 'skill',
    description: (s.description ?? '').trim(),
    downloads: typeof s.downloads === 'number' ? s.downloads : 0,
    author: { username: 'skillhub', avatarUrl: null },
    latestVersion: (s.version ?? '').trim() || undefined,
    updatedAt: String(s.rank ?? s.score ?? 0),
    categories: (s.categories ?? []).map((c) => String(c).trim()).filter(Boolean),
    stars: typeof s.stars === 'number' ? s.stars : undefined,
    sourceLabel: sourceLabelFromHomepage(s.homepage),
  }));
}

async function findCuratedIndexSkill(slug: string): Promise<CuratedIndexSkill | null> {
  const want = slug.trim();
  if (!want) return null;
  const ecoUrls = resolveSkillHubEcosystemUrls();
  try {
    const idx = await cachedFetchSkillHubCuratedIndex(ecoUrls);
    return idx.skills.find((s) => s.slug?.trim() === want) ?? null;
  } catch {
    return null;
  }
}

function curatedSkillFallbackReadmeMarkdown(skill: CuratedIndexSkill): string {
  const title = (skill.name ?? skill.slug).trim() || skill.slug;
  const desc = (skill.description ?? '').trim() || '_No description._';
  const version = (skill.version ?? '').trim() || '1.0.0';
  return `## ${title}\n\n**${skill.slug}** · v${version}\n\n${desc}`;
}

function packageDetailFromCuratedSkill(skill: CuratedIndexSkill) {
  const slug = skill.slug.trim();
  const version = (skill.version ?? '').trim() || '1.0.0';
  const categories = (skill.categories ?? []).map((c) => String(c).trim()).filter(Boolean);
  const sourceLabel = sourceLabelFromHomepage(skill.homepage);
  return {
    id: slug,
    name: (skill.name ?? slug).trim() || slug,
    type: 'skill',
    description: (skill.description ?? '').trim(),
    readme: curatedSkillFallbackReadmeMarkdown(skill),
    downloads: typeof skill.downloads === 'number' ? skill.downloads : 0,
    author: {
      username: sourceLabel?.toLowerCase() ?? 'skillhub',
      avatarUrl: null,
    },
    latestVersion: {
      version,
      changelog: null,
      publishedAt: String(skill.rank ?? skill.score ?? 0),
    },
    provider: 'skillhub',
    skillHubInfo: {
      category: categories[0] ?? '',
      installs: 0,
      stars: typeof skill.stars === 'number' ? skill.stars : 0,
    },
  };
}

function lightmakeHitToPackageItem(hit: LightmakeSearchHit): PackageListItem {
  const slug = String(hit.slug || '').trim();
  const desc = (hit.summary ?? hit.description_zh ?? hit.description ?? '').trim() || '';
  const updated = hit.updatedAt ?? hit.updated_at ?? 0;
  const cat = hit.category?.trim();
  return {
    id: slug,
    name: (hit.displayName ?? hit.name ?? slug).trim() || slug,
    type: 'skill',
    description: desc,
    downloads: typeof hit.downloads === 'number' ? hit.downloads : 0,
    author: { username: (hit.owner_name ?? 'skillhub').trim() || 'skillhub', avatarUrl: null },
    latestVersion: (hit.version ?? '').trim() || undefined,
    updatedAt: String(updated),
    categories: cat ? [cat] : [],
    stars: typeof hit.stars === 'number' ? hit.stars : undefined,
    sourceLabel: 'Lightmake',
  };
}

async function searchSkillHubLightmake(urls: EcosystemUrls, query: string, limit: number, timeoutMs = 8000): Promise<PackageListItem[]> {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const search = new URL(urls.searchUrl);
  if (search.protocol !== 'https:') throw new Error('SkillHub search URL must use HTTPS');
  search.searchParams.set('q', q);
  search.searchParams.set('limit', String(Math.max(1, Math.min(LIGHTMAKE_SEARCH_MAX, limit))));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const raw = await ecoFetchJson<{ results?: LightmakeSearchHit[] }>(search.toString(), { signal: controller.signal });
    const results = raw.results;
    if (!Array.isArray(results)) return [];
    const out: PackageListItem[] = [];
    for (const item of results) {
      if (!item || typeof item !== 'object') continue;
      const slug = String((item as LightmakeSearchHit).slug ?? '').trim();
      if (!slug) continue;
      out.push(lightmakeHitToPackageItem(item as LightmakeSearchHit));
    }
    return out;
  } finally { clearTimeout(timer); }
}

async function downloadSkillHubZipFromAllowlistedUrl(urls: EcosystemUrls, downloadUrl: string): Promise<Buffer> {
  const normalized = assertSkillHubDownloadUrlAllowed(downloadUrl, urls);
  const res = await fetch(normalized.toString(), { redirect: 'follow' });
  if (!res.ok) throw new Error(`Failed to download skill archive (${res.status})`);
  const len = res.headers.get('content-length');
  if (len) { const n = Number(len); if (Number.isFinite(n) && n > MAX_SKILL_ZIP_BYTES) throw new Error(`Zip exceeds max size`); }
  const ab = await res.arrayBuffer();
  const buf = Buffer.from(ab);
  if (buf.length > MAX_SKILL_ZIP_BYTES) throw new Error(`Zip exceeds max size`);
  return buf;
}

async function downloadSkillHubZipFromEcosystem(urls: EcosystemUrls, slug: string): Promise<Buffer> {
  const primary = templateWithSlug(urls.primaryDownloadTemplate, slug);
  const fallback = templateWithSlug(urls.fallbackDownloadTemplate, slug);
  const candidates = [primary, fallback].filter(Boolean);
  const seen = new Set<string>();
  let lastErr: Error | undefined;
  for (const url of candidates) {
    if (seen.has(url)) continue;
    seen.add(url);
    try { return await downloadSkillHubZipFromAllowlistedUrl(urls, url); }
    catch (e) { lastErr = e instanceof Error ? e : new Error(String(e)); }
  }
  throw lastErr ?? new Error('SkillHub ecosystem download failed');
}

// ─── In-memory TTL cache ─────────────────────────────────────────────────────

type CacheEntry<T> = { value: T; expiresAt: number };

function cacheTtlMs(): number {
  const raw = process.env.XOPC_SKILLHUB_CACHE_MS?.trim();
  if (raw === '0' || raw === 'false') return 0;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_CACHE_MS;
  return n;
}

function getFresh<T>(entry: CacheEntry<T> | undefined): T | undefined {
  if (!entry || entry.expiresAt <= Date.now()) return undefined;
  return entry.value;
}

const curatedByIndexUrl = new Map<string, CacheEntry<CuratedIndex>>();
let defaultSlugsEntry: CacheEntry<string[]> | undefined;
let registryCategoriesEntry: CacheEntry<SkillHubRegistryCategoryItem[]> | undefined;
const batchBySlugsKey = new Map<string, CacheEntry<SkillHubSkillDetail[]>>();

function evictOldestBatchKey(): void {
  const first = batchBySlugsKey.keys().next().value;
  if (first !== undefined) batchBySlugsKey.delete(first);
}

function batchSlugsCacheKey(slugs: string[]): string {
  if (slugs.length === 0) return '';
  return [...slugs].sort().join('\n');
}

async function cachedFetchSkillHubCuratedIndex(urls: EcosystemUrls): Promise<CuratedIndex> {
  const ttl = cacheTtlMs();
  const key = urls.skillsIndexUrl;
  if (ttl > 0) { const hit = getFresh(curatedByIndexUrl.get(key)); if (hit) return hit; }
  const value = await fetchSkillHubCuratedIndex(urls);
  if (ttl > 0) curatedByIndexUrl.set(key, { value, expiresAt: Date.now() + ttl });
  return value;
}

async function cachedGetDefaultSkillSlugs(): Promise<string[]> {
  const ttl = cacheTtlMs();
  if (ttl > 0) { const hit = getFresh(defaultSlugsEntry); if (hit) return hit; }
  const value = await getDefaultSkillSlugs();
  if (ttl > 0) defaultSlugsEntry = { value, expiresAt: Date.now() + ttl };
  return value;
}

async function cachedListSkillHubRegistryCategories(): Promise<SkillHubRegistryCategoryItem[]> {
  const ttl = cacheTtlMs();
  if (ttl > 0) { const hit = getFresh(registryCategoriesEntry); if (hit) return hit; }
  const value = await listSkillHubRegistryCategories();
  if (ttl > 0) registryCategoriesEntry = { value, expiresAt: Date.now() + ttl };
  return value;
}

async function cachedBatchGetSkillHubSkills(slugs: string[]): Promise<SkillHubSkillDetail[]> {
  if (slugs.length === 0) return [];
  const ttl = cacheTtlMs();
  const key = batchSlugsCacheKey(slugs);
  if (ttl > 0) { const hit = getFresh(batchBySlugsKey.get(key)); if (hit) return hit; }
  const value = await batchGetSkillHubSkills(slugs);
  if (ttl > 0) {
    while (batchBySlugsKey.size >= MAX_BATCH_CACHE_KEYS) evictOldestBatchKey();
    batchBySlugsKey.set(key, { value, expiresAt: Date.now() + ttl });
  }
  return value;
}

// ─── Adapter conversion helpers ──────────────────────────────────────────────

function humanizeRegistryCategoryKey(slug: string): string {
  return slug.replace(/_/g, '-').split('-').filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
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

function filterByCategory(rows: PackageListItem[], category?: string): PackageListItem[] {
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

function skillHubFallbackReadmeMarkdown(detail: { skill: SkillHubSkill; latestVersion: { version: string } }): string {
  const s = detail.skill;
  const title = s.displayName?.trim() || s.slug;
  const zh = s.summary_zh?.trim();
  const en = s.summary?.trim();
  const body = zh && en && zh !== en ? `${zh}\n\n${en}` : zh || en || '_No description._';
  return `## ${title}\n\n**${s.slug}** · v${detail.latestVersion.version}\n\n${body}`;
}

function convertSkillHubToPackageListItem(detail: SkillHubSkill): PackageListItem {
  const cat = detail.category?.trim();
  return {
    id: detail.slug,
    name: detail.displayName?.trim() || detail.slug,
    type: 'skill',
    description: detail.summary_zh || detail.summary,
    downloads: detail.stats.downloads,
    author: { username: detail.source || 'skillhub', avatarUrl: null },
    latestVersion: detail.tags.latest || '1.0.0',
    updatedAt: String(detail.updatedAt),
    categories: cat ? [cat] : [],
    stars: detail.stats.stars,
    sourceLabel: sourceLabelFromSkillSource(detail.source),
  };
}

// ─── Extension definition ────────────────────────────────────────────────────

const extension = {
  id: 'skillhub',
  name: 'SkillHub Marketplace',
  description: 'SkillHub (skillhub.cn) skills marketplace adapter',
  version: '1.0.0',
  kind: 'utility' as const,

  register(api: ExtensionApi) {
    api.registerMarketplaceAdapter({
      adapter: {
        id: 'skillhub',

        async listCategories(_config) {
          const sortByLabel = (a: CategoryOption, b: CategoryOption) =>
            a.label.localeCompare(b.label, 'zh-Hans-CN', { sensitivity: 'base' });
          const ecoUrls = resolveSkillHubEcosystemUrls();
          try {
            const idx = await cachedFetchSkillHubCuratedIndex(ecoUrls);
            if (idx.skills?.length) {
              const map = new Map<string, CategoryOption>();
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
          } catch { /* fall through: registry-backed catalog */ }
          try {
            const [taxonomy, slugs] = await Promise.all([
              cachedListSkillHubRegistryCategories(),
              cachedGetDefaultSkillSlugs(),
            ]);
            const usedKeys = await collectRegistryCategoryKeysFromSlugs(slugs);
            const taxByKey = new Map(taxonomy.map((t) => [t.key, t] as const));
            const options: CategoryOption[] = [];
            for (const key of usedKeys) {
              const t = taxByKey.get(key);
              const label = t?.name?.trim() || t?.nameEn?.trim() || humanizeRegistryCategoryKey(key).trim();
              if (!label) continue;
              options.push({ id: key, label });
            }
            return sortMarketplaceCategories(options, (a, b) => {
              const oa = taxByKey.get(a.id)?.sortOrder ?? 999;
              const ob = taxByKey.get(b.id)?.sortOrder ?? 999;
              if (oa !== ob) return oa - ob;
              return sortByLabel(a, b);
            });
          } catch { return []; }
        },

        async listPackages(_config, params) {
          const pageSize = params.pageSize ?? 20;
          const page = params.page ?? 1;
          const ecoUrls = resolveSkillHubEcosystemUrls();

          if (params.q?.trim()) {
            const q = params.q.trim();
            let rows: PackageListItem[] = [];
            try {
              rows = await searchSkillHubLightmake(ecoUrls, q, 100);
            } catch { rows = []; }
            if (rows.length === 0) {
              const searchResult = await searchSkillHubSkills(q, 200);
              const details = await cachedBatchGetSkillHubSkills(searchResult.slugs);
              rows = details.map((d) => convertSkillHubToPackageListItem(d.skill));
            }
            rows = filterByCategory(rows, params.category);
            if (params.sort === 'downloads') rows = [...rows].sort((a, b) => b.downloads - a.downloads);
            else if (params.sort === 'newest') rows = [...rows].sort((a, b) => Number(b.updatedAt) - Number(a.updatedAt));
            const total = rows.length;
            const start = (page - 1) * pageSize;
            const items = rows.slice(start, start + pageSize);
            const totalPages = Math.max(1, Math.ceil(total / pageSize));
            return { items, meta: { page, pageSize, total, totalPages }, provider: 'skillhub' };
          }

          try {
            const idx = await cachedFetchSkillHubCuratedIndex(ecoUrls);
            let skills = [...idx.skills].filter((s) => s.slug?.trim());
            if (params.category?.trim()) {
              const want = params.category.trim();
              skills = skills.filter((s) => (s.categories ?? []).some((x) => String(x).trim() === want));
            }
            if (params.sort === 'downloads') skills.sort((a, b) => (b.downloads ?? 0) - (a.downloads ?? 0));
            else if (params.sort === 'newest') skills.sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999));
            const rows = curatedSkillsToPackageItems(skills);
            const total = rows.length;
            const start = (page - 1) * pageSize;
            const items = rows.slice(start, start + pageSize);
            const totalPages = Math.max(1, Math.ceil(total / pageSize));
            return { items, meta: { page, pageSize, total, totalPages }, provider: 'skillhub' };
          } catch { /* fall through */ }

          const slugs = await cachedGetDefaultSkillSlugs();
          if (params.category?.trim()) {
            const details = await cachedBatchGetSkillHubSkills(slugs);
            let allItems = details.map((d) => convertSkillHubToPackageListItem(d.skill));
            allItems = filterByCategory(allItems, params.category);
            if (params.sort === 'downloads') allItems = [...allItems].sort((a, b) => b.downloads - a.downloads);
            else if (params.sort === 'newest') allItems = [...allItems].sort((a, b) => Number(b.updatedAt) - Number(a.updatedAt));
            const total = allItems.length;
            const start = (page - 1) * pageSize;
            const items = allItems.slice(start, start + pageSize);
            const totalPages = Math.max(1, Math.ceil(total / pageSize));
            return { items, meta: { page, pageSize, total, totalPages }, provider: 'skillhub' };
          }

          const total = slugs.length;
          const start = (page - 1) * pageSize;
          const paginatedSlugs = slugs.slice(start, start + pageSize);
          const totalPages = Math.max(1, Math.ceil(total / pageSize));
          const details = await cachedBatchGetSkillHubSkills(paginatedSlugs);
          const items = details.map((d) => convertSkillHubToPackageListItem(d.skill));
          return { items, meta: { page, pageSize, total, totalPages }, provider: 'skillhub' };
        },

        async getPackageDetail(_config, packageName) {
          const slug = packageName.trim();
          let detail: SkillHubSkillDetail;
          try {
            detail = await getSkillHubSkill(slug);
          } catch (registryErr) {
            const curated = await findCuratedIndexSkill(slug);
            if (curated) return packageDetailFromCuratedSkill(curated);
            throw registryErr;
          }
          const version = detail.latestVersion.version;
          const changelog = detail.latestVersion.changelog;

          let readme: string | null = null;
          let docPath: string | null = null;
          try {
            const { files } = await getSkillHubSkillFiles(slug, version);
            docPath = pickSkillHubDocFilePath(files);
            if (docPath) readme = await getSkillHubSkillFileText(slug, docPath, version);
          } catch { readme = null; }

          const trimmed = readme?.trim() ?? '';
          const docBase = docPath ? basename(docPath.replace(/\\/g, '/')).toLowerCase() : '';
          const isSkillMd = docBase === 'skill.md';

          if (!trimmed) {
            readme = skillHubFallbackReadmeMarkdown(detail);
          } else if (isSkillMd) {
            // Simplified: skip buildSkillMarkdownPreviewFromRaw, show raw SKILL.md
            readme = trimmed;
            if (changelog?.trim() && !isPipelineOnlyChangelog(changelog)) {
              readme = `${trimmed}\n\n---\n\n## Changelog\n\n${changelog.trim()}`;
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
            return { buffer, skillId: isValidSkillId(slug) ? slug : 'unknown', version: resolvedVersion };
          }
          const ecoUrls = resolveSkillHubEcosystemUrls();
          try {
            const buffer = await downloadSkillHubZipFromEcosystem(ecoUrls, slug);
            let resolvedVersion = '1.0.0';
            try { resolvedVersion = (await getSkillHubSkillFiles(slug)).version; } catch { /* keep default */ }
            return { buffer, skillId: isValidSkillId(slug) ? slug : 'unknown', version: resolvedVersion };
          } catch {
            const { buffer, version: resolvedVersion } = await downloadSkillHubZipBuffer(slug);
            return { buffer, skillId: isValidSkillId(slug) ? slug : 'unknown', version: resolvedVersion };
          }
        },
      },
      displayName: 'SkillHub',
    });

    api.logger.info('SkillHub marketplace adapter registered');
  },
};

export default extension;
