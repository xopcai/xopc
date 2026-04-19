/**
 * HTTP client for the public xopc-store REST API (skills marketplace).
 * Used by the gateway to proxy catalog/install (browser cannot call store directly due to CORS).
 */

import type { Config } from '../../config/schema.js';
import { isValidSkillId, MAX_SKILL_ZIP_BYTES } from './managed-store.js';

const DEFAULT_STORE_BASE = 'https://store.xopc.ai';

export interface SkillsStoreListParams {
  q?: string;
  page?: number;
  pageSize?: number;
  sort?: 'downloads' | 'newest';
}

/** Mirrors xopc-store GET /api/v1/packages list response (subset used by UI). */
export interface SkillsStorePackageListItem {
  id: string;
  name: string;
  type: string;
  description: string;
  downloads: number;
  author: { username: string; avatarUrl: string | null };
  latestVersion?: string;
  updatedAt: string;
}

export interface SkillsStoreListResponse {
  items: SkillsStorePackageListItem[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}

export function resolveSkillsStoreBaseUrl(config: Config): string {
  const env = process.env.XOPC_SKILLS_STORE_URL?.trim();
  if (env) {
    try {
      return normalizeBaseUrl(new URL(env).toString());
    } catch {
      // fall through
    }
  }
  const fromConfig = config.gateway?.skillsStoreBaseUrl?.trim();
  if (fromConfig) {
    try {
      return normalizeBaseUrl(new URL(fromConfig).toString());
    } catch {
      return DEFAULT_STORE_BASE;
    }
  }
  return DEFAULT_STORE_BASE;
}

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/$/, '');
}

export function getStoreOrigin(baseUrl: string): string {
  const u = new URL(baseUrl);
  return `${u.protocol}//${u.host}`;
}

/**
 * Allow only HTTPS URLs whose origin matches the configured store base (SSRF guard).
 */
export function assertDownloadUrlAllowed(downloadUrl: string, storeBaseUrl: string): URL {
  let u: URL;
  try {
    u = new URL(downloadUrl);
  } catch {
    throw new Error('Invalid download URL from store');
  }
  if (u.protocol !== 'https:') {
    throw new Error('Download URL must use HTTPS');
  }
  const allowed = new URL(storeBaseUrl);
  if (u.host !== allowed.host) {
    throw new Error('Download URL host does not match skills store');
  }
  return u;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { Accept: 'application/json', ...init?.headers },
  });
  const text = await res.text();
  if (!res.ok) {
    let msg = `Store request failed (${res.status})`;
    try {
      const j = JSON.parse(text) as { error?: { message?: string } };
      if (j.error?.message) msg = j.error.message;
    } catch {
      if (text) msg = text.slice(0, 200);
    }
    throw new Error(msg);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error('Store returned invalid JSON');
  }
}

export async function listSkillPackages(
  storeBaseUrl: string,
  params: SkillsStoreListParams,
): Promise<SkillsStoreListResponse> {
  const base = normalizeBaseUrl(storeBaseUrl);
  const sp = new URLSearchParams();
  sp.set('type', 'skill');
  if (params.q?.trim()) sp.set('q', params.q.trim());
  if (params.page != null) sp.set('page', String(params.page));
  if (params.pageSize != null) sp.set('pageSize', String(params.pageSize));
  if (params.sort) sp.set('sort', params.sort);

  const url = `${base}/api/v1/packages?${sp.toString()}`;
  return fetchJson<SkillsStoreListResponse>(url);
}

export async function resolveSkillZipDownloadUrl(
  storeBaseUrl: string,
  packageName: string,
  version?: string,
): Promise<{ downloadUrl: string; version: string }> {
  const base = normalizeBaseUrl(storeBaseUrl);
  const enc = encodeURIComponent(packageName);
  if (version?.trim()) {
    const v = encodeURIComponent(version.trim());
    const detail = await fetchJson<{
      downloadUrl: string;
      version: string;
    }>(`${base}/api/v1/packages/${enc}/versions/${v}`);
    if (!detail.downloadUrl) {
      throw new Error('Store version has no download URL');
    }
    assertDownloadUrlAllowed(detail.downloadUrl, base);
    return { downloadUrl: detail.downloadUrl, version: detail.version };
  }

  const pkg = await fetchJson<{
    name: string;
    latestVersion: { downloadUrl: string; version: string };
  }>(`${base}/api/v1/packages/${enc}`);
  if (!pkg.latestVersion?.downloadUrl) {
    throw new Error('Package has no published version');
  }
  assertDownloadUrlAllowed(pkg.latestVersion.downloadUrl, base);
  return {
    downloadUrl: pkg.latestVersion.downloadUrl,
    version: pkg.latestVersion.version,
  };
}

export async function downloadSkillZipBuffer(
  storeBaseUrl: string,
  downloadUrl: string,
): Promise<Buffer> {
  const base = normalizeBaseUrl(storeBaseUrl);
  assertDownloadUrlAllowed(downloadUrl, base);

  const res = await fetch(downloadUrl, { redirect: 'follow' });
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

export function skillIdForMarketplaceInstall(packageName: string): string | undefined {
  const trimmed = packageName.trim();
  if (!trimmed) return undefined;
  return isValidSkillId(trimmed) ? trimmed : undefined;
}
