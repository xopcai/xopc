import { randomUUID } from 'node:crypto';

import type { WebsiteBlocklistConfig } from '../agent/tools/url-safety.js';
import { DurableState } from '../storage/sqlite/durable-state.js';
import { createLogger } from '../utils/logger.js';
import {
  createProactiveSubscription,
  listProactiveSubscriptions,
  patchProactiveSubscription,
} from './repository.js';
import type { ProactiveRouteHint } from './types.js';
import {
  createOrReuseWebWatch,
  deleteWebWatch,
  getWebWatch,
  patchWebWatch,
  type WebWatchDeliveryMode,
} from './web-watch.js';

const log = createLogger('ProactiveHub:Matters');

export const MATTERS_STATE_NAMESPACE = 'proactive.follow-up-matters';
export const MIN_MATTER_INTERVAL_MS = 15 * 60_000;
export const DEFAULT_MATTER_INTERVAL_MS = 4 * 3_600_000;
export const MAX_MATTER_INTERVAL_MS = 7 * 86_400_000;
export const MAX_ACTIVE_MATTERS = 20;
const MAX_PROGRESS_ENTRIES = 25;

export type MatterStatus = 'active' | 'waiting_user' | 'paused' | 'resolved' | 'expired';
export type MatterDeliveryPreference = 'auto' | 'chat' | 'inbox';

export type MatterBinding =
  | { kind: 'web_url'; watchId: string; url: string; label: string }
  | { kind: 'event_source'; subscriptionId: string; sourcePattern: string; eventTypePattern: string; label: string; keyword?: string; sender?: string }
  | { kind: 'web_search'; query: string; label: string }
  | { kind: 'task'; taskId: string; label?: string }
  | { kind: 'project'; projectId: string; label?: string };

export interface MatterProgressEntry {
  id: string;
  at: number;
  kind: 'created' | 'check_silent' | 'update_sent' | 'action_proposed' | 'resolved' | 'blocked' | 'user_note' | 'state_changed';
  summary: string;
  evidenceRefs?: string[];
  preparedDraft?: string;
  inboxItemId?: string;
  nextCheckAt?: number | null;
}

export interface FollowUpMatter {
  id: string;
  ownerId: string;
  conversationId: string;
  title: string;
  goal: string;
  notifyWhen: string;
  doneCriteria?: string;
  status: MatterStatus;
  deliveryPreference: MatterDeliveryPreference;
  deadlineAt: number | null;
  checkIntervalMs: number;
  nextCheckAt: number | null;
  lastCheckedAt: number | null;
  lastSummary: string;
  lastError: string | null;
  errorNotifiedAt: number | null;
  bindings: MatterBinding[];
  progressLog: MatterProgressEntry[];
  revision: number;
  createdAt: number;
  updatedAt: number;
}

export interface MatterEventSourceInput {
  source: 'gmail' | 'calendar' | 'github' | 'linear' | 'local_folder' | 'local_git' | 'browser' | 'desktop';
  keyword?: string;
  sender?: string;
}

const MATTER_EVENT_SOURCE_PRESETS: Record<MatterEventSourceInput['source'], { sourcePattern: string; eventTypePattern: string; label: string; coalesceMs: number }> = {
  gmail: { sourcePattern: 'composio:gmail*', eventTypePattern: 'connector.*', label: 'Gmail', coalesceMs: 60_000 },
  calendar: { sourcePattern: 'composio:googlecalendar*', eventTypePattern: 'connector.*', label: 'Calendar', coalesceMs: 60_000 },
  github: { sourcePattern: 'composio:github*', eventTypePattern: 'connector.*', label: 'GitHub', coalesceMs: 120_000 },
  linear: { sourcePattern: 'composio:linear*', eventTypePattern: 'connector.*', label: 'Linear', coalesceMs: 120_000 },
  local_folder: { sourcePattern: 'local:folder', eventTypePattern: 'local.folder.batch_changed', label: 'Local folder', coalesceMs: 30_000 },
  local_git: { sourcePattern: 'local:git', eventTypePattern: 'local.git.repo_state_changed', label: 'Local Git', coalesceMs: 120_000 },
  browser: { sourcePattern: 'endpoint:browser', eventTypePattern: 'endpoint.browser.*', label: 'Browser', coalesceMs: 120_000 },
  desktop: { sourcePattern: 'endpoint:desktop', eventTypePattern: 'endpoint.desktop.*', label: 'Desktop', coalesceMs: 120_000 },
};

