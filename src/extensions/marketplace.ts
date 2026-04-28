/**
 * Curated extension registry (Phase 2) — fetch, cache, search.
 */

const DEFAULT_REGISTRY_URL =
  'https://raw.githubusercontent.com/xopcai/extension-registry/main/registry.json';
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

export function getRegistryUrl(): string {
  const u = process.env.XOPC_EXTENSION_REGISTRY_URL?.trim();
  return u && u.length > 0 ? u : DEFAULT_REGISTRY_URL;
}

function emptyRegistry(): ExtensionRegistryFile {
  return { version: 1, extensions: [] };
}

export async function fetchRegistry(forceRefresh = false): Promise<ExtensionRegistryFile> {
  const now = Date.now();
  if (!forceRefresh && cache && now - cache.at < CACHE_TTL_MS) {
    return cache.data;
  }

  const url = getRegistryUrl();
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const raw = (await res.json()) as unknown;
    const data = normalizeRegistry(raw);
    lastStale = data;
    cache = { at: now, data };
    return data;
  } catch {
    if (lastStale) {
      return lastStale;
    }
    return emptyRegistry();
  }
}

function normalizeRegistry(raw: unknown): ExtensionRegistryFile {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return emptyRegistry();
  }
  const o = raw as Record<string, unknown>;
  const version = typeof o.version === 'number' ? o.version : 1;
  const list = Array.isArray(o.extensions) ? o.extensions : [];
  const extensions: RegistryEntry[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const e = item as Record<string, unknown>;
    const id = typeof e.id === 'string' ? e.id : '';
    const name = typeof e.name === 'string' ? e.name : '';
    const npmPackage = typeof e.npmPackage === 'string' ? e.npmPackage : '';
    if (!id || !name || !npmPackage) continue;
    extensions.push({
      id,
      name,
      description: typeof e.description === 'string' ? e.description : undefined,
      npmPackage,
      version: typeof e.version === 'string' ? e.version : undefined,
      categories: Array.isArray(e.categories)
        ? e.categories.filter((x): x is string => typeof x === 'string')
        : undefined,
      tags: Array.isArray(e.tags)
        ? e.tags.filter((x): x is string => typeof x === 'string')
        : undefined,
      verified: typeof e.verified === 'boolean' ? e.verified : undefined,
      homepage: typeof e.homepage === 'string' ? e.homepage : undefined,
      author: typeof e.author === 'string' ? e.author : undefined,
    });
  }
  return { version, extensions };
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
