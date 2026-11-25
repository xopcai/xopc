import { randomUUID } from 'node:crypto';

import type { AutomationEventEnvelope } from '../automations/domain/types.js';
import { hasCoveringOneShotFollowUp } from '../personal-agent/proactivity/one-shot-follow-up.js';
import { getSqliteDatabase, runSqliteWriteTransaction } from '../storage/sqlite/transaction.js';
import {
  computeCoalesceKey,
  computeSignalFingerprint,
  isLikelyAutomatedNoiseEvent,
  selectMatchingSubscription,
} from './preflight.js';
import {
  CreateProactiveSubscriptionSchema,
  PatchProactiveSubscriptionSchema,
  type CoalescedSignal,
  type CreateProactiveSubscriptionInput,
  type PatchProactiveSubscriptionInput,
  type PreparedScoutPackage,
  type ProactiveAuthority,
  type ProactiveCategory,
  type ProactiveHubMetrics,
  type ProactiveHumanResolution,
  type ProactiveItem,
  type ProactiveItemResolutionInput,
  type ProactiveItemState,
  type ProactiveProposedAction,
  type ProactiveProvenance,
  type ProactiveRouteHint,
  type ProactiveSubscription,
  type ProactiveTier,
} from './types.js';

type SubscriptionRow = {
  id: string;
  owner_id: string;
  scope_type: ProactiveSubscription['scopeType'];
  scope_id: string | null;
  source_pattern: string;
  event_type_pattern: string;
  match_predicates_json: string;
  default_route: ProactiveRouteHint;
  coalesce_window_ms: number;
  authority: ProactiveAuthority;
  enabled: number;
  revision: number;
  created_at: number;
  updated_at: number;
};

type SignalRow = {
  owner_id: string;
  coalesce_key: string;
  subscription_id: string | null;
  source: string;
  event_type: string;
  subject_kind: string | null;
  subject_id: string | null;
  trust: AutomationEventEnvelope['trust'];
  latest_event_id: string;
  event_ids_json: string;
  event_count: number;
  payload_json: string;
  content_fingerprint: string;
  route_hint: ProactiveRouteHint;
  window_started_at: number;
  flush_after: number;
  status: CoalescedSignal['status'];
  lease_token: string | null;
  lease_until: number;
  updated_at: number;
};

type ItemRow = {
  id: string;
  owner_id: string;
  agent_id: string;
  coalesce_key: string;
  source_event_ids_json: string;
  tier: ProactiveTier;
  category: ProactiveCategory;
  title: string;
  summary: string;
  provenance_json: string;
  prepared_payload_json: string | null;
  proposed_action_json: string | null;
  state: ProactiveItemState;
  digest_batch_id: string | null;
  conversation_entry_id: string | null;
  human_resolution_json: string | null;
  idempotency_key: string;
  valid_until: number;
  created_at: number;
  updated_at: number;
};

const SYSTEM_DEFAULT_SUBSCRIPTIONS: ReadonlyArray<{
  idSuffix: string;
  sourcePattern: string;
  eventTypePattern: string;
  defaultRoute: ProactiveRouteHint;
  coalesceWindowMs: number;
  excludeAutomatedSenders?: boolean;
}> = [
  {
    idSuffix: 'connector-mail',
    sourcePattern: 'composio:gmail*',
    eventTypePattern: 'connector.*',
    defaultRoute: 'triage',
    coalesceWindowMs: 120_000,
    excludeAutomatedSenders: true,
  },
  {
    idSuffix: 'connector-calendar',
    sourcePattern: 'composio:googlecalendar*',
    eventTypePattern: 'connector.*',
    defaultRoute: 'force_scout',
    coalesceWindowMs: 60_000,
  },
  {
    idSuffix: 'temporal-meeting',
    sourcePattern: 'temporal:calendar',
    eventTypePattern: 'temporal.meeting.upcoming',
    defaultRoute: 'force_scout',
    coalesceWindowMs: 0,
  },
  {
    idSuffix: 'connector-github',
    sourcePattern: 'composio:github*',
    eventTypePattern: 'connector.*',
    defaultRoute: 'triage',
    coalesceWindowMs: 180_000,
    excludeAutomatedSenders: true,
  },
  {
    idSuffix: 'connector-linear',
    sourcePattern: 'composio:linear*',
    eventTypePattern: 'connector.*',
    defaultRoute: 'triage',
    coalesceWindowMs: 120_000,
  },
  {
    idSuffix: 'local-folder',
    sourcePattern: 'local:folder',
    eventTypePattern: 'local.folder.batch_changed',
    defaultRoute: 'triage',
    coalesceWindowMs: 30_000,
  },
  {
    idSuffix: 'local-git',
    sourcePattern: 'local:git',
    eventTypePattern: 'local.git.repo_state_changed',
    defaultRoute: 'digest_only',
    coalesceWindowMs: 300_000,
  },
  {
    idSuffix: 'desktop-browser',
    sourcePattern: 'endpoint:browser',
    eventTypePattern: 'endpoint.browser.saved_item',
    defaultRoute: 'digest_only',
    coalesceWindowMs: 300_000,
  },
  {
    idSuffix: 'desktop-context',
    sourcePattern: 'endpoint:desktop',
    eventTypePattern: 'endpoint.desktop.*',
    defaultRoute: 'triage',
    coalesceWindowMs: 120_000,
  },
];