function storeFor(ownerId: string): DurableState<FollowUpMatter> {
  return new DurableState<FollowUpMatter>(MATTERS_STATE_NAMESPACE, ownerId);
}

function appendLog(logEntries: readonly MatterProgressEntry[], entry: Omit<MatterProgressEntry, 'id'>): MatterProgressEntry[] {
  const next: MatterProgressEntry = { id: randomUUID().slice(0, 12), ...entry };
  return [next, ...logEntries].slice(0, MAX_PROGRESS_ENTRIES);
}

function normalizeTitleKey(text: string): string {
  return text.trim().toLocaleLowerCase().replace(/\s+/gu, ' ');
}

function syncMatterBindingsEnabled(ownerId: string, bindings: readonly MatterBinding[], enabled: boolean, now: number): void {
  const subs = listProactiveSubscriptions(ownerId);
  for (const binding of bindings) {
    if (binding.kind === 'web_url') {
      const watch = getWebWatch(ownerId, binding.watchId);
      if (watch && watch.enabled !== enabled) {
        try {
          patchWebWatch(ownerId, watch.id, { expectedRevision: watch.revision, enabled }, now);
        } catch (err) {
          log.debug({ err, watchId: watch.id }, 'Skipped syncing matter web watch');
        }
      }
    } else if (binding.kind === 'event_source') {
      const sub = subs.find(item => item.id === binding.subscriptionId);
      if (sub && sub.enabled !== enabled) {
        try {
          patchProactiveSubscription(ownerId, sub.id, { expectedRevision: sub.revision, enabled }, now);
        } catch (err) {
          log.debug({ err, subscriptionId: sub.id }, 'Skipped syncing matter event subscription');
        }
      }
    }
  }
}

