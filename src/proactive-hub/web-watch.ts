import { createHash, randomUUID } from 'node:crypto';

import { fetchPublicText } from '../agent/tools/fetch-text.js';
import { checkUrlSafety, checkWebsiteBlocklist, cleanBase64Images, type WebsiteBlocklistConfig } from '../agent/tools/url-safety.js';
import type { AutomationEvent } from '../automations/domain/types.js';
import type { Config } from '../config/schema.js';
import { getProactivitySettings } from '../personal-agent/proactivity/repository.js';
import { resolvePersonalOwnerId } from '../personal-agent/repository.js';
import { DurableState } from '../storage/sqlite/durable-state.js';
import { createLogger } from '../utils/logger.js';
import {
  createProactiveSubscription,
  listProactiveSubscriptions,
  patchProactiveSubscription,
} from './repository.js';
import type { ProactiveRouteHint } from './types.js';

const log = createLogger('ProactiveHub:WebWatch');

export const WEB_WATCH_STATE_NAMESPACE = 'proactive.web-watches';
export const MIN_WEB_WATCH_INTERVAL_MS = 15 * 60_000;
export const DEFAULT_WEB_WATCH_INTERVAL_MS = 30 * 60_000;
export const MAX_WEB_WATCH_INTERVAL_MS = 24 * 3_600_000;
export const MAX_ACTIVE_WEB_WATCHES = 15;
const MAX_STORED_TEXT_CHARS = 24_000;

export type WebWatchDeliveryMode = 'immediate' | 'triage' | 'digest';

