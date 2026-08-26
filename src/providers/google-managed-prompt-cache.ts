import type { Api, Model } from '@earendil-works/pi-ai';

import { splitPromptCacheBoundary, stripPromptCacheBoundary } from '../agent/prompt/cache-boundary.js';
import { canonicalizeCacheValue, digestCacheText } from './prompt-cache-fingerprint.js';
import type { PromptCachePolicy } from './prompt-cache-plan.js';

type JsonRecord = Record<string, unknown>;

const DEFAULT_GOOGLE_API_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const MIN_CACHEABLE_PROMPT_CHARS = 4_096;
const FAILURE_BACKOFF_MS = 10 * 60_000;
const MAX_CACHE_ENTRIES = 128;

type CacheEntry =
  | { status: 'ready'; name: string; expiresAt: number }
  | { status: 'failed'; retryAt: number };

const entries = new Map<string, CacheEntry>();
const pendingCreates = new Map<string, Promise<CacheEntry>>();

function asRecord(value: unknown): JsonRecord | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : undefined;
}

function resolveBaseUrl(model: Model<Api>): string {
  const raw = model.baseUrl?.trim() || DEFAULT_GOOGLE_API_BASE_URL;
  return raw.replace(/\/models(?:\/.*)?$/, '').replace(/\/+$/, '');
}

function resolveTtlSeconds(policy: PromptCachePolicy): number {
  return policy.lifetime === 'long' ? 3_600 : 300;
}

function parseExpiry(expireTime: unknown, fallback: number): number {
  if (typeof expireTime !== 'string') return fallback;
  const parsed = Date.parse(expireTime);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function remember(key: string, entry: CacheEntry): void {
  entries.delete(key);
  entries.set(key, entry);
  while (entries.size > MAX_CACHE_ENTRIES) {
    const oldest = entries.keys().next().value;
    if (typeof oldest !== 'string') break;
    entries.delete(oldest);
  }
}

function insertDynamicRuntimeContext(payload: JsonRecord, dynamicSuffix: string): JsonRecord {
  if (!dynamicSuffix || !Array.isArray(payload.contents)) return payload;
  const contents = [...payload.contents];
  const insertAt = Math.max(0, contents.length - 1);
  contents.splice(insertAt, 0, {
    role: 'user',
    parts: [{ text: `<runtime_context>\n${dynamicSuffix}\n</runtime_context>` }],
  });
  return { ...payload, contents };
}

export async function applyGoogleManagedPromptCache(params: {
  model: Model<Api>;
  context: { systemPrompt?: string };
  payload: unknown;
  policy: PromptCachePolicy;
  apiKey?: string;
  fetchImpl?: typeof fetch;
  now?: number;
}): Promise<unknown> {
  if (params.policy.mode === 'off') return params.payload;
  const payload = asRecord(params.payload);
  const config = asRecord(payload?.config);
  const apiKey = params.apiKey?.trim();
  if (!payload || !config || !apiKey) return params.payload;

  const split = splitPromptCacheBoundary(params.context.systemPrompt ?? '');
  const stablePrompt = split?.stablePrefix ?? stripPromptCacheBoundary(params.context.systemPrompt ?? '');
  const dynamicSuffix = split?.dynamicSuffix ?? '';
  if (stablePrompt.length < MIN_CACHEABLE_PROMPT_CHARS) return params.payload;

  const cacheConfig = {
    tools: config.tools,
    toolConfig: config.toolConfig,
  };
  const key = digestCacheText(
    `${params.model.provider}\0${params.model.id}\0${stablePrompt}\0${canonicalizeCacheValue(cacheConfig)}`,
  );
  const now = params.now ?? Date.now();
  const existing = entries.get(key);
  let name: string | undefined;
  if (existing?.status === 'ready' && existing.expiresAt - now > 30_000) {
    name = existing.name;
  } else if (existing?.status === 'failed' && existing.retryAt > now) {
    return params.payload;
  } else {
    const ttlSeconds = resolveTtlSeconds(params.policy);
    let pending = pendingCreates.get(key);
    if (!pending) {
      pending = (async (): Promise<CacheEntry> => {
        try {
          const response = await (params.fetchImpl ?? globalThis.fetch)(`${resolveBaseUrl(params.model)}/cachedContents`, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-goog-api-key': apiKey,
            },
            body: JSON.stringify({
              model: params.model.id.startsWith('models/') ? params.model.id : `models/${params.model.id}`,
              ttl: `${ttlSeconds}s`,
              systemInstruction: { parts: [{ text: stablePrompt }] },
              ...(config.tools ? { tools: config.tools } : {}),
              ...(config.toolConfig ? { toolConfig: config.toolConfig } : {}),
            }),
          });
          if (!response.ok) throw new Error(`Google cachedContents returned ${response.status}`);
          const body = await response.json() as { name?: unknown; expireTime?: unknown };
          if (typeof body.name !== 'string' || !body.name.trim()) {
            throw new Error('Google cachedContents response did not include a name');
          }
          return {
            status: 'ready',
            name: body.name.trim(),
            expiresAt: parseExpiry(body.expireTime, now + ttlSeconds * 1_000),
          };
        } catch {
          return { status: 'failed', retryAt: now + FAILURE_BACKOFF_MS };
        }
      })();
      pendingCreates.set(key, pending);
    }
    const created = await pending.finally(() => pendingCreates.delete(key));
    remember(key, created);
    if (created.status === 'failed') return params.payload;
    name = created.name;
  }

  const nextConfig: JsonRecord = { ...config, cachedContent: name };
  delete nextConfig.systemInstruction;
  delete nextConfig.tools;
  delete nextConfig.toolConfig;
  return insertDynamicRuntimeContext({ ...payload, config: nextConfig }, dynamicSuffix);
}

export function clearGoogleManagedPromptCaches(): void {
  entries.clear();
  pendingCreates.clear();
}