function provisionBindings(params: {
  ownerId: string;
  title: string;
  notifyWhen: string;
  deliveryPreference: MatterDeliveryPreference;
  projectId?: string;
  taskId?: string;
  urls?: readonly string[];
  eventSources?: readonly MatterEventSourceInput[];
  searchQueries?: readonly string[];
  blocklist?: WebsiteBlocklistConfig;
  intervalMs: number;
  now: number;
}): { bindings: MatterBinding[]; createdWatchIds: string[] } {
  const bindings: MatterBinding[] = [];
  const createdWatchIds: string[] = [];
  const webDelivery: WebWatchDeliveryMode = params.deliveryPreference === 'chat' ? 'immediate' : 'triage';
  const subRoute: ProactiveRouteHint = params.deliveryPreference === 'chat' ? 'force_scout' : 'triage';

  if (params.taskId?.trim()) {
    bindings.push({ kind: 'task', taskId: params.taskId.trim(), label: params.title.slice(0, 80) });
  }
  if (params.projectId?.trim()) {
    bindings.push({ kind: 'project', projectId: params.projectId.trim() });
  }

  for (const rawUrl of (params.urls ?? []).slice(0, 4)) {
    const trimmed = rawUrl.trim();
    if (!trimmed) continue;
    const { outcome, watch } = createOrReuseWebWatch({
      ownerId: params.ownerId,
      url: trimmed,
      title: params.title,
      condition: params.notifyWhen,
      deliveryMode: webDelivery,
      intervalMs: Math.min(params.intervalMs, 60 * 60_000),
      projectId: params.projectId,
      blocklist: params.blocklist,
    }, params.now);
    if (outcome === 'created') createdWatchIds.push(watch.id);
    bindings.push({
      kind: 'web_url',
      watchId: watch.id,
      url: watch.url,
      label: watch.title,
    });
  }

  for (const src of (params.eventSources ?? []).slice(0, 4)) {
    const preset = MATTER_EVENT_SOURCE_PRESETS[src.source];
    if (!preset) continue;
    const contains: Record<string, string> = {};
    if (src.keyword?.trim()) contains.subject = src.keyword.trim();
    if (src.sender?.trim()) contains.sender = src.sender.trim();
    const matchPredicates = {
      ...(Object.keys(contains).length > 0 ? { contains } : {}),
      excludeAutomatedSenders: true,
    };
    const sub = createProactiveSubscription(params.ownerId, {
      scopeType: params.projectId ? 'project' : 'global',
      ...(params.projectId ? { scopeId: params.projectId } : {}),
      sourcePattern: preset.sourcePattern,
      eventTypePattern: preset.eventTypePattern,
      matchPredicates,
      defaultRoute: subRoute,
      coalesceWindowMs: preset.coalesceMs,
      enabled: true,
    }, 'user_explicit', params.now);
    bindings.push({
      kind: 'event_source',
      subscriptionId: sub.id,
      sourcePattern: sub.sourcePattern,
      eventTypePattern: sub.eventTypePattern,
      label: preset.label,
      ...(src.keyword?.trim() ? { keyword: src.keyword.trim() } : {}),
      ...(src.sender?.trim() ? { sender: src.sender.trim() } : {}),
    });
  }

  for (const rawQuery of (params.searchQueries ?? []).slice(0, 3)) {
    const query = rawQuery.trim().slice(0, 200);
    if (!query) continue;
    bindings.push({
      kind: 'web_search',
      query,
      label: query.slice(0, 60),
    });
  }

  return { bindings, createdWatchIds };
}

export function listMatters(ownerId: string, options?: { includeClosed?: boolean }): FollowUpMatter[] {
  const rank: Record<MatterStatus, number> = {
    waiting_user: 0,
    active: 1,
    paused: 2,
    resolved: 3,
    expired: 4,
  };
  return [...storeFor(ownerId).entries()]
    .map(([, matter]) => matter)
    .filter(matter => options?.includeClosed || (matter.status !== 'resolved' && matter.status !== 'expired'))
    .sort((a, b) => rank[a.status] - rank[b.status] || b.updatedAt - a.updatedAt);
}

export function getMatter(ownerId: string, matterId: string): FollowUpMatter | undefined {
  return storeFor(ownerId).get(matterId);
}

/**
 * Returns watchIds and subscriptionIds owned by non-deleted matters so unified lists avoid duplicate rows.
 */
export function collectMatterOwnedBindingIds(ownerId: string): {
  watchIds: Set<string>;
  subscriptionIds: Set<string>;
} {
  const watchIds = new Set<string>();
  const subscriptionIds = new Set<string>();
  for (const matter of listMatters(ownerId, { includeClosed: true })) {
    for (const binding of matter.bindings) {
      if (binding.kind === 'web_url') watchIds.add(binding.watchId);
      if (binding.kind === 'event_source') subscriptionIds.add(binding.subscriptionId);
    }
  }
  return { watchIds, subscriptionIds };
}

export interface CreateMatterInput {
  ownerId: string;
  conversationId: string;
  title: string;
  goal: string;
  notifyWhen: string;
  doneCriteria?: string;
  deliveryPreference?: MatterDeliveryPreference;
  deadlineAt?: number | null;
  checkIntervalMs?: number;
  projectId?: string;
  taskId?: string;
  urls?: readonly string[];
  eventSources?: readonly MatterEventSourceInput[];
  searchQueries?: readonly string[];
  blocklist?: WebsiteBlocklistConfig;
}

