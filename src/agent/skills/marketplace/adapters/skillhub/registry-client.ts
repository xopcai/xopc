/**
 * HTTP client for api.skillhub.cn (registry: detail, files, versions, batch, skillsets, download).
 */

import { fetch } from 'undici';
import { MAX_SKILL_ZIP_BYTES } from '../../../managed-store.js';

const SKILLHUB_API_BASE = 'https://api.skillhub.cn';

/** Max bytes when fetching SKILL.md / README for marketplace preview (redirects to COS). */
export const MAX_SKILLHUB_README_BYTES = 512 * 1024;

function basenameSkillPath(p: string): string {
  const norm = p.replace(/\\/g, '/');
  const parts = norm.split('/');
  return parts[parts.length - 1] || norm;
}

/**
 * Prefer SKILL.md, then README.md, then HOW_TO_USE.md (basename match, any directory depth).
 */
export function pickSkillHubDocFilePath(files: SkillHubFile[]): string | null {
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
  try {
    u = new URL(finalUrl);
  } catch {
    throw new Error('Invalid SkillHub file response URL');
  }
  if (u.protocol !== 'https:') {
    throw new Error('SkillHub file response must use HTTPS');
  }
  const host = u.hostname.toLowerCase();
  if (host === 'api.skillhub.cn') return;
  if (host.endsWith('.myqcloud.com')) return;
  throw new Error('SkillHub file redirect host is not allowlisted');
}

/**
 * Fetches a single text file from the registry (follows redirect to COS when applicable).
 */
export async function getSkillHubSkillFileText(
  slug: string,
  filePath: string,
  version?: string,
): Promise<string> {
  const enc = encodeURIComponent(slug.trim());
  const normPath = filePath.replace(/\\/g, '/');
  const sp = new URLSearchParams({ path: normPath });
  if (version?.trim()) sp.set('version', version.trim());
  const url = `${SKILLHUB_API_BASE}/api/v1/skills/${enc}/file?${sp.toString()}`;
  const res = await fetch(url, {
    redirect: 'follow',
    headers: { Accept: 'text/markdown,text/plain,*/*' },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let msg = `SkillHub file request failed (${res.status})`;
    try {
      const j = JSON.parse(text) as { message?: string; error?: string };
      if (typeof j.message === 'string') msg = j.message;
      else if (typeof j.error === 'string') msg = j.error;
    } catch {
      if (text) msg = text.slice(0, 200);
    }
    throw new Error(msg);
  }
  assertSkillHubReadmeResponseUrl(res.url);
  const len = res.headers.get('content-length');
  if (len) {
    const n = Number(len);
    if (Number.isFinite(n) && n > MAX_SKILLHUB_README_BYTES) {
      throw new Error(`SkillHub file exceeds maximum size (${MAX_SKILLHUB_README_BYTES} bytes)`);
    }
  }
  const ab = await res.arrayBuffer();
  if (ab.byteLength > MAX_SKILLHUB_README_BYTES) {
    throw new Error(`SkillHub file exceeds maximum size (${MAX_SKILLHUB_README_BYTES} bytes)`);
  }
  return new TextDecoder('utf-8').decode(ab);
}

/** skillhub.cn skill metadata */
export interface SkillHubSkill {
  slug: string;
  displayName: string;
  summary: string;
  summary_zh?: string;
  category: string;
  iconUrl: string | null;
  source: string;
  labels: {
    requires_api_key?: string;
  };
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

export interface SkillHubSkillDetail {
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
  owner: {
    handle: string;
    displayName: string;
    image: string | null;
  };
}

export interface SkillHubFile {
  path: string;
  sha256: string;
  size: number;
}

export interface SkillHubVersion {
  slug: string;
  version: string;
  createdAt: number;
  changelog: string | null;
  securityReports?: {
    keen?: { status: string; statusText: string; reportUrl?: string };
    sanbu?: { status: string; statusText: string; reportUrl?: string };
  };
}

export interface SkillHubSkillset {
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

export interface SkillHubSkillsetListResponse {
  skillSets: SkillHubSkillset[];
  total: number;
}

/** Official taxonomy from GET /api/v1/categories (registry). */
export interface SkillHubRegistryCategoryItem {
  key: string;
  name: string;
  nameEn: string;
  sortOrder: number;
  active: boolean;
}

/**
 * SkillHub registry category taxonomy (ids align with {@link SkillHubSkill.category}).
 */
export async function listSkillHubRegistryCategories(): Promise<SkillHubRegistryCategoryItem[]> {
  const raw = await fetchJson<{ count?: number; items?: SkillHubRegistryCategoryItem[] }>(
    `${SKILLHUB_API_BASE}/api/v1/categories`,
  );
  const items = Array.isArray(raw.items) ? raw.items : [];
  return items.filter(
    (c) =>
      c &&
      typeof c.key === 'string' &&
      c.key.trim().length > 0 &&
      (c as SkillHubRegistryCategoryItem).active !== false,
  );
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init?.headers as Record<string, string> | undefined),
    },
  });
  const text = await res.text();
  if (!res.ok) {
    let msg = `SkillHub request failed (${res.status})`;
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
    throw new Error('SkillHub returned invalid JSON');
  }
}

