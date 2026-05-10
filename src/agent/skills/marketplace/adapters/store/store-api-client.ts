/**
 * HTTP client for the public xopc-store-compatible REST API (packages list, detail, zip download).
 * Used by the store marketplace adapter and SSRF-safe download helpers.
 *
 * Facade: {@link ../../../skills-marketplace.js}.
 */

import type { Config } from '../../../../../config/schema.js';
import { MAX_EXTENSION_STORE_ZIP_BYTES } from '../../../../../extensions/store-zip-limits.js';
import { isValidSkillId, MAX_SKILL_ZIP_BYTES } from '../../../managed-store.js';
import type { SkillMarkdownPreviewPayload } from '../../../types.js';

const DEFAULT_STORE_BASE = 'https://store.xopc.ai';

export type SkillsMarketplaceProvider = 'store' | 'skillhub';

export interface SkillsStoreListParams {
  q?: string;
  page?: number;
  pageSize?: number;
  sort?: 'downloads' | 'newest';
  /** Adapter-defined category id (exact match against package `categories`). */
  category?: string;
}

/** Category option for marketplace filter chips (from adapter). */
export interface MarketplaceCategoryOption {
  id: string;
  label: string;
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
  /** Taxonomy / tags from the marketplace (adapter-specific). */
  categories?: string[];
  tags?: string[];
  stars?: number;
  /** Short provenance label for the row (e.g. ClawHub). */
  sourceLabel?: string;
}

/** Unified marketplace package list item (works for all adapters). */
export type MarketplacePackageListItem = SkillsStorePackageListItem;

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

export { MAX_EXTENSION_STORE_ZIP_BYTES };

/**
 * Base URL for extension downloads (defaults to skills store host — usually store.xopc.ai).
 * Override with `XOPC_EXTENSIONS_STORE_URL`.
 */
export function resolveExtensionsStoreBaseUrl(config: Config): string {
  const env = process.env.XOPC_EXTENSIONS_STORE_URL?.trim();
  if (env) {
    try {
      return normalizeBaseUrl(new URL(env).toString());
    } catch {
      // fall through
    }
  }
  return resolveSkillsStoreBaseUrl(config);
}

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/$/, '');
}

export function getStoreOrigin(baseUrl: string): string {
  const u = new URL(baseUrl);
  return `${u.protocol}//${u.host}`;
}

/**
 * Allow download URLs whose origin matches the configured store base (SSRF guard).
 * Production store is HTTPS-only; local dev (`http://localhost` / `127.0.0.1`) may use HTTP.
 */
export function assertDownloadUrlAllowed(downloadUrl: string, storeBaseUrl: string): URL {
  let u: URL;
  try {
    u = new URL(downloadUrl);
  } catch {
    throw new Error('Invalid download URL from store');
  }
  const allowed = new URL(storeBaseUrl);
  const localHttpDev =
    allowed.protocol === 'http:' &&
    (allowed.hostname === 'localhost' || allowed.hostname === '127.0.0.1');
  if (localHttpDev) {
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      throw new Error('Download URL must use HTTP or HTTPS');
    }
  } else if (u.protocol !== 'https:') {
    throw new Error('Download URL must use HTTPS');
  }
  if (u.host !== allowed.host) {
    throw new Error('Download URL host does not match configured store host');
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
  if (params.category?.trim()) sp.set('category', params.category.trim());

  const url = `${base}/api/v1/packages?${sp.toString()}`;
  return fetchJson<SkillsStoreListResponse>(url);
}

/** GET /api/v1/packages/:name — published skill package (public). */
export interface MarketplacePackageDetail {
  id: string;
  name: string;
  type: string;
  description: string;
  readme: string | null;
  downloads: number;
  author: { username: string; avatarUrl: string | null };
  latestVersion: {
    version: string;
    changelog: string | null;
    publishedAt: string;
  };
}