export interface WebWatchRecord {
  id: string;
  ownerId: string;
  url: string;
  title: string;
  condition: string;
  deliveryMode: WebWatchDeliveryMode;
  intervalMs: number;
  subscriptionId: string;
  projectId?: string;
  enabled: boolean;
  revision: number;
  baselineHash: string | null;
  lastText: string | null;
  lastCheckedAt: number | null;
  nextCheckAt: number;
  lastChangedAt: number | null;
  lastStatus: 'pending' | 'ok' | 'error';
  lastError: string | null;
  consecutiveErrors: number;
  errorNotifiedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface WebWatchPublicView {
  id: string;
  url: string;
  title: string;
  condition: string;
  deliveryMode: WebWatchDeliveryMode;
  intervalMs: number;
  subscriptionId: string;
  projectId?: string;
  enabled: boolean;
  revision: number;
  lastCheckedAt: number | null;
  nextCheckAt: number;
  lastChangedAt: number | null;
  lastStatus: 'pending' | 'ok' | 'error';
  lastError: string | null;
  consecutiveErrors: number;
  createdAt: number;
  updatedAt: number;
}

export function toWebWatchPublicView(record: WebWatchRecord): WebWatchPublicView {
  const { baselineHash: _h, lastText: _t, errorNotifiedAt: _e, ownerId: _o, ...rest } = record;
  return rest;
}

function storeFor(ownerId: string): DurableState<WebWatchRecord> {
  return new DurableState<WebWatchRecord>(WEB_WATCH_STATE_NAMESPACE, ownerId);
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/giu, ' ')
    .replace(/&amp;/giu, '&')
    .replace(/&lt;/giu, '<')
    .replace(/&gt;/giu, '>')
    .replace(/&quot;/giu, '"')
    .replace(/&#39;/giu, "'");
}

/**
 * Extracts readable, noise-reduced text from HTML / JSON / plain text for stable diffing.
 */
export function normalizeWebWatchText(raw: string, contentType: string): { title?: string; text: string } {
  const lowerType = contentType.toLowerCase();
  if (lowerType.includes('application/json')) {
    try {
      const parsed = JSON.parse(raw);
      return { text: JSON.stringify(parsed, null, 2).slice(0, MAX_STORED_TEXT_CHARS) };
    } catch {
      return { text: raw.trim().slice(0, MAX_STORED_TEXT_CHARS) };
    }
  }

  let title: string | undefined;
  if (lowerType.includes('html') || /<html|<body|<title/iu.test(raw.slice(0, 2000))) {
    const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/iu.exec(raw);
    if (titleMatch?.[1]) {
      title = decodeHtmlEntities(titleMatch[1]).replace(/\s+/gu, ' ').trim().slice(0, 140) || undefined;
    }
    const stripped = cleanBase64Images(raw)
      .replace(/<script[\s\S]*?<\/script>/giu, '\n')
      .replace(/<style[\s\S]*?<\/style>/giu, '\n')
      .replace(/<svg[\s\S]*?<\/svg>/giu, '\n')
      .replace(/<noscript[\s\S]*?<\/noscript>/giu, '\n')
      .replace(/<!--[\s\S]*?-->/gu, '\n')
      .replace(/<\/(?:p|div|li|tr|h[1-6]|section|article|br|header|footer)>/giu, '\n')
      .replace(/<[^>]+>/gu, ' ');
    const lines = decodeHtmlEntities(stripped)
      .split(/\r?\n/u)
      .map(line => line.replace(/[ \t]+/gu, ' ').trim())
      .filter(line => line.length >= 2);
    return { title, text: lines.join('\n').slice(0, MAX_STORED_TEXT_CHARS) };
  }

  const lines = raw
    .split(/\r?\n/u)
    .map(line => line.replace(/[ \t]+/gu, ' ').trim())
    .filter(Boolean);
  return { text: lines.join('\n').slice(0, MAX_STORED_TEXT_CHARS) };
}

function hashText(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

export function computeWebWatchDelta(previousText: string, nextText: string): {
  changed: boolean;
  addedLines: string[];
  removedLines: string[];
  summary: string;
} {
  const prevSet = new Set(previousText.split('\n').map(line => line.trim()).filter(Boolean));
  const nextLines = nextText.split('\n').map(line => line.trim()).filter(Boolean);
  const nextSet = new Set(nextLines);

  const addedLines = [...new Set(nextLines.filter(line => !prevSet.has(line)))].slice(0, 12);
  const removedLines = [...prevSet].filter(line => !nextSet.has(line)).slice(0, 8);
  if (addedLines.length === 0 && removedLines.length === 0) {
    return { changed: false, addedLines: [], removedLines: [], summary: '' };
  }
  const parts: string[] = [];
  if (addedLines.length > 0) {
    parts.push(`新增/变化内容：${addedLines.slice(0, 5).join(' | ')}`);
  }
  if (removedLines.length > 0) {
    parts.push(`移除内容：${removedLines.slice(0, 3).join(' | ')}`);
  }
  return {
    changed: true,
    addedLines,
    removedLines,
    summary: parts.join('\n').slice(0, 1200),
  };
}

function routeFromDeliveryMode(mode: WebWatchDeliveryMode): ProactiveRouteHint {
  if (mode === 'immediate') return 'force_scout';
  if (mode === 'digest') return 'digest_only';
  return 'triage';
}

export function listWebWatches(ownerId: string): WebWatchRecord[] {
  return [...storeFor(ownerId).entries()]
    .map(([, record]) => record)
    .sort((a, b) => Number(b.enabled) - Number(a.enabled) || b.updatedAt - a.updatedAt);
}

export function getWebWatch(ownerId: string, watchId: string): WebWatchRecord | undefined {
  return storeFor(ownerId).get(watchId);
}

export function createOrReuseWebWatch(
  input: {
    ownerId: string;
    url: string;
    title?: string;
    condition: string;
    deliveryMode?: WebWatchDeliveryMode;
    intervalMs?: number;
    projectId?: string;
    blocklist?: WebsiteBlocklistConfig;
  },
  now = Date.now(),
): { outcome: 'created' | 'reused_active'; watch: WebWatchRecord } {
  const trimmedUrl = input.url.trim();
  const safety = checkUrlSafety(trimmedUrl);
  if (!safety.safe) {
    throw new Error(`Unsafe URL blocked: ${safety.reason ?? 'invalid URL'}`);
  }
  const blocked = checkWebsiteBlocklist(trimmedUrl, input.blocklist);
  if (blocked) {
    throw new Error(`Blocked URL: ${blocked.message}`);
  }

  const normalizedUrl = new URL(trimmedUrl).href;
  const condition = input.condition.trim().slice(0, 400);
  if (!condition) {
    throw new Error('A watch condition describing what change matters is required');
  }
  const deliveryMode: WebWatchDeliveryMode = input.deliveryMode ?? 'triage';
  const intervalMs = Math.max(
    MIN_WEB_WATCH_INTERVAL_MS,
    Math.min(input.intervalMs ?? DEFAULT_WEB_WATCH_INTERVAL_MS, MAX_WEB_WATCH_INTERVAL_MS),
  );

  const store = storeFor(input.ownerId);
  const existing = listWebWatches(input.ownerId);
  const duplicate = existing.find(item =>
    item.enabled
    && item.url === normalizedUrl
    && item.condition.toLocaleLowerCase() === condition.toLocaleLowerCase(),
  );
  if (duplicate) {
    return { outcome: 'reused_active', watch: duplicate };
  }

  const activeCount = existing.filter(item => item.enabled).length;
  if (activeCount >= MAX_ACTIVE_WEB_WATCHES) {
    throw new Error(`Active web watches limit (${MAX_ACTIVE_WEB_WATCHES}) reached; pause or stop an existing watch first`);
  }

  const id = `webwatch:${randomUUID().slice(0, 12)}`;
  const hostname = new URL(normalizedUrl).hostname;
  const title = (input.title?.trim() || hostname).slice(0, 140);

  const sub = createProactiveSubscription(input.ownerId, {
    scopeType: input.projectId ? 'project' : 'global',
    ...(input.projectId ? { scopeId: input.projectId } : {}),
    sourcePattern: 'web:watch',
    eventTypePattern: 'web.page.*',
    matchPredicates: { equals: { watchId: id } },
    defaultRoute: routeFromDeliveryMode(deliveryMode),
    coalesceWindowMs: 60_000,
    enabled: true,
  }, 'user_explicit');

  const record: WebWatchRecord = {
    id,
    ownerId: input.ownerId,
    url: normalizedUrl,
    title,
    condition,
    deliveryMode,
    intervalMs,
    subscriptionId: sub.id,
    ...(input.projectId ? { projectId: input.projectId } : {}),
    enabled: true,
    revision: 1,
    baselineHash: null,
    lastText: null,
    lastCheckedAt: null,
    nextCheckAt: now,
    lastChangedAt: null,
    lastStatus: 'pending',
    lastError: null,
    consecutiveErrors: 0,
    errorNotifiedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  store.set(id, record);
  return { outcome: 'created', watch: record };
}

export function patchWebWatch(
  ownerId: string,
  watchId: string,
  patch: {
    expectedRevision?: number;
    enabled?: boolean;
    condition?: string;
    intervalMs?: number;
    deliveryMode?: WebWatchDeliveryMode;
  },
  now = Date.now(),
): WebWatchRecord {
  const store = storeFor(ownerId);
  const current = store.get(watchId);
  if (!current) {
    throw new Error('Web watch not found');
  }
  if (patch.expectedRevision !== undefined && current.revision !== patch.expectedRevision) {
    throw new Error('Web watch changed; reload before updating');
  }

  const nextEnabled = patch.enabled ?? current.enabled;
  const nextDelivery = patch.deliveryMode ?? current.deliveryMode;
  const nextIntervalMs = patch.intervalMs !== undefined
    ? Math.max(MIN_WEB_WATCH_INTERVAL_MS, Math.min(patch.intervalMs, MAX_WEB_WATCH_INTERVAL_MS))
    : current.intervalMs;

  const updated: WebWatchRecord = {
    ...current,
    enabled: nextEnabled,
    condition: patch.condition?.trim().slice(0, 400) || current.condition,
    deliveryMode: nextDelivery,
    intervalMs: nextIntervalMs,
    nextCheckAt: nextEnabled && !current.enabled ? now : current.nextCheckAt,
    ...(nextEnabled && !current.enabled ? { consecutiveErrors: 0, errorNotifiedAt: null } : {}),
    revision: current.revision + 1,
    updatedAt: now,
  };
  store.set(watchId, updated);

  // Keep paired proactive_subscription in sync so Gate 1 reflects pause/resume/route immediately.
  const pairedSub = listProactiveSubscriptions(ownerId).find(sub => sub.id === current.subscriptionId);
  if (pairedSub) {
    try {
      patchProactiveSubscription(ownerId, pairedSub.id, {
        expectedRevision: pairedSub.revision,
        enabled: nextEnabled,
        defaultRoute: routeFromDeliveryMode(nextDelivery),
      }, now);
    } catch (err) {
      log.debug({ err, watchId, subscriptionId: pairedSub.id }, 'Skipped syncing paired web watch subscription');
    }
  }

  return updated;
}

export function deleteWebWatch(ownerId: string, watchId: string, now = Date.now()): boolean {
  const store = storeFor(ownerId);
  const current = store.get(watchId);
  if (!current) return false;
  const pairedSub = listProactiveSubscriptions(ownerId).find(sub => sub.id === current.subscriptionId);
  if (pairedSub && pairedSub.enabled) {
    try {
      patchProactiveSubscription(ownerId, pairedSub.id, {
        expectedRevision: pairedSub.revision,
        enabled: false,
      }, now);
    } catch {
      // Best-effort disable.
    }
  }
  store.delete(watchId);
  return true;
}

export interface WebWatchFetchResult {
  text: string;
  contentType: string;
  url: string;
}

/**
 * Periodically polls due public URL watches using SSRF-safe read-only fetches,
 * establishes initial baseline silently, diffs normalized text, and emits
 * Proactive Hub events only on meaningful changes or repeated coverage failures.
 */
export class WebWatchSignalProducer {
  private scanning = false;

  constructor(private readonly deps: {
    ownerId?: string;
    getConfig: () => Config;
    ingestEvent: (event: AutomationEvent) => void;
    fetchPage?: (url: string, blocklist: WebsiteBlocklistConfig | undefined) => Promise<WebWatchFetchResult>;
    now?: () => number;
  }) {}

  async checkOne(watchId: string, ownerId = resolvePersonalOwnerId(this.deps.ownerId)): Promise<'baseline' | 'unchanged' | 'changed' | 'error' | 'skipped'> {
    const store = storeFor(ownerId);
    const watch = store.get(watchId);
    if (!watch || !watch.enabled) return 'skipped';

    const now = this.deps.now?.() ?? Date.now();
    const config = this.deps.getConfig();
    const blocklist = config.tools?.web?.blocklist;
    const fetcher = this.deps.fetchPage ?? ((url, bl) => fetchPublicText(url, bl));

    try {
      const fetched = await fetcher(watch.url, blocklist);
      const normalized = normalizeWebWatchText(fetched.text, fetched.contentType);
      const nextHash = hashText(normalized.text);
      const resolvedTitle = watch.title === new URL(watch.url).hostname && normalized.title
        ? normalized.title
        : watch.title;

      // First successful check establishes baseline without spamming a change alert.
      if (!watch.baselineHash || watch.lastText === null) {
        store.set(watch.id, {
          ...watch,
          title: resolvedTitle,
          baselineHash: nextHash,
          lastText: normalized.text,
          lastCheckedAt: now,
          nextCheckAt: now + watch.intervalMs,
          lastStatus: 'ok',
          lastError: null,
          consecutiveErrors: 0,
          errorNotifiedAt: null,
          updatedAt: now,
        });
        return 'baseline';
      }

      if (nextHash === watch.baselineHash) {
        store.set(watch.id, {
          ...watch,
          title: resolvedTitle,
          lastCheckedAt: now,
          nextCheckAt: now + watch.intervalMs,
          lastStatus: 'ok',
          lastError: null,
          consecutiveErrors: 0,
          errorNotifiedAt: null,
          updatedAt: now,
        });
        return 'unchanged';
      }

      const delta = computeWebWatchDelta(watch.lastText, normalized.text);
      store.set(watch.id, {
        ...watch,
        title: resolvedTitle,
        baselineHash: nextHash,
        lastText: normalized.text,
        lastCheckedAt: now,
        nextCheckAt: now + watch.intervalMs,
        lastChangedAt: delta.changed ? now : watch.lastChangedAt,
        lastStatus: 'ok',
        lastError: null,
        consecutiveErrors: 0,
        errorNotifiedAt: null,
        updatedAt: now,
      });

      if (!delta.changed) {
        return 'unchanged';
      }

      this.deps.ingestEvent({
        id: `webwatch:${watch.id}:${nextHash.slice(0, 16)}`,
        type: 'web.page.changed',
        source: 'web:watch',
        schemaVersion: 1,
        subject: { kind: 'web_watch', id: watch.id },
        occurredAtMs: now,
        dedupeKey: `${watch.id}:${nextHash}`,
        trust: 'untrusted_webhook',
        payload: {
          watchId: watch.id,
          url: fetched.url || watch.url,
          title: resolvedTitle,
          condition: watch.condition,
          ...(watch.projectId ? { projectId: watch.projectId } : {}),
          addedLines: delta.addedLines,
          removedLines: delta.removedLines,
          summary: delta.summary,
          excerpt: normalized.text.slice(0, 1800),
        },
      });
      return 'changed';
    } catch (err) {
      const errorMessage = (err instanceof Error ? err.message : String(err)).slice(0, 240);
      const consecutiveErrors = watch.consecutiveErrors + 1;
      const shouldNotifyUnavailable = consecutiveErrors >= 2 && watch.errorNotifiedAt === null;

      store.set(watch.id, {
        ...watch,
        lastCheckedAt: now,
        nextCheckAt: now + Math.min(watch.intervalMs * Math.min(consecutiveErrors, 4), MAX_WEB_WATCH_INTERVAL_MS),
        lastStatus: 'error',
        lastError: errorMessage,
        consecutiveErrors,
        errorNotifiedAt: shouldNotifyUnavailable ? now : watch.errorNotifiedAt,
        updatedAt: now,
      });

      if (shouldNotifyUnavailable) {
        this.deps.ingestEvent({
          id: `webwatch:err:${watch.id}:${now}`,
          type: 'web.page.unavailable',
          source: 'web:watch',
          schemaVersion: 1,
          subject: { kind: 'web_watch', id: watch.id },
          occurredAtMs: now,
          dedupeKey: `err:${watch.id}:${watch.revision}`,
          trust: 'system',
          payload: {
            watchId: watch.id,
            url: watch.url,
            title: `${watch.title} · 页面暂不可访问`,
            condition: watch.condition,
            ...(watch.projectId ? { projectId: watch.projectId } : {}),
            error: errorMessage,
            summary: `连续 ${consecutiveErrors} 次无法检查 ${watch.url}（${errorMessage}）。该页面可能需要登录、触发防爬校验或已失效。`,
          },
        });
      }
      log.debug({ err, watchId: watch.id, consecutiveErrors, phase: 'web_watch_check' }, `Web watch check failed: ${errorMessage}`);
      return 'error';
    }
  }

  async scanDue(limit = 4): Promise<number> {
    if (this.scanning) return 0;
    const ownerId = resolvePersonalOwnerId(this.deps.ownerId);
    if (getProactivitySettings(ownerId).mode === 'off') return 0;
    const now = this.deps.now?.() ?? Date.now();

    const due = listWebWatches(ownerId)
      .filter(watch => watch.enabled && watch.nextCheckAt <= now)
      .sort((a, b) => a.nextCheckAt - b.nextCheckAt)
      .slice(0, limit);
    if (!due.length) return 0;

    this.scanning = true;
    let checked = 0;
    try {
      for (const watch of due) {
        await this.checkOne(watch.id, ownerId);
        checked += 1;
      }
      return checked;
    } finally {
      this.scanning = false;
    }
  }
}
