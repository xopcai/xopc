/**
 * SkillHub distribution layer (SkillHub CLI `metadata.json` defaults):
 * curated index on COS, lightmake search/download, COS static zip fallback.
 *
 * Registry HTTP: {@link ./registry-client.ts}.
 */

import { MAX_SKILL_ZIP_BYTES } from '../../../managed-store.js';

/** Same shape as store `MarketplacePackageListItem` (avoid importing store adapter). */
export interface SkillHubEcosystemListItem {
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

export interface SkillHubEcosystemUrls {
  skillsIndexUrl: string;
  searchUrl: string;
  primaryDownloadTemplate: string;
  fallbackDownloadTemplate: string;
}

function templateWithSlug(template: string, slug: string): string {
  const raw = template.trim();
  if (!raw) return '';
  if (raw.includes('{slug}')) {
    return raw.replaceAll('{slug}', encodeURIComponent(slug.trim()));
  }
  const base = raw.replace(/\/$/, '');
  return `${base}/${encodeURIComponent(slug.trim())}.zip`;
}

function hostFromTemplate(template: string): string | undefined {
  const t = templateWithSlug(template, 'x');
  try {
    return new URL(t).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

/**
 * SkillHub CLI–aligned endpoints (defaults match official `metadata.json`).
 * Optional env overrides for mirrors/testing only — not part of gateway config.
 */
export function resolveSkillHubEcosystemUrls(): SkillHubEcosystemUrls {
  return {
    skillsIndexUrl: process.env.XOPC_SKILLHUB_SKILLS_INDEX_URL?.trim() || DEFAULT_SKILLS_INDEX_URL,
    searchUrl: process.env.XOPC_SKILLHUB_SEARCH_URL?.trim() || DEFAULT_SEARCH_URL,
    primaryDownloadTemplate:
      process.env.XOPC_SKILLHUB_PRIMARY_DOWNLOAD_TEMPLATE?.trim() || DEFAULT_PRIMARY_DOWNLOAD_TEMPLATE,
    fallbackDownloadTemplate:
      process.env.XOPC_SKILLHUB_FALLBACK_DOWNLOAD_TEMPLATE?.trim() || DEFAULT_FALLBACK_DOWNLOAD_TEMPLATE,
  };
}

function allowedDownloadHosts(urls: SkillHubEcosystemUrls): Set<string> {
  const hosts = new Set(DEFAULT_ALLOWED_DOWNLOAD_HOSTS);
  for (const h of [hostFromTemplate(urls.primaryDownloadTemplate), hostFromTemplate(urls.fallbackDownloadTemplate)]) {
    if (h) hosts.add(h);
  }
  try {
    hosts.add(new URL(urls.skillsIndexUrl).hostname.toLowerCase());
  } catch {
    /* ignore */
  }
  try {
    hosts.add(new URL(urls.searchUrl).hostname.toLowerCase());
  } catch {
    /* ignore */
  }
  return hosts;
}

export function assertSkillHubDownloadUrlAllowed(downloadUrl: string, urls: SkillHubEcosystemUrls): URL {
  let u: URL;
  try {
    u = new URL(downloadUrl);
  } catch {
    throw new Error('Invalid SkillHub download URL');
  }
  if (u.protocol !== 'https:') {
    throw new Error('SkillHub download URL must use HTTPS');
  }
  const host = u.hostname.toLowerCase();
  if (!allowedDownloadHosts(urls).has(host)) {
    throw new Error('SkillHub download URL host is not allowlisted');
  }
  return u;
}

export interface SkillHubCuratedIndexSkill {
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

export interface SkillHubCuratedIndex {
  total?: number;
  skills: SkillHubCuratedIndexSkill[];
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { Accept: 'application/json', ...init?.headers },
  });
  const text = await res.text();
  if (!res.ok) {
    let msg = `SkillHub ecosystem request failed (${res.status})`;
    try {
      const j = JSON.parse(text) as { message?: string; error?: string };
      if (j.message) msg = j.message;
      else if (j.error) msg = j.error;
    } catch {
      if (text) msg = text.slice(0, 200);
    }
    throw new Error(msg);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error('SkillHub ecosystem returned invalid JSON');
  }
}

export async function fetchSkillHubCuratedIndex(urls: SkillHubEcosystemUrls): Promise<SkillHubCuratedIndex> {
  const raw = await fetchJson<unknown>(urls.skillsIndexUrl);
  if (Array.isArray(raw)) {
    return { skills: raw as SkillHubCuratedIndexSkill[] };
  }
  if (raw && typeof raw === 'object' && Array.isArray((raw as SkillHubCuratedIndex).skills)) {
    return raw as SkillHubCuratedIndex;
  }
  throw new Error('SkillHub index JSON must be an object with a skills array');
}

function sourceLabelFromHomepage(homepage?: string): string | undefined {
  const h = homepage?.trim().toLowerCase() ?? '';
  if (h.includes('clawhub')) return 'ClawHub';
  if (h.includes('skillhub')) return 'SkillHub';
  return undefined;
}

export function curatedSkillsToPackageItems(skills: SkillHubCuratedIndexSkill[]): SkillHubEcosystemListItem[] {
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

export interface LightmakeSearchHit {
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

function lightmakeHitToPackageItem(hit: LightmakeSearchHit): SkillHubEcosystemListItem {
  const slug = String(hit.slug || '').trim();
  const desc =
    (hit.summary ?? hit.description_zh ?? hit.description ?? '').trim() || '';
  const updated = hit.updatedAt ?? hit.updated_at ?? 0;
  const cat = hit.category?.trim();
  return {
    id: slug,
    name: (hit.displayName ?? hit.name ?? slug).trim() || slug,
    type: 'skill',
    description: desc,
    downloads: typeof hit.downloads === 'number' ? hit.downloads : 0,
    author: {
      username: (hit.owner_name ?? 'skillhub').trim() || 'skillhub',
      avatarUrl: null,
    },
    latestVersion: (hit.version ?? '').trim() || undefined,
    updatedAt: String(updated),
    categories: cat ? [cat] : [],
    stars: typeof hit.stars === 'number' ? hit.stars : undefined,
    sourceLabel: 'Lightmake',
  };
}

export async function searchSkillHubLightmake(
  urls: SkillHubEcosystemUrls,
  query: string,
  limit: number,
  timeoutMs = 8000,
): Promise<SkillHubEcosystemListItem[]> {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const search = new URL(urls.searchUrl);
  if (search.protocol !== 'https:') {
    throw new Error('SkillHub search URL must use HTTPS');
  }
  search.searchParams.set('q', q);
  search.searchParams.set('limit', String(Math.max(1, Math.min(LIGHTMAKE_SEARCH_MAX, limit))));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const raw = await fetchJson<{ results?: LightmakeSearchHit[] }>(search.toString(), {
      signal: controller.signal,
    });
    const results = raw.results;
    if (!Array.isArray(results)) {
      return [];
    }
    const out: SkillHubEcosystemListItem[] = [];
    for (const item of results) {
      if (!item || typeof item !== 'object') continue;
      const slug = String((item as LightmakeSearchHit).slug ?? '').trim();
      if (!slug) continue;
      out.push(lightmakeHitToPackageItem(item as LightmakeSearchHit));
    }
    return out;
  } finally {
    clearTimeout(timer);
  }
}

export async function downloadSkillHubZipFromAllowlistedUrl(
  urls: SkillHubEcosystemUrls,
  downloadUrl: string,
): Promise<Buffer> {
  const normalized = assertSkillHubDownloadUrlAllowed(downloadUrl, urls);
  const res = await fetch(normalized.toString(), { redirect: 'follow' });
  if (!res.ok) {
    throw new Error(`Failed to download skill archive (${res.status})`);
  }
  const len = res.headers.get('content-length');
  if (len) {
    const n = Number(len);
    if (Number.isFinite(n) && n > MAX_SKILL_ZIP_BYTES) {
      throw new Error(`Zip exceeds maximum size (${MAX_SKILL_ZIP_BYTES} bytes)`);
    }
  }
  const ab = await res.arrayBuffer();
  const buf = Buffer.from(ab);
  if (buf.length > MAX_SKILL_ZIP_BYTES) {
    throw new Error(`Zip exceeds maximum size (${MAX_SKILL_ZIP_BYTES} bytes)`);
  }
  return buf;
}

export async function downloadSkillHubZipFromEcosystem(
  urls: SkillHubEcosystemUrls,
  slug: string,
): Promise<Buffer> {
  const primary = templateWithSlug(urls.primaryDownloadTemplate, slug);
  const fallback = templateWithSlug(urls.fallbackDownloadTemplate, slug);
  const candidates = [primary, fallback].filter(Boolean);
  const seen = new Set<string>();
  let lastErr: Error | undefined;
  for (const url of candidates) {
    if (seen.has(url)) continue;
    seen.add(url);
    try {
      return await downloadSkillHubZipFromAllowlistedUrl(urls, url);
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
    }
  }
  throw lastErr ?? new Error('SkillHub ecosystem download failed');
}
