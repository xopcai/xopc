/**
 * In-memory TTL cache for SkillHub HTTP reads used by the marketplace adapter
 * (curated index, default slug discovery, batch skill metadata, registry category taxonomy).
 *
 * `XOPC_SKILLHUB_CACHE_MS`: TTL in milliseconds (default 300_000). Set to `0` to disable.
 */

import type { SkillHubCuratedIndex, SkillHubEcosystemUrls } from './ecosystem-client.js';
import { fetchSkillHubCuratedIndex } from './ecosystem-client.js';
import type { SkillHubRegistryCategoryItem, SkillHubSkillDetail } from './registry-client.js';
import {
  batchGetSkillHubSkills,
  getDefaultSkillSlugs,
  listSkillHubRegistryCategories,
} from './registry-client.js';

const DEFAULT_CACHE_MS = 5 * 60 * 1000;
const MAX_BATCH_CACHE_KEYS = 48;

type CacheEntry<T> = { value: T; expiresAt: number };

function cacheTtlMs(): number {
  const raw = process.env.XOPC_SKILLHUB_CACHE_MS?.trim();
  if (raw === '0' || raw === 'false') return 0;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_CACHE_MS;
  return n;
}

const curatedByIndexUrl = new Map<string, CacheEntry<SkillHubCuratedIndex>>();
let defaultSlugsEntry: CacheEntry<string[]> | undefined;
let registryCategoriesEntry: CacheEntry<SkillHubRegistryCategoryItem[]> | undefined;
const batchBySlugsKey = new Map<string, CacheEntry<SkillHubSkillDetail[]>>();

function getFresh<T>(entry: CacheEntry<T> | undefined): T | undefined {
  if (!entry || entry.expiresAt <= Date.now()) return undefined;
  return entry.value;
}

function evictOldestBatchKey(): void {
  const first = batchBySlugsKey.keys().next().value;
  if (first !== undefined) batchBySlugsKey.delete(first);
}

function batchSlugsCacheKey(slugs: string[]): string {
  if (slugs.length === 0) return '';
  return [...slugs].sort().join('\n');
}

export async function cachedFetchSkillHubCuratedIndex(urls: SkillHubEcosystemUrls): Promise<SkillHubCuratedIndex> {
  const ttl = cacheTtlMs();
  const key = urls.skillsIndexUrl;
  if (ttl > 0) {
    const hit = getFresh(curatedByIndexUrl.get(key));
    if (hit) return hit;
  }
  const value = await fetchSkillHubCuratedIndex(urls);
  if (ttl > 0) curatedByIndexUrl.set(key, { value, expiresAt: Date.now() + ttl });
  return value;
}

export async function cachedGetDefaultSkillSlugs(): Promise<string[]> {
  const ttl = cacheTtlMs();
  if (ttl > 0) {
    const hit = getFresh(defaultSlugsEntry);
    if (hit) return hit;
  }
  const value = await getDefaultSkillSlugs();
  if (ttl > 0) defaultSlugsEntry = { value, expiresAt: Date.now() + ttl };
  return value;
}

export async function cachedListSkillHubRegistryCategories(): Promise<SkillHubRegistryCategoryItem[]> {
  const ttl = cacheTtlMs();
  if (ttl > 0) {
    const hit = getFresh(registryCategoriesEntry);
    if (hit) return hit;
  }
  const value = await listSkillHubRegistryCategories();
  if (ttl > 0) registryCategoriesEntry = { value, expiresAt: Date.now() + ttl };
  return value;
}

export async function cachedBatchGetSkillHubSkills(slugs: string[]): Promise<SkillHubSkillDetail[]> {
  if (slugs.length === 0) return [];
  const ttl = cacheTtlMs();
  const key = batchSlugsCacheKey(slugs);
  if (ttl > 0) {
    const hit = getFresh(batchBySlugsKey.get(key));
    if (hit) return hit;
  }
  const value = await batchGetSkillHubSkills(slugs);
  if (ttl > 0) {
    while (batchBySlugsKey.size >= MAX_BATCH_CACHE_KEYS) evictOldestBatchKey();
    batchBySlugsKey.set(key, { value, expiresAt: Date.now() + ttl });
  }
  return value;
}