export function createOrReuseMatter(
  input: CreateMatterInput,
  now = Date.now(),
): { outcome: 'created' | 'reused_active'; matter: FollowUpMatter; createdWatchIds: string[] } {
  const title = input.title.trim().slice(0, 140);
  const goal = input.goal.trim().slice(0, 800);
  const notifyWhen = input.notifyWhen.trim().slice(0, 400);
  if (!title || !goal || !notifyWhen) {
    throw new Error('title, goal, and notifyWhen are required to create a follow-up matter');
  }

  const existing = listMatters(input.ownerId, { includeClosed: false });
  const titleKey = normalizeTitleKey(title);
  const duplicate = existing.find(item =>
    (item.status === 'active' || item.status === 'waiting_user')
    && normalizeTitleKey(item.title) === titleKey,
  );
  if (duplicate) {
    return { outcome: 'reused_active', matter: duplicate, createdWatchIds: [] };
  }

  const activeCount = existing.filter(item => item.status === 'active' || item.status === 'waiting_user').length;
  if (activeCount >= MAX_ACTIVE_MATTERS) {
    throw new Error(`Active follow-up matters limit (${MAX_ACTIVE_MATTERS}) reached; resolve or pause an existing matter first`);
  }

  const hasFastSensor = Boolean((input.urls?.length ?? 0) > 0 || (input.deadlineAt && input.deadlineAt - now <= 24 * 3_600_000));
  const defaultInterval = hasFastSensor ? 30 * 60_000 : DEFAULT_MATTER_INTERVAL_MS;
  const checkIntervalMs = Math.max(
    MIN_MATTER_INTERVAL_MS,
    Math.min(input.checkIntervalMs ?? defaultInterval, MAX_MATTER_INTERVAL_MS),
  );
  const deliveryPreference: MatterDeliveryPreference = input.deliveryPreference ?? 'auto';

  const { bindings, createdWatchIds } = provisionBindings({
    ownerId: input.ownerId,
    title,
    notifyWhen,
    deliveryPreference,
    projectId: input.projectId,
    taskId: input.taskId,
    urls: input.urls,
    eventSources: input.eventSources,
    searchQueries: input.searchQueries,
    blocklist: input.blocklist,
    intervalMs: checkIntervalMs,
    now,
  });

  const id = `matter:${randomUUID().slice(0, 12)}`;
  const initialSummary = bindings.length > 0
    ? `已开始跟进（已接入 ${bindings.length} 个来源），等待首次检查`
    : '已开始跟进，等待首次检查';

  const matter: FollowUpMatter = {
    id,
    ownerId: input.ownerId,
    conversationId: input.conversationId,
    title,
    goal,
    notifyWhen,
    ...(input.doneCriteria?.trim() ? { doneCriteria: input.doneCriteria.trim().slice(0, 400) } : {}),
    status: 'active',
    deliveryPreference,
    deadlineAt: input.deadlineAt ?? null,
    checkIntervalMs,
    nextCheckAt: now,
    lastCheckedAt: null,
    lastSummary: initialSummary,
    lastError: null,
    errorNotifiedAt: null,
    bindings,
    progressLog: appendLog([], {
      at: now,
      kind: 'created',
      summary: `开始跟进「${title}」：${notifyWhen}`,
      nextCheckAt: now,
    }),
    revision: 1,
    createdAt: now,
    updatedAt: now,
  };

  storeFor(input.ownerId).set(id, matter);
  return { outcome: 'created', matter, createdWatchIds };
}

export interface PatchMatterInput {
  expectedRevision?: number;
  title?: string;
  goal?: string;
  notifyWhen?: string;
  doneCriteria?: string;
  status?: MatterStatus;
  deliveryPreference?: MatterDeliveryPreference;
  deadlineAt?: number | null;
  checkIntervalMs?: number;
  nextCheckAt?: number | null;
  userNote?: string;
  addUrls?: readonly string[];
  addEventSources?: readonly MatterEventSourceInput[];
  addSearchQueries?: readonly string[];
  blocklist?: WebsiteBlocklistConfig;
}