function mapSubscription(row: SubscriptionRow): ProactiveSubscription {
  return {
    id: row.id,
    ownerId: row.owner_id,
    scopeType: row.scope_type,
    ...(row.scope_id ? { scopeId: row.scope_id } : {}),
    sourcePattern: row.source_pattern,
    eventTypePattern: row.event_type_pattern,
    matchPredicates: JSON.parse(row.match_predicates_json),
    defaultRoute: row.default_route,
    coalesceWindowMs: row.coalesce_window_ms,
    authority: row.authority,
    enabled: row.enabled === 1,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapSignal(row: SignalRow): CoalescedSignal {
  return {
    ownerId: row.owner_id,
    coalesceKey: row.coalesce_key,
    ...(row.subscription_id ? { subscriptionId: row.subscription_id } : {}),
    source: row.source,
    eventType: row.event_type,
    ...(row.subject_kind ? { subjectKind: row.subject_kind } : {}),
    ...(row.subject_id ? { subjectId: row.subject_id } : {}),
    trust: row.trust,
    latestEventId: row.latest_event_id,
    eventIds: JSON.parse(row.event_ids_json) as string[],
    eventCount: row.event_count,
    payload: JSON.parse(row.payload_json) as Record<string, unknown>,
    contentFingerprint: row.content_fingerprint,
    routeHint: row.route_hint,
    windowStartedAt: row.window_started_at,
    flushAfter: row.flush_after,
    status: row.status,
    ...(row.lease_token ? { leaseToken: row.lease_token } : {}),
    leaseUntil: row.lease_until,
    updatedAt: row.updated_at,
  };
}

function mapItem(row: ItemRow): ProactiveItem {
  return {
    id: row.id,
    ownerId: row.owner_id,
    agentId: row.agent_id,
    coalesceKey: row.coalesce_key,
    sourceEventIds: JSON.parse(row.source_event_ids_json) as string[],
    tier: row.tier,
    category: row.category,
    title: row.title,
    summary: row.summary,
    provenance: JSON.parse(row.provenance_json) as ProactiveProvenance,
    ...(row.prepared_payload_json ? { preparedPayload: JSON.parse(row.prepared_payload_json) as PreparedScoutPackage } : {}),
    ...(row.proposed_action_json ? { proposedAction: JSON.parse(row.proposed_action_json) as ProactiveProposedAction } : {}),
    state: row.state,
    ...(row.digest_batch_id ? { digestBatchId: row.digest_batch_id } : {}),
    ...(row.conversation_entry_id ? { conversationEntryId: row.conversation_entry_id } : {}),
    ...(row.human_resolution_json ? { humanResolution: JSON.parse(row.human_resolution_json) as ProactiveHumanResolution } : {}),
    idempotencyKey: row.idempotency_key,
    validUntil: row.valid_until,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function ensureDefaultProactiveSubscriptions(ownerId: string, now = Date.now()): void {
  runSqliteWriteTransaction(db => {
    const stmt = db.prepare(`
      INSERT OR IGNORE INTO proactive_subscriptions(
        id, owner_id, scope_type, scope_id, source_pattern, event_type_pattern,
        match_predicates_json, default_route, coalesce_window_ms, authority, enabled, revision, created_at, updated_at
      ) VALUES (?, ?, 'global', NULL, ?, ?, ?, ?, ?, 'system_default', 1, 1, ?, ?)
    `);
    for (const def of SYSTEM_DEFAULT_SUBSCRIPTIONS) {
      stmt.run(
        `sys:${ownerId}:${def.idSuffix}`,
        ownerId,
        def.sourcePattern,
        def.eventTypePattern,
        JSON.stringify(def.excludeAutomatedSenders ? { excludeAutomatedSenders: true } : {}),
        def.defaultRoute,
        def.coalesceWindowMs,
        now,
        now,
      );
    }
  });
}

export function listProactiveSubscriptions(ownerId: string): ProactiveSubscription[] {
  ensureDefaultProactiveSubscriptions(ownerId);
  const rows = getSqliteDatabase()
    .prepare('SELECT * FROM proactive_subscriptions WHERE owner_id = ? ORDER BY updated_at DESC, id ASC')
    .all(ownerId) as unknown as SubscriptionRow[];
  return rows.map(mapSubscription);
}

export function createProactiveSubscription(
  ownerId: string,
  input: CreateProactiveSubscriptionInput,
  authority: ProactiveAuthority = 'user_explicit',
  now = Date.now(),
  explicitId?: string,
): ProactiveSubscription {
  const parsed = CreateProactiveSubscriptionSchema.parse(input);
  const id = explicitId ?? randomUUID();
  return runSqliteWriteTransaction(db => {
    db.prepare(`
      INSERT INTO proactive_subscriptions(
        id, owner_id, scope_type, scope_id, source_pattern, event_type_pattern,
        match_predicates_json, default_route, coalesce_window_ms, authority, enabled, revision, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    `).run(
      id,
      ownerId,
      parsed.scopeType,
      parsed.scopeId ?? null,
      parsed.sourcePattern,
      parsed.eventTypePattern,
      JSON.stringify(parsed.matchPredicates),
      parsed.defaultRoute,
      parsed.coalesceWindowMs,
      authority,
      parsed.enabled ? 1 : 0,
      now,
      now,
    );
    const created = db.prepare('SELECT * FROM proactive_subscriptions WHERE id = ?').get(id) as unknown as SubscriptionRow;
    return mapSubscription(created);
  });
}

export function patchProactiveSubscription(
  ownerId: string,
  subscriptionId: string,
  input: PatchProactiveSubscriptionInput,
  now = Date.now(),
): ProactiveSubscription {
  const parsed = PatchProactiveSubscriptionSchema.parse(input);
  return runSqliteWriteTransaction(db => {
    const existing = db.prepare('SELECT * FROM proactive_subscriptions WHERE id = ? AND owner_id = ?')
      .get(subscriptionId, ownerId) as unknown as SubscriptionRow | undefined;
    if (!existing) throw new Error('Proactive subscription not found');
    if (existing.revision !== parsed.expectedRevision) {
      throw new Error('Proactive subscription revision conflict');
    }
    db.prepare(`
      UPDATE proactive_subscriptions
      SET match_predicates_json = ?,
          default_route = ?,
          coalesce_window_ms = ?,
          enabled = ?,
          revision = revision + 1,
          updated_at = ?
      WHERE id = ? AND owner_id = ?
    `).run(
      parsed.matchPredicates ? JSON.stringify(parsed.matchPredicates) : existing.match_predicates_json,
      parsed.defaultRoute ?? existing.default_route,
      parsed.coalesceWindowMs ?? existing.coalesce_window_ms,
      parsed.enabled === undefined ? existing.enabled : parsed.enabled ? 1 : 0,
      now,
      subscriptionId,
      ownerId,
    );
    const updated = db.prepare('SELECT * FROM proactive_subscriptions WHERE id = ?').get(subscriptionId) as unknown as SubscriptionRow;
    return mapSubscription(updated);
  });
}

export function extractEventTaskWait(event: Pick<AutomationEventEnvelope, 'source' | 'subject' | 'payload'>): {
  taskId?: string;
  waitId?: string;
} {
  const payload = event.payload && typeof event.payload === 'object'
    ? (event.payload as Record<string, unknown>)
    : {};
  const payloadTask = payload.task && typeof payload.task === 'object'
    ? (payload.task as { id?: unknown }).id
    : undefined;
  const taskId = event.subject?.kind === 'task' && typeof event.subject.id === 'string'
    ? event.subject.id
    : typeof payload.taskId === 'string' && payload.taskId
      ? payload.taskId
      : typeof payloadTask === 'string' && payloadTask
        ? payloadTask
        : undefined;
  const waitId = typeof payload.waitId === 'string' && payload.waitId
    ? payload.waitId
    : undefined;
  return {
    ...(taskId ? { taskId } : {}),
    ...(waitId ? { waitId } : {}),
  };
}

export function retireCoveredProactiveItems(
  ownerId: string,
  taskId: string,
  waitId?: string,
  now = Date.now(),
): number {
  return runSqliteWriteTransaction(db => {
    const signals = db.prepare(`
      SELECT coalesce_key, payload_json, subject_kind, subject_id
      FROM proactive_coalesced_signals
      WHERE owner_id = ? AND status IN ('buffering', 'processing')
    `).all(ownerId) as Array<{ coalesce_key: string; payload_json: string; subject_kind: string | null; subject_id: string | null }>;
    for (const sig of signals) {
      const payload = JSON.parse(sig.payload_json) as Record<string, unknown>;
      const extracted = extractEventTaskWait({
        source: 'tasks',
        subject: sig.subject_kind && sig.subject_id ? { kind: sig.subject_kind, id: sig.subject_id } : undefined,
        payload,
      });
      if (extracted.taskId === taskId && (!waitId || !extracted.waitId || extracted.waitId === waitId)) {
        db.prepare(`
          UPDATE proactive_coalesced_signals
          SET status = 'dropped', lease_token = NULL, lease_until = 0, updated_at = ?
          WHERE owner_id = ? AND coalesce_key = ?
        `).run(now, ownerId, sig.coalesce_key);
      }
    }

    const items = db.prepare(`
      SELECT id, provenance_json
      FROM proactive_items
      WHERE owner_id = ? AND state IN ('ready', 'buffered_digest')
    `).all(ownerId) as Array<{ id: string; provenance_json: string }>;
    let retired = 0;
    for (const item of items) {
      const prov = JSON.parse(item.provenance_json) as ProactiveProvenance;
      if (prov.matchedTaskId === taskId && (!waitId || !prov.matchedWaitId || prov.matchedWaitId === waitId)) {
        db.prepare("UPDATE proactive_items SET state = 'stale', updated_at = ? WHERE id = ?").run(now, item.id);
        retired += 1;
      }
    }
    return retired;
  });
}

export function findActiveEntityAnchor(_ownerId: string, event: AutomationEventEnvelope): {
  projectId?: string;
} {
  const db = getSqliteDatabase();
  const payload = event.payload && typeof event.payload === 'object'
    ? (event.payload as Record<string, unknown>)
    : {};
  const payloadProjectId = typeof payload.projectId === 'string' ? payload.projectId.trim() : '';
  const subjectProjectId = event.subject?.kind === 'project' && typeof event.subject.id === 'string' ? event.subject.id.trim() : '';
  if (subjectProjectId && payloadProjectId && subjectProjectId !== payloadProjectId) return {};
  const projectId = subjectProjectId || payloadProjectId;
  const matchedProject = projectId
    ? db.prepare("SELECT project_id FROM projects WHERE project_id = ? AND status NOT IN ('completed','cancelled','archived') LIMIT 1")
      .get(projectId) as { project_id: string } | undefined
    : undefined;

  return {
    ...(matchedProject ? { projectId: matchedProject.project_id } : {}),
  };
}

export interface Gate1AdmissionResult {
  outcome: 'dropped_unmatched' | 'dropped_rule' | 'dropped_duplicate' | 'coalesced' | 'buffered';
  coalesceKey?: string;
  subscriptionId?: string;
  eventCount?: number;
}

/**
 * Gate 1: Zero-token deterministic preflight filter, bot/noise suppressor,
 * fingerprint deduplicator, and sliding-window coalescer.
 * Internal product events (tasks / projects / sessions) never enter external signal triage.
 */
export function admitSignalAtGate1(
  ownerId: string,
  event: AutomationEventEnvelope,
  now = Date.now(),
): Gate1AdmissionResult {
  // Ignore high-frequency internal session transcript pings already handled by conversation cursor.
  if (event.source === 'sessions' && event.type === 'session.transcript.updated') {
    return { outcome: 'dropped_unmatched' };
  }

  // Internal tasks/projects lifecycle events belong exclusively to Personal explicit follow-ups, never Hub Triage/Scout.
  if (
    event.source === 'tasks'
    || event.source === 'projects'
    || event.type.startsWith('task.')
    || event.type.startsWith('project.')
  ) {
    const taskWait = extractEventTaskWait(event);
    if (taskWait.taskId && hasCoveringOneShotFollowUp(ownerId, taskWait.taskId, taskWait.waitId)) {
      retireCoveredProactiveItems(ownerId, taskWait.taskId, taskWait.waitId, now);
    }
    return { outcome: 'dropped_rule' };
  }

  ensureDefaultProactiveSubscriptions(ownerId, now);

  return runSqliteWriteTransaction(db => {
    const subs = (db.prepare('SELECT * FROM proactive_subscriptions WHERE owner_id = ? AND enabled = 1')
      .all(ownerId) as unknown as SubscriptionRow[]).map(mapSubscription);
    const anchor = findActiveEntityAnchor(ownerId, event);
    const matchedSub = selectMatchingSubscription(subs, event, anchor.projectId);

    if (!matchedSub && !anchor.projectId) {
      return { outcome: 'dropped_unmatched' };
    }

    const coalesceKey = computeCoalesceKey(event, anchor.projectId);
    if (matchedSub?.defaultRoute === 'drop') {
      const fingerprint = computeSignalFingerprint(event);
      db.prepare(`
        INSERT INTO proactive_coalesced_signals(
          owner_id, coalesce_key, subscription_id, source, event_type, subject_kind, subject_id, trust,
          latest_event_id, event_ids_json, event_count, payload_json, content_fingerprint, route_hint,
          window_started_at, flush_after, status, lease_until, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, 'drop', ?, ?, 'dropped', 0, ?)
        ON CONFLICT(owner_id, coalesce_key) DO UPDATE SET
          latest_event_id = excluded.latest_event_id,
          event_count = proactive_coalesced_signals.event_count + 1,
          content_fingerprint = excluded.content_fingerprint,
          status = 'dropped',
          updated_at = excluded.updated_at
      `).run(
        ownerId,
        coalesceKey,
        matchedSub.id,
        event.source,
        event.type,
        event.subject?.kind ?? null,
        event.subject?.id ?? null,
        event.trust,
        event.id,
        JSON.stringify([event.id]),
        JSON.stringify(event.payload),
        fingerprint,
        now,
        now,
        now,
      );
      return { outcome: 'dropped_rule', coalesceKey, subscriptionId: matchedSub.id };
    }

    if (!matchedSub && isLikelyAutomatedNoiseEvent(event)) {
      return { outcome: 'dropped_rule' };
    }

    const fingerprint = computeSignalFingerprint(event);
    const existing = db.prepare('SELECT * FROM proactive_coalesced_signals WHERE owner_id = ? AND coalesce_key = ?')
      .get(ownerId, coalesceKey) as unknown as SignalRow | undefined;

    if (existing && existing.content_fingerprint === fingerprint && existing.status !== 'dropped') {
      return { outcome: 'dropped_duplicate', coalesceKey, subscriptionId: matchedSub?.id };
    }

    const routeHint: ProactiveRouteHint = matchedSub?.defaultRoute ?? 'triage';
    const windowMs = event.payload.urgent === true ? 0 : (matchedSub?.coalesceWindowMs ?? 120_000);

    if (existing && existing.status === 'buffering') {
      const priorIds = JSON.parse(existing.event_ids_json) as string[];
      const mergedIds = [...new Set([...priorIds, event.id])].slice(-25);
      const nextCount = existing.event_count + 1;
      const flushAfter = windowMs === 0 ? now : Math.min(existing.window_started_at + windowMs * 2, now + windowMs);
      db.prepare(`
        UPDATE proactive_coalesced_signals
        SET subscription_id = ?,
            latest_event_id = ?,
            event_ids_json = ?,
            event_count = ?,
            payload_json = ?,
            content_fingerprint = ?,
            route_hint = ?,
            flush_after = ?,
            updated_at = ?
        WHERE owner_id = ? AND coalesce_key = ?
      `).run(
        matchedSub?.id ?? existing.subscription_id,
        event.id,
        JSON.stringify(mergedIds),
        nextCount,
        JSON.stringify(event.payload),
        fingerprint,
        routeHint,
        flushAfter,
        now,
        ownerId,
        coalesceKey,
      );
      return { outcome: 'coalesced', coalesceKey, subscriptionId: matchedSub?.id, eventCount: nextCount };
    }

    db.prepare(`
      INSERT INTO proactive_coalesced_signals(
        owner_id, coalesce_key, subscription_id, source, event_type, subject_kind, subject_id, trust,
        latest_event_id, event_ids_json, event_count, payload_json, content_fingerprint, route_hint,
        window_started_at, flush_after, status, lease_token, lease_until, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, 'buffering', NULL, 0, ?)
      ON CONFLICT(owner_id, coalesce_key) DO UPDATE SET
        subscription_id = excluded.subscription_id,
        latest_event_id = excluded.latest_event_id,
        event_ids_json = excluded.event_ids_json,
        event_count = 1,
        payload_json = excluded.payload_json,
        content_fingerprint = excluded.content_fingerprint,
        route_hint = excluded.route_hint,
        window_started_at = excluded.window_started_at,
        flush_after = excluded.flush_after,
        status = 'buffering',
        lease_token = NULL,
        lease_until = 0,
        updated_at = excluded.updated_at
    `).run(
      ownerId,
      coalesceKey,
      matchedSub?.id ?? null,
      event.source,
      event.type,
      event.subject?.kind ?? null,
      event.subject?.id ?? null,
      event.trust,
      event.id,
      JSON.stringify([event.id]),
      JSON.stringify(event.payload),
      fingerprint,
      routeHint,
      now,
      now + windowMs,
      now,
    );
    return { outcome: 'buffered', coalesceKey, subscriptionId: matchedSub?.id, eventCount: 1 };
  });
}

export function claimDueCoalescedSignals(now = Date.now(), limit = 10, leaseDurationMs = 30_000): CoalescedSignal[] {
  return runSqliteWriteTransaction(db => {
    const rows = db.prepare(`
      SELECT * FROM proactive_coalesced_signals
      WHERE status IN ('buffering', 'processing')
        AND flush_after <= ?
        AND lease_until <= ?
      ORDER BY flush_after ASC
      LIMIT ?
    `).all(now, now, limit) as unknown as SignalRow[];
    const claimed: CoalescedSignal[] = [];
    for (const row of rows) {
      const leaseToken = randomUUID();
      db.prepare(`
        UPDATE proactive_coalesced_signals
        SET status = 'processing', lease_token = ?, lease_until = ?, updated_at = ?
        WHERE owner_id = ? AND coalesce_key = ?
      `).run(leaseToken, now + leaseDurationMs, now, row.owner_id, row.coalesce_key);
      claimed.push(mapSignal({ ...row, status: 'processing', lease_token: leaseToken, lease_until: now + leaseDurationMs, updated_at: now }));
    }
    return claimed;
  });
}

export function finalizeCoalescedSignal(
  ownerId: string,
  coalesceKey: string,
  leaseToken: string,
  finalStatus: 'triaged' | 'dropped',
  now = Date.now(),
): boolean {
  return runSqliteWriteTransaction(db => {
    const res = db.prepare(`
      UPDATE proactive_coalesced_signals
      SET status = ?, lease_token = NULL, lease_until = 0, updated_at = ?
      WHERE owner_id = ? AND coalesce_key = ? AND lease_token = ?
    `).run(finalStatus, now, ownerId, coalesceKey, leaseToken);
    return res.changes > 0;
  });
}

export function saveProactiveItem(input: {
  id?: string;
  ownerId: string;
  agentId: string;
  coalesceKey: string;
  sourceEventIds: string[];
  tier: ProactiveTier;
  category: ProactiveCategory;
  title: string;
  summary: string;
  provenance: ProactiveProvenance;
  preparedPayload?: PreparedScoutPackage;
  proposedAction?: ProactiveProposedAction;
  state: ProactiveItemState;
  idempotencyKey: string;
  validUntil: number;
  now?: number;
}): ProactiveItem {
  const now = input.now ?? Date.now();
  const id = input.id ?? randomUUID();
  return runSqliteWriteTransaction(db => {
    const existingByIdem = db.prepare('SELECT * FROM proactive_items WHERE idempotency_key = ?')
      .get(input.idempotencyKey) as unknown as ItemRow | undefined;
    if (existingByIdem) return mapItem(existingByIdem);

    // Supersede any older un-acted item on the same coalesceKey so Inbox never shows stale duplicates.
    db.prepare(`
      UPDATE proactive_items
      SET state = 'stale', updated_at = ?
      WHERE owner_id = ? AND coalesce_key = ? AND state IN ('ready', 'buffered_digest')
    `).run(now, input.ownerId, input.coalesceKey);

    const effectiveState = input.provenance.matchedTaskId
      && hasCoveringOneShotFollowUp(input.ownerId, input.provenance.matchedTaskId, input.provenance.matchedWaitId)
      ? 'stale'
      : input.state;

    db.prepare(`
      INSERT INTO proactive_items(
        id, owner_id, agent_id, coalesce_key, source_event_ids_json, tier, category,
        title, summary, provenance_json, prepared_payload_json, proposed_action_json,
        state, digest_batch_id, conversation_entry_id, human_resolution_json,
        idempotency_key, valid_until, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, ?, ?)
    `).run(
      id,
      input.ownerId,
      input.agentId,
      input.coalesceKey,
      JSON.stringify(input.sourceEventIds),
      input.tier,
      input.category,
      input.title.slice(0, 240),
      input.summary.slice(0, 4_000),
      JSON.stringify(input.provenance),
      input.preparedPayload ? JSON.stringify(input.preparedPayload) : null,
      input.proposedAction ? JSON.stringify(input.proposedAction) : null,
      effectiveState,
      input.idempotencyKey,
      input.validUntil,
      now,
      now,
    );
    const inserted = db.prepare('SELECT * FROM proactive_items WHERE id = ?').get(id) as unknown as ItemRow;
    return mapItem(inserted);
  });
}

export function getProactiveItem(ownerId: string, itemId: string): ProactiveItem | undefined {
  const row = getSqliteDatabase()
    .prepare('SELECT * FROM proactive_items WHERE id = ? AND owner_id = ?')
    .get(itemId, ownerId) as unknown as ItemRow | undefined;
  return row ? mapItem(row) : undefined;
}

export function listProactiveInboxItems(
  ownerId: string,
  options: { includeActed?: boolean; limit?: number; now?: number } = {},
): ProactiveItem[] {
  const now = options.now ?? Date.now();
  const limit = Math.max(1, Math.min(options.limit ?? 30, 100));
  const db = getSqliteDatabase();
  db.prepare(`
    UPDATE proactive_items SET state = 'expired', updated_at = ?
    WHERE owner_id = ? AND state IN ('ready', 'delivered', 'buffered_digest') AND valid_until <= ?
  `).run(now, ownerId, now);

  const states = options.includeActed
    ? ['ready', 'delivered', 'acted', 'snoozed']
    : ['ready', 'delivered'];
  const placeholders = states.map(() => '?').join(', ');
  const rows = db.prepare(`
    SELECT * FROM proactive_items
    WHERE owner_id = ?
      AND tier IN ('tier_s_chat', 'tier_a_inbox')
      AND state IN (${placeholders})
    ORDER BY CASE tier WHEN 'tier_s_chat' THEN 0 ELSE 1 END ASC, created_at DESC
    LIMIT ?
  `).all(ownerId, ...states, limit) as unknown as ItemRow[];
  return rows.map(mapItem);
}

export function listPulseDigests(ownerId: string, limit = 10): ProactiveItem[] {
  const rows = getSqliteDatabase().prepare(`
    SELECT * FROM proactive_items
    WHERE owner_id = ? AND category = 'pulse_digest' AND state IN ('ready', 'delivered', 'acted')
    ORDER BY created_at DESC
    LIMIT ?
  `).all(ownerId, Math.max(1, Math.min(limit, 50))) as unknown as ItemRow[];
  return rows.map(mapItem);
}

export function listBufferedDigestCandidates(ownerId: string, now = Date.now()): ProactiveItem[] {
  const rows = getSqliteDatabase().prepare(`
    SELECT * FROM proactive_items
    WHERE owner_id = ? AND tier = 'tier_b_digest' AND state = 'buffered_digest' AND valid_until > ?
    ORDER BY created_at ASC
    LIMIT 25
  `).all(ownerId, now) as unknown as ItemRow[];
  return rows.map(mapItem);
}

/**
 * Aggregates buffered Tier-B items into a single Pulse Digest card without noisy single-item notifications.
 * Returns null when the buffer is empty (silence by default).
 */
export function flushPulseDigestBatch(input: {
  ownerId: string;
  agentId: string;
  windowLabel?: string;
  now?: number;
}): ProactiveItem | null {
  const now = input.now ?? Date.now();
  return runSqliteWriteTransaction(db => {
    const rows = db.prepare(`
      SELECT * FROM proactive_items
      WHERE owner_id = ? AND tier = 'tier_b_digest' AND state = 'buffered_digest' AND valid_until > ?
      ORDER BY created_at ASC
      LIMIT 15
    `).all(input.ownerId, now) as unknown as ItemRow[];
    if (rows.length === 0) return null;

    const items = rows.map(mapItem);
    const batchId = `pulse:${now}:${randomUUID().slice(0, 8)}`;
    const bulletLines = items.map((item, idx) => `${idx + 1}. **${item.title}** — ${item.summary}`);
    const title = input.windowLabel
      ? `${input.windowLabel}（共 ${items.length} 项动态）`
      : `脉冲简报（共 ${items.length} 项关注动态）`;
    const summary = bulletLines.join('\n').slice(0, 4_000);
    const allEventIds = [...new Set(items.flatMap(item => item.sourceEventIds))];
    const allEvidence = [...new Set(items.flatMap(item => item.provenance.evidenceRefs))].slice(0, 20);

    for (const item of items) {
      db.prepare(`
        UPDATE proactive_items
        SET state = 'delivered', digest_batch_id = ?, updated_at = ?
        WHERE id = ?
      `).run(batchId, now, item.id);
    }

    const digestCard = saveProactiveItem({
      ownerId: input.ownerId,
      agentId: input.agentId,
      coalesceKey: `pulse:batch:${batchId}`,
      sourceEventIds: allEventIds,
      tier: 'tier_a_inbox',
      category: 'pulse_digest',
      title,
      summary,
      provenance: {
        source: 'temporal:pulse',
        eventType: 'temporal.pulse.window',
        trust: 'system',
        coalescedCount: items.length,
        reason: `Aggregated ${items.length} non-urgent updates into a single Pulse digest`,
        evidenceRefs: allEvidence,
        score: {
          actionability: 1,
          urgency: 1,
          novelty: 2,
          preparedness: 2,
          disruptionPenalty: 0,
          netScore: 6,
        },
      },
      preparedPayload: {
        verifiedFacts: items.map(item => `${item.title}: ${item.summary}`),
        evidenceRefs: allEvidence,
      },
      state: 'ready',
      idempotencyKey: `digest:${batchId}`,
      validUntil: now + 48 * 3_600_000,
      now,
    });
    return digestCard;
  });
}

export function markProactiveConversationDelivered(
  ownerId: string,
  itemId: string,
  conversationEntryId: string,
  now = Date.now(),
): void {
  runSqliteWriteTransaction(db => {
    db.prepare(`
      UPDATE proactive_items
      SET state = CASE WHEN state = 'ready' THEN 'delivered' ELSE state END,
          conversation_entry_id = ?,
          updated_at = ?
      WHERE id = ? AND owner_id = ?
    `).run(conversationEntryId, now, itemId, ownerId);
  });
}

export function applyProactiveItemResolution(
  ownerId: string,
  itemId: string,
  input: ProactiveItemResolutionInput,
  now = Date.now(),
): ProactiveItem {
  return runSqliteWriteTransaction(db => {
    const row = db.prepare('SELECT * FROM proactive_items WHERE id = ? AND owner_id = ?')
      .get(itemId, ownerId) as unknown as ItemRow | undefined;
    if (!row) throw new Error('Proactive item not found');
    const current = mapItem(row);

    if (current.humanResolution?.idempotencyKey === input.idempotencyKey) {
      return current;
    }
    if (current.state === 'acted' || current.state === 'muted') {
      throw new Error('Proactive item has already been resolved');
    }

    let nextState: ProactiveItemState = 'acted';
    let nextTier: ProactiveTier = current.tier;
    const resolution: ProactiveHumanResolution = {
      action: input.action,
      idempotencyKey: input.idempotencyKey,
      resolvedAt: now,
      ...(current.preparedPayload?.preparedDraft ? { originalDraft: current.preparedPayload.preparedDraft } : {}),
    };

    if (input.action === 'edit_and_approve') {
      resolution.editedDraft = input.editedDraft;
      if (input.note) resolution.note = input.note;
    } else if (input.action === 'approve') {
      if (input.note) resolution.note = input.note;
    } else if (input.action === 'move_to_digest') {
      nextState = 'buffered_digest';
      nextTier = 'tier_b_digest';
    } else if (input.action === 'snooze') {
      nextState = 'snoozed';
    } else if (input.action === 'mute_rule') {
      nextState = 'muted';
      resolution.muteMode = input.mode;
      if (input.senderOrSubjectFilter) resolution.senderOrSubjectFilter = input.senderOrSubjectFilter;
    }

    db.prepare(`
      UPDATE proactive_items
      SET tier = ?,
          state = ?,
          human_resolution_json = ?,
          valid_until = ?,
          updated_at = ?
      WHERE id = ? AND owner_id = ?
    `).run(
      nextTier,
      nextState,
      JSON.stringify(resolution),
      input.action === 'snooze' ? Math.max(input.untilMs, now + 60_000) : current.validUntil,
      now,
      itemId,
      ownerId,
    );

    const updated = db.prepare('SELECT * FROM proactive_items WHERE id = ?').get(itemId) as unknown as ItemRow;
    return mapItem(updated);
  });
}

export function getProactiveHubMetrics(ownerId: string, now = Date.now()): ProactiveHubMetrics {
  const db = getSqliteDatabase();
  const count = (sql: string, ...params: Array<string | number>) =>
    Number((db.prepare(sql).get(...params) as { n?: number } | undefined)?.n ?? 0);

  return {
    activeSubscriptions: count('SELECT COUNT(*) AS n FROM proactive_subscriptions WHERE owner_id = ? AND enabled = 1', ownerId),
    bufferingSignals: count("SELECT COUNT(*) AS n FROM proactive_coalesced_signals WHERE owner_id = ? AND status = 'buffering'", ownerId),
    droppedSignalsTotal: count("SELECT COALESCE(SUM(event_count), 0) AS n FROM proactive_coalesced_signals WHERE owner_id = ? AND status = 'dropped'", ownerId),
    inboxPendingCount: count("SELECT COUNT(*) AS n FROM proactive_items WHERE owner_id = ? AND tier IN ('tier_a_inbox', 'tier_s_chat') AND state IN ('ready', 'delivered') AND valid_until > ?", ownerId, now),
    chatEscalatedCount: count("SELECT COUNT(*) AS n FROM proactive_items WHERE owner_id = ? AND tier = 'tier_s_chat'", ownerId),
    digestBufferedCount: count("SELECT COUNT(*) AS n FROM proactive_items WHERE owner_id = ? AND tier = 'tier_b_digest' AND state = 'buffered_digest' AND valid_until > ?", ownerId, now),
    actedCount: count("SELECT COUNT(*) AS n FROM proactive_items WHERE owner_id = ? AND state = 'acted'", ownerId),
    mutedCount: count("SELECT COUNT(*) AS n FROM proactive_items WHERE owner_id = ? AND state = 'muted'", ownerId),
  };
}