export async function fetchMarketplacePackageDetail(
  storeBaseUrl: string,
  packageName: string,
): Promise<MarketplacePackageDetail> {
  const base = normalizeBaseUrl(storeBaseUrl);
  const enc = encodeURIComponent(packageName.trim());
  return fetchJson<MarketplacePackageDetail>(`${base}/api/v1/packages/${enc}`);
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

/** GET /api/v1/packages/:name — subset used for extension installs. */
export interface StorePublishedPackageHead {
  name: string;
  type: string;
  latestVersion: {
    version: string;
    downloadUrl: string;
  };
}

export async function resolveExtensionZipDownloadUrl(
  storeBaseUrl: string,
  packageName: string,
  version?: string,
): Promise<{ downloadUrl: string; version: string }> {
  const base = normalizeBaseUrl(storeBaseUrl);
  const enc = encodeURIComponent(packageName.trim());
  const meta = await fetchJson<StorePublishedPackageHead>(`${base}/api/v1/packages/${enc}`);
  if (meta.type !== 'extension') {
    throw new Error(
      `Package "${packageName}" has type "${meta.type}" (expected extension). ` +
        'Use `xopc skills install` for skills.',
    );
  }
  if (version?.trim()) {
    const v = encodeURIComponent(version.trim());
    const detail = await fetchJson<{ downloadUrl: string; version: string }>(
      `${base}/api/v1/packages/${enc}/versions/${v}`,
    );
    if (!detail.downloadUrl) {
      throw new Error('Store version has no download URL');
    }
    assertDownloadUrlAllowed(detail.downloadUrl, base);
    return { downloadUrl: detail.downloadUrl, version: detail.version };
  }
  const lv = meta.latestVersion;
  if (!lv?.downloadUrl) {
    throw new Error('Package has no published version');
  }
  assertDownloadUrlAllowed(lv.downloadUrl, base);
  return { downloadUrl: lv.downloadUrl, version: lv.version };
}

export async function downloadExtensionStoreZipBuffer(
  storeBaseUrl: string,
  downloadUrl: string,
): Promise<Buffer> {
  const base = normalizeBaseUrl(storeBaseUrl);
  assertDownloadUrlAllowed(downloadUrl, base);
  const res = await fetch(downloadUrl, { redirect: 'follow' });
  if (!res.ok) {
    throw new Error(`Failed to download extension archive (${res.status})`);
  }
  const len = res.headers.get('content-length');
  if (len) {
    const n = Number(len);
    if (Number.isFinite(n) && n > MAX_EXTENSION_STORE_ZIP_BYTES) {
      throw new Error(`Zip exceeds maximum size (${MAX_EXTENSION_STORE_ZIP_BYTES} bytes)`);
    }
  }
  const ab = await res.arrayBuffer();
  const buf = Buffer.from(ab);
  if (buf.length > MAX_EXTENSION_STORE_ZIP_BYTES) {
    throw new Error(`Zip exceeds maximum size (${MAX_EXTENSION_STORE_ZIP_BYTES} bytes)`);
  }
  return buf;
}

export function skillIdForMarketplaceInstall(packageName: string): string | undefined {
  const trimmed = packageName.trim();
  if (!trimmed) return undefined;
  return isValidSkillId(trimmed) ? trimmed : undefined;
}

/**
 * Unified marketplace list response (adapter fills `provider`).
 */
export interface UnifiedMarketplaceListResponse {
  items: MarketplacePackageListItem[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
  provider: SkillsMarketplaceProvider;
}

/**
 * Unified marketplace package detail response.
 */
export interface UnifiedMarketplacePackageDetail extends MarketplacePackageDetail {
  provider: SkillsMarketplaceProvider;
  /** When set (e.g. SkillHub SKILL.md), gateway console renders structured meta + body like installed skills. */
  skillDocPreview?: SkillMarkdownPreviewPayload;
  /** SkillHub-specific fields */
  skillHubInfo?: {
    category: string;
    installs: number;
    stars: number;
    securityReports?: {
      keen?: { status: string; statusText: string; reportUrl?: string };
      sanbu?: { status: string; statusText: string; reportUrl?: string };
    };
  };
}