export function patchMatter(
  ownerId: string,
  matterId: string,
  patch: PatchMatterInput,
  now = Date.now(),
): { matter: FollowUpMatter; createdWatchIds: string[] } {
  const store = storeFor(ownerId);
  const current = store.get(matterId);
  if (!current) {
    throw new Error('Follow-up matter not found');
  }
  if (patch.expectedRevision !== undefined && current.revision !== patch.expectedRevision) {
    throw new Error('Follow-up matter changed; reload before updating');
  }

  const nextStatus = patch.status ?? current.status;
  const nextNotifyWhen = patch.notifyWhen?.trim().slice(0, 400) || current.notifyWhen;
  const nextDelivery = patch.deliveryPreference ?? current.deliveryPreference;
  const nextIntervalMs = patch.checkIntervalMs !== undefined
    ? Math.max(MIN_MATTER_INTERVAL_MS, Math.min(patch.checkIntervalMs, MAX_MATTER_INTERVAL_MS))
    : current.checkIntervalMs;

  const projectId = current.bindings.find(b => b.kind === 'project')?.projectId;
  const added = provisionBindings({
    ownerId,
    title: patch.title?.trim() || current.title,
    notifyWhen: nextNotifyWhen,
    deliveryPreference: nextDelivery,
    projectId,
    urls: patch.addUrls,
    eventSources: patch.addEventSources,
    searchQueries: patch.addSearchQueries,
    blocklist: patch.blocklist,
    intervalMs: nextIntervalMs,
    now,
  });

  const existingKeys = new Set(current.bindings.map(b => JSON.stringify(b)));
  const mergedBindings = [
    ...current.bindings,
    ...added.bindings.filter(b => !existingKeys.has(JSON.stringify(b))),
  ].slice(0, 12);

  let nextLog = current.progressLog;
  let nextSummary = current.lastSummary;
  if (patch.userNote?.trim()) {
    const note = patch.userNote.trim().slice(0, 600);
    nextLog = appendLog(nextLog, { at: now, kind: 'user_note', summary: `用户补充：${note}` });
    nextSummary = note.slice(0, 200);
  }
  if (patch.status && patch.status !== current.status) {
    const labelMap: Record<MatterStatus, string> = {
      active: '已恢复跟进',
      waiting_user: '等待用户确认',
      paused: '已暂停跟进',
      resolved: '已标记为解决并结束跟进',
      expired: '已到期结束',
    };
    nextLog = appendLog(nextLog, { at: now, kind: patch.status === 'resolved' ? 'resolved' : 'state_changed', summary: labelMap[patch.status] });
    nextSummary = labelMap[patch.status];
  }

  const shouldEnableBindings = nextStatus === 'active' || nextStatus === 'waiting_user';
  if (nextStatus !== current.status) {
    syncMatterBindingsEnabled(ownerId, mergedBindings, shouldEnableBindings, now);
  }

  const nextCheckAt = patch.nextCheckAt !== undefined
    ? patch.nextCheckAt
    : !shouldEnableBindings
      ? null
      : (current.status === 'paused' && nextStatus === 'active')
        ? now
        : current.nextCheckAt ?? now + nextIntervalMs;

  const updated: FollowUpMatter = {
    ...current,
    title: patch.title?.trim().slice(0, 140) || current.title,
    goal: patch.goal?.trim().slice(0, 800) || current.goal,
    notifyWhen: nextNotifyWhen,
    ...(patch.doneCriteria !== undefined
      ? (patch.doneCriteria.trim() ? { doneCriteria: patch.doneCriteria.trim().slice(0, 400) } : {})
      : (current.doneCriteria ? { doneCriteria: current.doneCriteria } : {})),
    status: nextStatus,
    deliveryPreference: nextDelivery,
    deadlineAt: patch.deadlineAt !== undefined ? patch.deadlineAt : current.deadlineAt,
    checkIntervalMs: nextIntervalMs,
    nextCheckAt,
    lastSummary: nextSummary,
    ...(nextStatus === 'active' && current.status !== 'active' ? { lastError: null, errorNotifiedAt: null } : {}),
    bindings: mergedBindings,
    progressLog: nextLog,
    revision: current.revision + 1,
    updatedAt: now,
  };

  store.set(matterId, updated);
  return { matter: updated, createdWatchIds: added.createdWatchIds };
}

