/**
 * Extension marketplace catalog from xopc-store (`GET /api/v1/packages?type=extension`).
 * Base URL: `XOPC_SKILLS_STORE_URL` → `gateway.skillsStoreBaseUrl` → `https://store.xopc.ai`.
 */

import { loadConfig } from '../config/loader.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('ExtensionMarketplace');

const DEFAULT_STORE_BASE = 'https://store.xopc.ai';
const CACHE_TTL_MS = 5 * 60 * 1000;

export interface RegistryEntry {
  id: string;
  name: string;
  description?: string;
  npmPackage: string;
  version?: string;
  categories?: string[];
  tags?: string[];
  verified?: boolean;
  homepage?: string;
  author?: string;
}

export interface ExtensionRegistryFile {
  version: number;
  extensions: RegistryEntry[];
}

let cache: { at: number; data: ExtensionRegistryFile } | null = null;
let lastStale: ExtensionRegistryFile | null = null;

/** Resolved xopc-store base (same order as skills marketplace). */
export function getExtensionMarketplaceStoreBaseUrl(): string {
  return normalizeStoreBaseUrl();
}

function emptyRegistry(): ExtensionRegistryFile {
  return { version: 1, extensions: [] };
}

function normalizeStoreBaseUrl(): string {
  const env = process.env.XOPC_SKILLS_STORE_URL?.trim();
  if (env) {
    try {
      return new URL(env).toString().replace(/\/$/, '');
    } catch {
      // fall through
    }
  }
  try {
    const fromCfg = loadConfig().gateway?.skillsStoreBaseUrl?.trim();
    if (fromCfg) {
      try {
        return new URL(fromCfg).toString().replace(/\/$/, '');
      } catch {
        // fall through
      }
    }
  } catch {
    /* ignore config load edge cases */
  }
  return DEFAULT_STORE_BASE;
}

function titleCaseSlug(slug: string): string {
  return slug
    .split('-')
    .filter(Boolean)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(' ');
}

async function fetchExtensionCatalogFromStore(): Promise<RegistryEntry[] | null> {
  const base = normalizeStoreBaseUrl();
  const listUrl = `${base}/api/v1/packages?type=extension&pageSize=200`;
  try {
    const res = await fetch(listUrl, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) {
      log.warn({ status: res.status, url: listUrl }, 'Store extension catalog request failed');
      return null;
    }
    const raw = (await res.json()) as {
      items?: Array<{
        name?: string;
        description?: string | null;
        latestVersion?: string;
        author?: { username?: string | null };
      }>;
    };
    const items = Array.isArray(raw.items) ? raw.items : [];
    const extensions: RegistryEntry[] = [];
    for (const it of items) {
      const name = typeof it.name === 'string' ? it.name.trim() : '';
      if (!name) continue;
      const author = it.author?.username ?? undefined;
      extensions.push({
        id: name,
        name: titleCaseSlug(name),
        description: typeof it.description === 'string' ? it.description : undefined,
        npmPackage: name,
        version: typeof it.latestVersion === 'string' ? it.latestVersion : undefined,
        author,
        verified: author === 'xopcai',
      });
    }
    return extensions.length > 0 ? extensions : null;
  } catch (err) {
    log.warn({ err, url: listUrl }, 'Store extension catalog fetch failed');
    return null;
  }
}

export async function fetchRegistry(forceRefresh = false): Promise<ExtensionRegistryFile> {
  const now = Date.now();
  if (!forceRefresh && cache && now - cache.at < CACHE_TTL_MS) {
    return cache.data;
  }

  const storeBase = normalizeStoreBaseUrl();
  const fromStore = await fetchExtensionCatalogFromStore();
  if (fromStore && fromStore.length > 0) {
    const data: ExtensionRegistryFile = { version: 1, extensions: fromStore };
    lastStale = data;
    cache = { at: now, data };
    log.debug({ count: fromStore.length, storeBase }, 'Loaded extension catalog from xopc-store');
    return data;
  }

  log.warn({ storeBase }, 'Extension catalog from xopc-store was empty or unreachable');
  if (lastStale) {
    return lastStale;
  }
  return emptyRegistry();
}

function matchesKeyword(entry: RegistryEntry, keyword: string): boolean {
  const k = keyword.toLowerCase();
  const hay = [
    entry.id,
    entry.name,
    entry.description ?? '',
    ...(entry.categories ?? []),
    ...(entry.tags ?? []),
    entry.npmPackage,
  ]
    .join(' ')
    .toLowerCase();
  return hay.includes(k);
}

export async function searchExtensions(keyword: string): Promise<RegistryEntry[]> {
  const reg = await fetchRegistry();
  const k = keyword.trim();
  if (!k) return reg.extensions;
  return reg.extensions.filter((e) => matchesKeyword(e, k));
}

export async function findExtension(id: string): Promise<RegistryEntry | undefined> {
  const reg = await fetchRegistry();
  return reg.extensions.find((e) => e.id === id);
}

export async function listExtensions(category?: string): Promise<RegistryEntry[]> {
  const reg = await fetchRegistry();
  if (!category?.trim()) return reg.extensions;
  const c = category.trim().toLowerCase();
  return reg.extensions.filter((e) =>
    (e.categories ?? []).some((x) => x.toLowerCase() === c),
  );
}