export async function getSkillHubSkill(slug: string): Promise<SkillHubSkillDetail> {
  const enc = encodeURIComponent(slug.trim());
  const url = `${SKILLHUB_API_BASE}/api/v1/skills/${enc}`;
  return fetchJson<SkillHubSkillDetail>(url);
}

export async function getSkillHubSkillFiles(
  slug: string,
  version?: string,
): Promise<{ files: SkillHubFile[]; version: string }> {
  const enc = encodeURIComponent(slug.trim());
  const sp = version ? `?version=${encodeURIComponent(version)}` : '';
  const url = `${SKILLHUB_API_BASE}/api/v1/skills/${enc}/files${sp}`;
  return fetchJson<{ files: SkillHubFile[]; version: string }>(url);
}

export async function getSkillHubSkillVersions(slug: string): Promise<SkillHubVersion[]> {
  const enc = encodeURIComponent(slug.trim());
  const url = `${SKILLHUB_API_BASE}/api/v1/skills/${enc}/versions`;
  return fetchJson<SkillHubVersion[]>(url);
}

export async function downloadSkillHubZipBuffer(
  slug: string,
  version?: string,
): Promise<{ buffer: Buffer; version: string }> {
  const enc = encodeURIComponent(slug.trim());
  let url = `${SKILLHUB_API_BASE}/api/v1/download?slug=${enc}`;
  if (version?.trim()) {
    url += `&version=${encodeURIComponent(version.trim())}`;
  }

  const res = await fetch(url, { redirect: 'follow' });
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

  let resolvedVersion = version ?? '1.0.0';
  if (!version?.trim()) {
    try {
      const files = await getSkillHubSkillFiles(slug);
      resolvedVersion = files.version;
    } catch {
      // Use default version
    }
  }

  return { buffer: buf, version: resolvedVersion };
}

export interface SkillHubSkillsetListParams {
  page?: number;
  pageSize?: number;
  keyword?: string;
  scene?: string;
}

export async function listSkillHubSkillsets(
  opts: SkillHubSkillsetListParams = {},
): Promise<SkillHubSkillsetListResponse> {
  const page = opts.page ?? 1;
  const pageSize = opts.pageSize ?? 20;
  const sp = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (opts.keyword?.trim()) sp.set('keyword', opts.keyword.trim());
  if (opts.scene?.trim()) sp.set('scene', opts.scene.trim());
  const url = `${SKILLHUB_API_BASE}/api/v1/skillsets?${sp.toString()}`;
  return fetchJson<SkillHubSkillsetListResponse>(url);
}

export async function getSkillHubSkillset(slug: string): Promise<SkillHubSkillset> {
  const enc = encodeURIComponent(slug.trim());
  const url = `${SKILLHUB_API_BASE}/api/v1/skillsets/${enc}`;
  return fetchJson<SkillHubSkillset>(url);
}

export async function batchGetSkillHubSkills(slugs: string[]): Promise<SkillHubSkillDetail[]> {
  if (slugs.length === 0) return [];

  const response = await fetchJson<{ count: number; items: SkillHubSkillDetail[]; missing: string[] }>(
    `${SKILLHUB_API_BASE}/api/v1/skills/batch`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slugs }),
    },
  );
  return response.items ?? [];
}

const SKILLSET_DISCOVERY_PAGE_CAP = 25;
const MAX_DEFAULT_SLUGS = 200;

export async function getDefaultSkillSlugs(): Promise<string[]> {
  const slugs = new Set<string>();
  let page = 1;
  const pageSize = 50;
  let total = Infinity;
  while (page <= SKILLSET_DISCOVERY_PAGE_CAP && slugs.size < MAX_DEFAULT_SLUGS) {
    const response = await listSkillHubSkillsets({ page, pageSize });
    total = response.total;
    for (const skillset of response.skillSets) {
      for (const slug of skillset.skillSlugs) {
        slugs.add(slug);
      }
    }
    if (page * pageSize >= total) break;
    page += 1;
  }
  return Array.from(slugs).slice(0, MAX_DEFAULT_SLUGS);
}

export async function searchSkillHubSkills(
  query: string,
  maxSlugs = 200,
): Promise<{ slugs: string[]; total: number }> {
  const keyword = query.trim();
  if (!keyword) {
    return { slugs: [], total: 0 };
  }

  const slugs: string[] = [];
  const seen = new Set<string>();
  let page = 1;
  const batchSize = 50;

  while (page <= SKILLSET_DISCOVERY_PAGE_CAP) {
    const response = await listSkillHubSkillsets({ page, pageSize: batchSize, keyword });
    const totalSkillsets = response.total;
    for (const skillset of response.skillSets) {
      for (const slug of skillset.skillSlugs) {
        if (!seen.has(slug)) {
          seen.add(slug);
          slugs.push(slug);
        }
      }
    }
    if (page * batchSize >= totalSkillsets) break;
    page += 1;
  }

  const capped = slugs.slice(0, maxSlugs);
  return { slugs: capped, total: capped.length };
}