export function recordMatterInvestigationOutcome(
  ownerId: string,
  matterId: string,
  outcome: {
    status: MatterStatus;
    logKind: MatterProgressEntry['kind'];
    summary: string;
    evidenceRefs?: string[];
    preparedDraft?: string;
    inboxItemId?: string;
    nextCheckAt: number | null;
    lastError?: string | null;
    errorNotifiedAt?: number | null;
  },
  now = Date.now(),
): FollowUpMatter | undefined {
  const store = storeFor(ownerId);
  const current = store.get(matterId);
  if (!current) return undefined;

  if (outcome.status === 'resolved' || outcome.status === 'expired' || outcome.status === 'paused') {
    syncMatterBindingsEnabled(ownerId, current.bindings, false, now);
  }

  const updated: FollowUpMatter = {
    ...current,
    status: outcome.status,
    lastCheckedAt: now,
    nextCheckAt: outcome.nextCheckAt,
    lastSummary: outcome.summary.slice(0, 320),
    lastError: outcome.lastError !== undefined ? outcome.lastError : null,
    errorNotifiedAt: outcome.errorNotifiedAt !== undefined ? outcome.errorNotifiedAt : current.errorNotifiedAt,
    progressLog: appendLog(current.progressLog, {
      at: now,
      kind: outcome.logKind,
      summary: outcome.summary.slice(0, 600),
      ...(outcome.evidenceRefs?.length ? { evidenceRefs: outcome.evidenceRefs.slice(0, 8) } : {}),
      ...(outcome.preparedDraft ? { preparedDraft: outcome.preparedDraft.slice(0, 4000) } : {}),
      ...(outcome.inboxItemId ? { inboxItemId: outcome.inboxItemId } : {}),
      nextCheckAt: outcome.nextCheckAt,
    }),
    revision: current.revision + 1,
    updatedAt: now,
  };
  store.set(matterId, updated);
  return updated;
}

export function deleteMatter(ownerId: string, matterId: string, now = Date.now()): boolean {
  const store = storeFor(ownerId);
  const current = store.get(matterId);
  if (!current) return false;
  for (const binding of current.bindings) {
    if (binding.kind === 'web_url') {
      deleteWebWatch(ownerId, binding.watchId, now);
    } else if (binding.kind === 'event_source') {
      const sub = listProactiveSubscriptions(ownerId).find(s => s.id === binding.subscriptionId);
      if (sub && sub.enabled) {
        try {
          patchProactiveSubscription(ownerId, sub.id, { expectedRevision: sub.revision, enabled: false }, now);
        } catch {
          // Best-effort cleanup.
        }
      }
    }
  }
  store.delete(matterId);
  return true;
}

export function findMattersMatchingBinding(
  ownerId: string,
  match: { watchId?: string; subscriptionId?: string; taskId?: string; projectId?: string },
): FollowUpMatter[] {
  return listMatters(ownerId, { includeClosed: false }).filter(matter => {
    if (matter.status !== 'active' && matter.status !== 'waiting_user') return false;
    return matter.bindings.some(binding =>
      (match.watchId && binding.kind === 'web_url' && binding.watchId === match.watchId)
      || (match.subscriptionId && binding.kind === 'event_source' && binding.subscriptionId === match.subscriptionId)
      || (match.taskId && binding.kind === 'task' && binding.taskId === match.taskId)
      || (match.projectId && binding.kind === 'project' && binding.projectId === match.projectId),
    );
  });
}
