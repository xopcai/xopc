import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import {
  activationInputSchema, canTransitionActivation, sceneContentHash, sceneNotesSchema, sceneTemplateSchema,
  type ActivationStatus, type SceneActivation, type ScenePrincipal, type SceneTemplate,
} from './contracts.js';
import { nextSceneScheduleAt, sceneScheduleSchema } from './schedule.js';

type Row = Record<string, string | number | null>;
const checksAllowed = `NOT EXISTS (SELECT 1 FROM scene_preferences policy
  WHERE policy.owner_id = a.owner_id AND policy.workspace_id = a.workspace_id
  AND (json_extract(policy.preferences_json, '$.checksPaused') = 1
    OR julianday(json_extract(policy.preferences_json, '$.checksPausedUntil')) > julianday(?, 'unixepoch')))`;

export interface SceneEventInput {
  source: string;
  sourceEventId: string;
  eventType: string;
  subjectId: string;
  occurredAt: number;
  accountId?: string;
}

export interface SceneRunClaim {
  id: string;
  intentId: string;
  activationId: string;
  activationRevision: number;
  leaseOwner: string;
  leaseEpoch: number;
  attempt: number;
}

export interface SceneWorkItem {
  id: string;
  activationId: string;
  subjectId: string;
  accountId: string;
  dueAt: number;
  revision: number;
  status: 'watching' | 'paused' | 'completed';
}

export class SceneConflictError extends Error {}
export class SceneNotFoundError extends Error {}
export class SceneInputError extends Error {}

/** The caller supplies the database; storage is initialized by the normal database upgrade. */
export class SceneRepository {
  constructor(private readonly db: DatabaseSync) {}

  get database(): DatabaseSync { return this.db; }

  private transaction<T>(operation: () => T): T {
    const savepoint = `scene_${randomUUID().replaceAll('-', '')}`;
    this.db.exec(`SAVEPOINT ${savepoint}`);
    try {
      const result = operation();
      this.db.exec(`RELEASE ${savepoint}`);
      return result;
    } catch (error) {
      this.db.exec(`ROLLBACK TO ${savepoint}`);
      this.db.exec(`RELEASE ${savepoint}`);
      throw error;
    }
  }

  installTemplate(value: unknown): SceneTemplate {
    const template = sceneTemplateSchema.parse(value);
    const hash = sceneContentHash(template);
    return this.transaction(() => {
      const previous = this.db.prepare('SELECT content_hash FROM scene_template_versions WHERE template_key = ? AND version = ?')
        .get(template.key, template.version) as Row | undefined;
      if (previous && previous.content_hash !== hash) throw new SceneConflictError('Template versions are immutable');
      this.db.prepare('INSERT OR IGNORE INTO scene_template_versions VALUES (?, ?, ?, ?)')
        .run(template.key, template.version, hash, JSON.stringify(template));
      return template;
    });
  }

  getTemplate(key: string, version: string): SceneTemplate {
    const row = this.db.prepare('SELECT manifest_json FROM scene_template_versions WHERE template_key = ? AND version = ?').get(key, version) as Row | undefined;
    if (!row) throw new SceneNotFoundError('Scene template not found');
    return sceneTemplateSchema.parse(JSON.parse(String(row.manifest_json)));
  }

  listTemplates(): SceneTemplate[] {
    return (this.db.prepare('SELECT manifest_json FROM scene_template_versions ORDER BY template_key, version').all() as Row[])
      .map((row) => sceneTemplateSchema.parse(JSON.parse(String(row.manifest_json))));
  }

  listRuns(principal: ScenePrincipal, activationId: string, limit = 50, afterId = '') {
    this.getActivation(principal, activationId);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Invalid scene list limit');
    const cursor = afterId ? this.db.prepare('SELECT created_at FROM scene_runs WHERE id = ? AND activation_id = ?').get(afterId, activationId) : undefined;
    if (afterId && !cursor) throw new SceneNotFoundError('Scene run cursor not found');
    return this.db.prepare(`SELECT id, activation_id AS activationId, status, attempt, reason, created_at AS createdAt, retry_at AS retryAt
      FROM scene_runs WHERE activation_id = ? AND (? IS NULL OR created_at < ? OR (created_at = ? AND id < ?))
      ORDER BY created_at DESC, id DESC LIMIT ?`).all(activationId, cursor?.created_at ?? null,
      cursor?.created_at ?? null, cursor?.created_at ?? null, afterId, limit);
  }

  createActivation(principal: ScenePrincipal, value: unknown, requestId?: string): SceneActivation {
    this.assertPrincipal(principal);
    const input = activationInputSchema.parse(value);
    if (requestId !== undefined && (!requestId.trim() || requestId.length > 200)) throw new Error('Invalid scene request identity');
    return this.transaction(() => {
      const hash = sceneContentHash(input);
      if (requestId !== undefined) {
        const previous = this.db.prepare('SELECT * FROM scene_activation_requests WHERE owner_id = ? AND workspace_id = ? AND request_id = ?')
          .get(principal.ownerId, principal.workspaceId, requestId) as Row | undefined;
        if (previous) {
          if (previous.content_hash !== hash) throw new SceneConflictError('Scene request identity was reused');
          return this.getActivation(principal, String(previous.activation_id));
        }
      }
      this.getTemplate(input.templateKey, input.templateVersion);
      const activation: SceneActivation = { ...input, ...principal, id: randomUUID(), status: 'needs_setup', revision: 1 };
      this.db.prepare(`INSERT INTO scene_activations VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(activation.id, principal.ownerId, principal.workspaceId, input.templateKey, input.templateVersion, input.goal,
          JSON.stringify(input.scope), JSON.stringify(input.permissions), activation.status, activation.revision);
      if (requestId !== undefined) this.db.prepare('INSERT INTO scene_activation_requests VALUES (?, ?, ?, ?, ?)')
        .run(principal.ownerId, principal.workspaceId, requestId, hash, activation.id);
      return activation;
    });
  }

  listActivations(principal: ScenePrincipal, limit = 50, afterId = ''): SceneActivation[] {
    this.assertPrincipal(principal);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Invalid scene list limit');
    const rows = this.db.prepare('SELECT id FROM scene_activations WHERE owner_id = ? AND workspace_id = ? AND id > ? ORDER BY id LIMIT ?')
      .all(principal.ownerId, principal.workspaceId, afterId, limit) as Row[];
    return rows.map((row) => this.getActivation(principal, String(row.id)));
  }

  getActivation(principal: ScenePrincipal, id: string): SceneActivation {
    this.assertPrincipal(principal);
    const row = this.db.prepare('SELECT * FROM scene_activations WHERE id = ? AND owner_id = ? AND workspace_id = ?')
      .get(id, principal.ownerId, principal.workspaceId) as Row | undefined;
    if (!row) throw new SceneNotFoundError('Scene activation not found');
    const providers = this.getTemplate(String(row.template_key), String(row.template_version)).contextProviders;
    const setupMissing: string[] = [];
    if (providers.includes('user_notes')) {
      const notes = this.db.prepare('SELECT content, valid_until FROM scene_notes WHERE activation_id = ?').get(id);
      if (!notes || !String(notes.content).trim() || (notes.valid_until !== null && Number(notes.valid_until) <= Date.now())) setupMissing.push('notes');
      if (!this.db.prepare('SELECT 1 FROM scene_schedule_cursors WHERE activation_id = ?').get(id)) setupMissing.push('schedule');
    }
    if (providers.includes('mail') && !this.db.prepare("SELECT 1 FROM scene_work_items WHERE activation_id = ? AND status = 'watching'").get(id)) setupMissing.push('deadline');
    return {
      setupMissing,
      id: String(row.id), ...principal,
      templateKey: String(row.template_key), templateVersion: String(row.template_version), goal: String(row.goal),
      scope: JSON.parse(String(row.scope_json)), permissions: JSON.parse(String(row.permissions_json)),
      status: row.status as ActivationStatus, revision: Number(row.revision),
    };
  }

  recordSourceHealth(activation: SceneActivation, reason: string | null, now: number, retryAt: number | null = null) {
    const current = this.db.prepare("SELECT 1 FROM scene_activations WHERE id = ? AND revision = ? AND status = 'active'").get(activation.id, activation.revision);
    if (!current) return;
    this.db.prepare(`INSERT INTO scene_source_health VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(activation_id) DO UPDATE SET last_attempt_at = excluded.last_attempt_at,
      last_success_at = COALESCE(excluded.last_success_at, scene_source_health.last_success_at),
      reason = excluded.reason, consecutive_failures = CASE WHEN excluded.reason IS NULL THEN 0 ELSE scene_source_health.consecutive_failures + 1 END,
      retry_at = excluded.retry_at`).run(activation.id, now, reason === null ? now : null, reason, reason === null ? 0 : 1, retryAt);
  }

  getSourceHealth(activationId: string) {
    return this.db.prepare(`SELECT last_attempt_at AS lastAttemptAt, last_success_at AS lastSuccessAt,
      reason, consecutive_failures AS consecutiveFailures, retry_at AS retryAt FROM scene_source_health WHERE activation_id = ?`).get(activationId) ?? null;
  }

  reuseUnchangedResult(claim: SceneRunClaim, hash: string, now: number, inspectOnly = false): boolean {
    return this.transaction(() => {
      if (!this.isCurrentClaim(claim, now)) return false;
      const previous = this.db.prepare(`SELECT p.id FROM scene_presentations p
        JOIN scene_outcomes o ON o.id = p.outcome_id JOIN scene_runs r ON r.id = o.run_id
        JOIN scene_context_snapshots s ON s.run_id = r.id AND s.lease_epoch = r.lease_epoch
        JOIN scene_trigger_intents i ON i.id = r.intent_id JOIN scene_events e ON e.id = i.event_id
        JOIN scene_trigger_intents ci ON ci.id = ? JOIN scene_events ce ON ce.id = ci.event_id
        WHERE r.activation_id = ? AND r.activation_revision = ? AND s.content_hash = ?
        AND ce.event_type IN ('manual.check', 'scene.manual.check') AND e.subject_id = ce.subject_id AND e.account_id IS ce.account_id
        AND p.status <> 'withdrawn' AND p.withdrawn_at IS NULL AND (p.expires_at IS NULL OR p.expires_at > ?)
        LIMIT 1`).get(claim.intentId, claim.activationId, claim.activationRevision, hash, now);
      if (!previous) return false;
      if (inspectOnly) return true;
      this.db.prepare("UPDATE scene_runs SET status = 'skipped', reason = 'unchanged_result', lease_owner = NULL, lease_until = NULL WHERE id = ?").run(claim.id);
      this.db.prepare("UPDATE scene_trigger_intents SET status = 'resolved' WHERE id = ?").run(claim.intentId);
      return true;
    });
  }

  /** Configuration edits require a fresh preflight before any execution resumes. */
  configureActivation(principal: ScenePrincipal, id: string, revision: number, value: unknown): SceneActivation {
    return this.transaction(() => {
      const activation = this.getActivation(principal, id);
      if (activation.revision !== revision || !['active', 'paused', 'needs_setup'].includes(activation.status)) {
        throw new SceneConflictError('Scene activation changed or cannot be configured');
      }
      const input = activationInputSchema.pick({ goal: true, scope: true, permissions: true }).parse(value);
      this.db.prepare(`UPDATE scene_activations SET goal = ?, scope_json = ?, permissions_json = ?,
        status = 'needs_setup', revision = revision + 1 WHERE id = ?`)
        .run(input.goal, JSON.stringify(input.scope), JSON.stringify(input.permissions), id);
      this.db.prepare("UPDATE scene_trigger_intents SET status = 'cancelled' WHERE activation_id = ? AND status IN ('pending', 'claimed')").run(id);
      this.db.prepare("UPDATE scene_runs SET status = 'cancelled', reason = 'activation_changed', lease_owner = NULL, lease_until = NULL WHERE activation_id = ? AND status IN ('running', 'retry_wait')").run(id);
      this.db.prepare(`UPDATE scene_work_items SET status = 'paused', revision = revision + 1, last_check_reason = 'activation_changed'
        WHERE activation_id = ? AND status <> 'completed'`).run(id);
      this.db.prepare(`UPDATE scene_presentations SET status = 'withdrawn' WHERE outcome_id IN
        (SELECT o.id FROM scene_outcomes o JOIN scene_runs r ON r.id = o.run_id WHERE r.activation_id = ?)`)
        .run(id);
      return this.getActivation(principal, id);
    });
  }

  writeNotes(principal: ScenePrincipal, id: string, value: unknown, now: number): number {
    const input = sceneNotesSchema.parse(value);
    if (!Number.isSafeInteger(now) || now < 0 || (input.validUntil !== null && input.validUntil <= now)) throw new SceneInputError('Invalid notes validity time');
    return this.transaction(() => {
      const activation = this.getActivation(principal, id);
      if (activation.scope.kind !== 'personal' || !['active', 'paused', 'needs_setup'].includes(activation.status)
        || !this.getTemplate(activation.templateKey, activation.templateVersion).contextProviders.includes('user_notes')) throw new SceneConflictError('Scene does not accept personal notes');
      const row = this.db.prepare('SELECT revision FROM scene_notes WHERE activation_id = ?').get(id) as Row | undefined;
      if (Number(row?.revision ?? 0) !== input.expectedRevision) throw new SceneConflictError('Scene notes changed');
      const revision = input.expectedRevision + 1;
      this.db.prepare(`INSERT INTO scene_notes VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(activation_id) DO UPDATE SET content = excluded.content, revision = excluded.revision,
          valid_until = excluded.valid_until, updated_at = excluded.updated_at`)
        .run(id, input.content, revision, input.validUntil, now);
      this.db.prepare(`UPDATE scene_trigger_intents SET status = 'cancelled' WHERE id IN
        (SELECT intent_id FROM scene_runs WHERE activation_id = ? AND status IN ('running', 'retry_wait'))`).run(id);
      this.db.prepare(`UPDATE scene_runs SET status = 'cancelled', reason = 'source_changed', lease_owner = NULL, lease_until = NULL
        WHERE activation_id = ? AND status IN ('running', 'retry_wait')`).run(id);
      this.db.prepare(`UPDATE scene_presentations SET status = 'withdrawn' WHERE outcome_id IN
        (SELECT o.id FROM scene_outcomes o JOIN scene_runs r ON r.id = o.run_id WHERE r.activation_id = ?)`)
        .run(id);
      return revision;
    });
  }

  readNotes(principal: ScenePrincipal, id: string) {
    this.getActivation(principal, id);
    const row = this.db.prepare('SELECT content, revision, valid_until AS validUntil FROM scene_notes WHERE activation_id = ?').get(id);
    return row ?? { content: '', revision: 0, validUntil: null };
  }

  listWorkItems(principal: ScenePrincipal, activationId: string, limit = 50, afterId = '') {
    this.getActivation(principal, activationId);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Invalid scene list limit');
    return this.db.prepare(`SELECT id, subject_id AS subjectId, account_id AS accountId, due_at AS dueAt, status, revision,
      last_check_reason AS lastCheckReason FROM scene_work_items WHERE activation_id = ? AND id > ? ORDER BY id LIMIT ?`)
      .all(activationId, afterId, limit);
  }

  listSchedules(principal: ScenePrincipal, activationId: string) {
    this.getActivation(principal, activationId);
    return (this.db.prepare('SELECT * FROM scene_schedule_cursors WHERE activation_id = ? ORDER BY trigger_key').all(activationId) as Row[])
      .map((row) => ({ triggerKey: String(row.trigger_key), schedule: sceneScheduleSchema.parse(JSON.parse(String(row.schedule_json))),
        revision: Number(row.revision), nextDueAt: Number(row.next_due_at) }));
  }

  createWorkItem(principal: ScenePrincipal, activationId: string, input: { subjectId: string; accountId: string; dueAt: number }, now: number): SceneWorkItem {
    return this.transaction(() => {
      const activation = this.getActivation(principal, activationId);
      if (activation.status !== 'active') throw new SceneConflictError('Scene activation is not active');
      if (!input.subjectId.trim() || !activation.permissions.accountIds.includes(input.accountId)) throw new SceneInputError('Work item account is not authorized');
      if (activation.scope.kind !== 'objects' || !activation.scope.ids.includes(input.subjectId)) throw new SceneInputError('Mail follow-up requires an explicit object scope');
      if (!this.getTemplate(activation.templateKey, activation.templateVersion).triggers.some((item) => item.type === 'schedule')) throw new SceneInputError('Work item template needs a schedule trigger');
      if (!Number.isSafeInteger(input.dueAt) || input.dueAt <= now) throw new SceneInputError('Work item deadline must be in the future');
      if (this.db.prepare('SELECT 1 FROM scene_work_items WHERE activation_id = ? AND account_id = ? AND subject_id = ?')
        .get(activationId, input.accountId, input.subjectId)) throw new SceneConflictError('Scene work item already exists');
      const id = randomUUID();
      this.db.prepare(`INSERT INTO scene_work_items (id, activation_id, subject_id, account_id, due_at, revision, status)
        VALUES (?, ?, ?, ?, ?, 1, 'watching')`)
        .run(id, activationId, input.subjectId, input.accountId, input.dueAt);
      return { id, activationId, ...input, revision: 1, status: 'watching' };
    });
  }

  listMailObservationItems(afterId = '', now = Date.now()): Array<{ principal: ScenePrincipal; item: SceneWorkItem }> {
    const rows = this.db.prepare(`SELECT w.*, a.owner_id, a.workspace_id FROM scene_work_items w
      JOIN scene_activations a ON a.id = w.activation_id
      WHERE a.status = 'active' AND w.status = 'watching' AND w.id > ? AND ${checksAllowed}
      ORDER BY w.id LIMIT 100`).all(afterId, now / 1000) as Row[];
    return rows.map((row) => ({ principal: { ownerId: String(row.owner_id), workspaceId: String(row.workspace_id) },
      item: { id: String(row.id), activationId: String(row.activation_id), subjectId: String(row.subject_id),
        accountId: String(row.account_id), dueAt: Number(row.due_at), revision: Number(row.revision), status: 'watching' } }));
  }

  isMailObservationCurrent(activation: SceneActivation, item: SceneWorkItem, now = Date.now()): boolean {
    return Boolean(this.db.prepare(`SELECT 1 FROM scene_work_items w JOIN scene_activations a ON a.id = w.activation_id
      WHERE w.id = ? AND w.activation_id = ? AND w.revision = ? AND w.status = 'watching'
      AND a.owner_id = ? AND a.workspace_id = ? AND a.revision = ? AND a.status = 'active' AND ${checksAllowed}`)
      .get(item.id, activation.id, item.revision, activation.ownerId, activation.workspaceId, activation.revision, now / 1000));
  }

  observeMailWorkItem(principal: ScenePrincipal, item: SceneWorkItem, fingerprint: string, now: number): boolean {
    if (!/^[a-f0-9]{64}$/.test(fingerprint)) throw new Error('Invalid scene observation fingerprint');
    return this.transaction(() => {
      const activation = this.getActivation(principal, item.activationId);
      if (!this.isMailObservationCurrent(activation, item, now)) return false;
      const row = this.db.prepare('SELECT * FROM scene_work_items WHERE id = ? AND activation_id = ?').get(item.id, item.activationId) as Row | undefined;
      if (!row || row.revision !== item.revision || row.status !== 'watching' || activation.status !== 'active') return false;
      if (row.subject_id !== item.subjectId || row.account_id !== item.accountId) throw new SceneConflictError('Work item identity changed');
      if (row.observed_fingerprint === fingerprint) return false;
      const trigger = this.getTemplate(activation.templateKey, activation.templateVersion).triggers.find((entry) => entry.type === 'event' && entry.eventType === 'mail.thread.changed');
      if (!trigger) return false;
      const sequence = Number(row.observation_sequence) + 1;
      this.db.prepare('UPDATE scene_work_items SET observed_fingerprint = ?, observation_sequence = ? WHERE id = ?').run(fingerprint, sequence, item.id);
      if (row.observed_fingerprint === null) return false;
      const occurrenceKey = `mail:${item.id}:${item.revision}:${sequence}`;
      this.acceptTrigger(principal, item.activationId, {
        triggerKey: trigger.id, occurrenceKey, dueAt: now,
        event: { source: `mail:${item.accountId}`, sourceEventId: occurrenceKey, subjectId: item.subjectId,
          accountId: item.accountId, eventType: 'mail.thread.changed', occurredAt: now },
      }, now);
      this.db.prepare(`UPDATE scene_presentations SET status = 'withdrawn' WHERE outcome_id IN (
        SELECT o.id FROM scene_outcomes o JOIN scene_runs r ON r.id = o.run_id
        JOIN scene_trigger_intents i ON i.id = r.intent_id JOIN scene_events e ON e.id = i.event_id
        WHERE i.activation_id = ? AND e.subject_id = ? AND (e.account_id = ? OR e.account_id IS NULL))`)
        .run(item.activationId, item.subjectId, item.accountId);
      return true;
    });
  }

  /** Revision changes invalidate only this item's pending work and visible results. */
  updateWorkItem(principal: ScenePrincipal, id: string, input: { expectedRevision: number; status?: SceneWorkItem['status']; dueAt?: number }, now: number): SceneWorkItem {
    return this.transaction(() => {
      this.assertPrincipal(principal);
      const row = this.db.prepare(`SELECT w.* FROM scene_work_items w JOIN scene_activations a ON a.id = w.activation_id
        WHERE w.id = ? AND a.owner_id = ? AND a.workspace_id = ?`).get(id, principal.ownerId, principal.workspaceId) as Row | undefined;
      if (!row) throw new SceneNotFoundError('Scene work item not found');
      if (row.revision !== input.expectedRevision || row.status === 'completed') throw new SceneConflictError('Work item changed or completed');
      const status = input.status ?? row.status;
      if (!['watching', 'paused', 'completed'].includes(String(status))) throw new Error('Invalid work item status');
      if (status === 'watching') {
        const activation = this.getActivation(principal, String(row.activation_id));
        if (activation.status !== 'active' || activation.scope.kind !== 'objects' || !activation.scope.ids.includes(String(row.subject_id))
          || !activation.permissions.accountIds.includes(String(row.account_id))) throw new SceneConflictError('Work item is outside the active scene scope');
      }
      if (input.dueAt !== undefined && (!Number.isSafeInteger(input.dueAt) || input.dueAt <= now)) throw new SceneInputError('Work item deadline must be in the future');
      if (input.status === undefined && input.dueAt === undefined) throw new SceneInputError('Work item update is empty');
      this.db.prepare('UPDATE scene_work_items SET due_at = ?, status = ?, revision = revision + 1, last_check_reason = NULL WHERE id = ?')
        .run(input.dueAt ?? row.due_at, status, id);
      const matchingIntents = `SELECT i.id FROM scene_trigger_intents i JOIN scene_events e ON e.id = i.event_id
        WHERE i.activation_id = ? AND e.subject_id = ? AND (e.account_id = ? OR e.account_id IS NULL)`;
      this.db.prepare(`UPDATE scene_runs SET status = 'cancelled', reason = 'work_item_changed', lease_owner = NULL, lease_until = NULL
        WHERE intent_id IN (${matchingIntents}) AND status IN ('running', 'retry_wait')`).run(row.activation_id, row.subject_id, row.account_id);
      this.db.prepare(`UPDATE scene_trigger_intents SET status = 'cancelled' WHERE id IN (${matchingIntents}) AND status IN ('pending', 'claimed')`)
        .run(row.activation_id, row.subject_id, row.account_id);
      this.db.prepare(`UPDATE scene_presentations SET status = 'withdrawn' WHERE outcome_id IN (
        SELECT o.id FROM scene_outcomes o JOIN scene_runs r ON r.id = o.run_id WHERE r.intent_id IN (${matchingIntents}))`)
        .run(row.activation_id, row.subject_id, row.account_id);
      return { id, activationId: String(row.activation_id), accountId: String(row.account_id), subjectId: String(row.subject_id),
        dueAt: input.dueAt ?? Number(row.due_at), revision: Number(row.revision) + 1, status: status as SceneWorkItem['status'] };
    });
  }

  /** Due dates are durable; restarting cannot generate a second occurrence. */
  enqueueDueWorkItems(now: number): number {
    return this.transaction(() => {
      const rows = this.db.prepare(`SELECT w.*, a.owner_id, a.workspace_id FROM scene_work_items w
        JOIN scene_activations a ON a.id = w.activation_id WHERE w.status = 'watching' AND a.status = 'active'
        AND w.due_at <= ? AND (w.last_triggered_revision IS NULL OR w.last_triggered_revision <> w.revision) AND ${checksAllowed}
        ORDER BY w.due_at, w.id LIMIT 100`).all(now, now / 1000) as Row[];
      let accepted = 0;
      for (const row of rows) {
        const activationId = String(row.activation_id);
        const principal = { ownerId: String(row.owner_id), workspaceId: String(row.workspace_id) };
        const activation = this.getActivation(principal, activationId);
        if (now - Number(row.due_at) > 86_400_000) {
          this.db.prepare("UPDATE scene_work_items SET status = 'paused', last_check_reason = 'deadline_expired' WHERE id = ?").run(row.id);
          continue;
        }
        const trigger = this.getTemplate(activation.templateKey, activation.templateVersion).triggers.find((item) => item.type === 'schedule');
        if (!trigger) throw new Error('Work item template needs a schedule trigger');
        const occurrenceKey = `work-item:${row.id}:${row.revision}`;
        this.acceptTrigger(principal, activationId, {
          triggerKey: trigger.id, occurrenceKey, dueAt: Number(row.due_at),
          event: { source: 'schedule', sourceEventId: occurrenceKey, eventType: 'scene.work_item.due', subjectId: String(row.subject_id), accountId: String(row.account_id), occurredAt: Number(row.due_at) },
        }, now);
        this.db.prepare("UPDATE scene_work_items SET last_triggered_revision = revision, last_check_reason = 'due' WHERE id = ?").run(row.id);
        accepted += 1;
      }
      return accepted;
    });
  }

  transitionActivation(principal: ScenePrincipal, id: string, revision: number, status: ActivationStatus, now = Date.now()): SceneActivation {
    return this.transaction(() => {
      const activation = this.getActivation(principal, id);
      if (activation.revision !== revision || !canTransitionActivation(activation.status, status)) {
        throw new SceneConflictError('Scene activation changed or transition is invalid');
      }
      this.db.prepare('UPDATE scene_activations SET status = ?, revision = revision + 1 WHERE id = ?').run(status, id);
      this.db.prepare("UPDATE scene_trigger_intents SET status = 'cancelled' WHERE activation_id = ? AND status IN ('pending', 'claimed')").run(id);
      this.db.prepare("UPDATE scene_runs SET status = 'cancelled', reason = 'activation_changed', lease_owner = NULL, lease_until = NULL WHERE activation_id = ? AND status IN ('running', 'retry_wait')").run(id);
      if (status === 'active') {
        this.db.prepare("UPDATE scene_work_items SET revision = revision + 1, last_check_reason = NULL WHERE activation_id = ? AND status = 'watching'").run(id);
        const schedules = this.db.prepare('SELECT trigger_key, schedule_json FROM scene_schedule_cursors WHERE activation_id = ?').all(id) as Row[];
        for (const schedule of schedules) this.db.prepare('UPDATE scene_schedule_cursors SET next_due_at = ?, revision = revision + 1 WHERE activation_id = ? AND trigger_key = ?')
          .run(nextSceneScheduleAt(JSON.parse(String(schedule.schedule_json)), now), id, schedule.trigger_key);
      }
      if (status === 'needs_setup' || status === 'archived') {
        this.db.prepare(`UPDATE scene_presentations SET status = 'withdrawn' WHERE outcome_id IN
          (SELECT o.id FROM scene_outcomes o JOIN scene_runs r ON r.id = o.run_id WHERE r.activation_id = ?)`)
          .run(id);
      }
      return this.getActivation(principal, id);
    });
  }

  setSchedule(principal: ScenePrincipal, activationId: string, triggerKey: string, expectedRevision: number, value: unknown, now: number): number {
    const schedule = sceneScheduleSchema.parse(value);
    const nextDueAt = nextSceneScheduleAt(schedule, now);
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new Error('Invalid schedule revision');
    return this.transaction(() => {
      const activation = this.getActivation(principal, activationId);
      if (activation.status !== 'active') throw new SceneConflictError('Scene activation is not active');
      if (!this.getTemplate(activation.templateKey, activation.templateVersion).triggers.some((trigger) => trigger.id === triggerKey && trigger.type === 'schedule')) throw new SceneInputError('Unknown schedule trigger');
      const previous = this.db.prepare('SELECT revision FROM scene_schedule_cursors WHERE activation_id = ? AND trigger_key = ?').get(activationId, triggerKey) as Row | undefined;
      if (Number(previous?.revision ?? 0) !== expectedRevision) throw new SceneConflictError('Scene schedule changed');
      const revision = expectedRevision + 1;
      this.db.prepare(`INSERT INTO scene_schedule_cursors VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(activation_id, trigger_key) DO UPDATE SET schedule_json = excluded.schedule_json,
          revision = excluded.revision, next_due_at = excluded.next_due_at`)
        .run(activationId, triggerKey, JSON.stringify(schedule), revision, nextDueAt);
      this.db.prepare(`UPDATE scene_runs SET status = 'cancelled', reason = 'schedule_changed', lease_owner = NULL, lease_until = NULL
        WHERE status IN ('running', 'retry_wait') AND intent_id IN
          (SELECT id FROM scene_trigger_intents WHERE activation_id = ? AND trigger_key = ?)`)
        .run(activationId, triggerKey);
      this.db.prepare("UPDATE scene_trigger_intents SET status = 'cancelled' WHERE activation_id = ? AND trigger_key = ? AND status IN ('pending', 'claimed')")
        .run(activationId, triggerKey);
      return revision;
    });
  }

  /** Coalesces missed occurrences into at most one bounded catch-up per schedule. */
  enqueueDueSchedules(now: number): number {
    if (!Number.isSafeInteger(now) || now < 0) throw new Error('Invalid scene schedule time');
    return this.transaction(() => {
      const rows = this.db.prepare(`SELECT s.*, a.owner_id, a.workspace_id FROM scene_schedule_cursors s
        JOIN scene_activations a ON a.id = s.activation_id WHERE a.status = 'active' AND s.next_due_at <= ? AND ${checksAllowed}
        ORDER BY s.next_due_at, s.activation_id, s.trigger_key LIMIT 100`).all(now, now / 1000) as Row[];
      let published = 0;
      for (const row of rows) {
        const principal = { ownerId: String(row.owner_id), workspaceId: String(row.workspace_id) };
        const activation = this.getActivation(principal, String(row.activation_id));
        if (now - Number(row.next_due_at) <= 86_400_000) {
          const occurrenceKey = sceneContentHash({ activationId: activation.id, activationRevision: activation.revision,
            triggerKey: row.trigger_key, scheduleRevision: row.revision, dueAt: row.next_due_at });
          this.acceptTrigger(principal, activation.id, { triggerKey: String(row.trigger_key), occurrenceKey, dueAt: now,
            event: { source: 'scene_schedule', sourceEventId: occurrenceKey, eventType: 'scene.schedule.due',
              subjectId: activation.scope.kind === 'objects' ? activation.scope.ids[0] : activation.id,
              occurredAt: Number(row.next_due_at), ...(activation.permissions.accountIds.length === 1 ? { accountId: activation.permissions.accountIds[0] } : {}) },
          }, now);
          published += 1;
        }
        this.db.prepare('UPDATE scene_schedule_cursors SET next_due_at = ? WHERE activation_id = ? AND trigger_key = ?')
          .run(nextSceneScheduleAt(JSON.parse(String(row.schedule_json)), now), activation.id, row.trigger_key);
      }
      return published;
    });
  }

  /** Called by an authorized producer inside its domain transaction when applicable. */
  acceptTrigger(principal: ScenePrincipal, activationId: string, input: {
    event: SceneEventInput; triggerKey: string; occurrenceKey: string; dueAt: number;
  }, now: number): string {
    return this.transaction(() => {
      const activation = this.getActivation(principal, activationId);
      if (activation.status !== 'active') throw new SceneConflictError('Scene activation is not active');
      const trigger = this.getTemplate(activation.templateKey, activation.templateVersion).triggers.find((item) => item.id === input.triggerKey);
      if (!trigger || (trigger.type === 'event' && trigger.eventType !== input.event.eventType)) throw new SceneConflictError('Scene trigger does not match');
      if (!input.occurrenceKey || !input.event.source || !input.event.sourceEventId || !input.event.subjectId || !input.event.eventType) throw new Error('Missing scene event identity');
      if (input.event.accountId !== undefined && !activation.permissions.accountIds.includes(input.event.accountId)) throw new Error('Scene event account is not authorized');
      for (const time of [now, input.dueAt, input.event.occurredAt]) if (!Number.isSafeInteger(time) || time < 0) throw new Error('Invalid scene event time');
      this.db.prepare(`INSERT OR IGNORE INTO scene_events VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(randomUUID(), principal.ownerId, principal.workspaceId, input.event.source, input.event.sourceEventId,
          input.event.eventType, input.event.subjectId, input.event.occurredAt, now, input.event.accountId ?? null);
      const event = this.db.prepare('SELECT * FROM scene_events WHERE owner_id = ? AND workspace_id = ? AND source = ? AND source_event_id = ?')
        .get(principal.ownerId, principal.workspaceId, input.event.source, input.event.sourceEventId) as Row;
      if (event.event_type !== input.event.eventType || event.subject_id !== input.event.subjectId || event.account_id !== (input.event.accountId ?? null) || Number(event.occurred_at) !== input.event.occurredAt) {
        throw new SceneConflictError('Event identity was reused with different content');
      }
      const previous = this.db.prepare('SELECT * FROM scene_trigger_intents WHERE activation_id = ? AND trigger_key = ? AND occurrence_key = ?')
        .get(activationId, input.triggerKey, input.occurrenceKey) as Row | undefined;
      if (previous) {
        if (previous.event_id !== event.id) throw new SceneConflictError('Occurrence identity was reused');
        return String(previous.id);
      }
      const id = randomUUID();
      this.db.prepare(`INSERT INTO scene_trigger_intents VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`)
        .run(id, activationId, activation.revision, input.triggerKey, input.occurrenceKey, event.id, input.dueAt);
      this.db.prepare('INSERT INTO scene_intent_events VALUES (?, ?, ?)').run(id, event.id, now);
      return id;
    });
  }

  acceptManualCheck(principal: ScenePrincipal, activationId: string, triggerKey: string, requestId: string, now: number): string {
    return this.transaction(() => {
      const activation = this.getActivation(principal, activationId);
      if (activation.status !== 'active') throw new SceneConflictError('Scene activation is not active');
      const occurrenceKey = sceneContentHash({ activationId, revision: activation.revision, requestId });
      const previous = this.db.prepare('SELECT id FROM scene_trigger_intents WHERE activation_id = ? AND trigger_key = ? AND occurrence_key = ?')
        .get(activationId, triggerKey, occurrenceKey) as Row | undefined;
      if (previous) return String(previous.id);
      return this.acceptTrigger(principal, activationId, { triggerKey, occurrenceKey, dueAt: now,
        event: { source: 'manual', sourceEventId: occurrenceKey, eventType: 'scene.manual.check',
          subjectId: activation.scope.kind === 'objects' ? activation.scope.ids[0] : activation.id, occurredAt: now,
          ...(activation.permissions.accountIds.length === 1 ? { accountId: activation.permissions.accountIds[0] } : {}) },
      }, now);
    });
  }

  claimNext(worker: string, now: number, leaseMs = 120_000): SceneRunClaim | null {
    if (!worker.trim() || !Number.isSafeInteger(now) || now < 0 || !Number.isSafeInteger(leaseMs) || leaseMs < 1) throw new Error('Invalid scene lease');
    return this.transaction(() => {
      this.db.prepare(`UPDATE scene_runs SET status = 'failed', reason = 'attempt_limit', lease_owner = NULL, lease_until = NULL
        WHERE status = 'running' AND lease_until <= ? AND attempt >= 3`).run(now);
      this.db.prepare(`UPDATE scene_trigger_intents SET status = 'resolved' WHERE status = 'claimed'
        AND id IN (SELECT intent_id FROM scene_runs WHERE status = 'failed')`).run();
      const retry = this.db.prepare(`SELECT r.* FROM scene_runs r JOIN scene_activations a ON a.id = r.activation_id
        JOIN scene_template_versions t ON t.template_key = a.template_key AND t.version = a.template_version
        WHERE a.status = 'active' AND a.revision = r.activation_revision AND ${checksAllowed}
        AND json_extract(t.manifest_json, '$.execution.kind') = 'agent'
        AND (r.attempt < 3 OR (r.status = 'retry_wait' AND r.reason IN ('source_not_ready', 'daily_budget')))
        AND ((r.status = 'running' AND r.lease_until <= ?) OR (r.status = 'retry_wait' AND r.retry_at <= ?))
        ORDER BY r.created_at, r.id LIMIT 1`).get(now / 1000, now, now) as Row | undefined;
      if (retry) {
        this.db.prepare(`UPDATE scene_runs SET status = 'running', attempt = attempt + CASE WHEN status = 'retry_wait' AND reason IN ('source_not_ready', 'daily_budget') THEN 0 ELSE 1 END, lease_epoch = lease_epoch + 1,
          lease_owner = ?, lease_until = ?, retry_at = NULL WHERE id = ?`).run(worker, now + leaseMs, retry.id);
        return this.readClaim(String(retry.id));
      }
      const intent = this.db.prepare(`SELECT i.* FROM scene_trigger_intents i JOIN scene_activations a ON a.id = i.activation_id
        JOIN scene_template_versions t ON t.template_key = a.template_key AND t.version = a.template_version
        WHERE i.status = 'pending' AND i.due_at <= ? AND a.status = 'active' AND a.revision = i.activation_revision AND ${checksAllowed}
        AND json_extract(t.manifest_json, '$.execution.kind') = 'agent'
        AND NOT EXISTS (SELECT 1 FROM scene_runs r WHERE r.activation_id = a.id AND r.status IN ('running', 'retry_wait'))
        ORDER BY i.due_at, i.id LIMIT 1`).get(now, now / 1000) as Row | undefined;
      if (!intent) return null;
      const id = randomUUID();
      this.db.prepare(`INSERT INTO scene_runs (id, intent_id, activation_id, activation_revision, status, attempt, lease_epoch, lease_owner, lease_until, created_at)
        VALUES (?, ?, ?, ?, 'running', 1, 1, ?, ?, ?)`).run(id, intent.id, intent.activation_id, intent.activation_revision, worker, now + leaseMs, now);
      this.db.prepare("UPDATE scene_trigger_intents SET status = 'claimed' WHERE id = ?").run(intent.id);
      return this.readClaim(id);
    });
  }

  claimIntentForAdapter(principal: ScenePrincipal, activationId: string, intentId: string, adapterId: string, worker: string, now: number, leaseMs: number): SceneRunClaim {
    if (!adapterId.trim() || !worker.trim() || !Number.isSafeInteger(now) || now < 0 || !Number.isSafeInteger(leaseMs) || leaseMs < 1) throw new Error('Invalid scene lease');
    return this.transaction(() => {
      const activation = this.getActivation(principal, activationId);
      const template = this.getTemplate(activation.templateKey, activation.templateVersion);
      if (template.execution.kind !== adapterId) throw new SceneConflictError('Scene execution adapter changed');
      const intent = this.db.prepare(`SELECT * FROM scene_trigger_intents
        WHERE id = ? AND activation_id = ? AND activation_revision = ? AND status = 'pending' AND due_at <= ?`)
        .get(intentId, activationId, activation.revision, now) as Row | undefined;
      if (!intent) throw new SceneConflictError('Scene trigger is no longer available');
      if (this.db.prepare("SELECT 1 FROM scene_runs WHERE activation_id = ? AND status IN ('running', 'retry_wait')").get(activationId)) {
        throw new SceneConflictError('Scene already has an active run');
      }
      const id = randomUUID();
      this.db.prepare(`INSERT INTO scene_runs (id, intent_id, activation_id, activation_revision, status, attempt, lease_epoch, lease_owner, lease_until, created_at)
        VALUES (?, ?, ?, ?, 'running', 1, 1, ?, ?, ?)`).run(id, intentId, activationId, activation.revision, worker, now + leaseMs, now);
      this.db.prepare("UPDATE scene_trigger_intents SET status = 'claimed' WHERE id = ?").run(intentId);
      return this.readClaim(id);
    });
  }

  renewLease(claim: SceneRunClaim, now: number, leaseMs: number): boolean {
    if (!Number.isSafeInteger(leaseMs) || leaseMs < 1) throw new Error('Invalid scene lease');
    return this.db.prepare(`UPDATE scene_runs SET lease_until = ? WHERE id = ? AND status = 'running'
      AND lease_owner = ? AND lease_epoch = ? AND lease_until > ?`)
      .run(now + leaseMs, claim.id, claim.leaseOwner, claim.leaseEpoch, now).changes === 1;
  }

  reserveModelCall(claim: SceneRunClaim, now: number, limits = { activation: 30, owner: 100 }): boolean {
    if (![limits.activation, limits.owner].every((limit) => Number.isInteger(limit) && limit > 0)) throw new Error('Invalid model budget');
    return this.transaction(() => {
      if (!this.isCurrentClaim(claim, now)) return false;
      if (this.db.prepare('SELECT 1 FROM scene_model_reservations WHERE run_id = ? AND lease_epoch = ?').get(claim.id, claim.leaseEpoch)) return false;
      const row = this.db.prepare('SELECT owner_id FROM scene_activations WHERE id = ?').get(claim.activationId) as Row;
      const start = Math.floor(now / 86_400_000) * 86_400_000;
      const count = this.db.prepare(`SELECT count(*) AS owner_count, COALESCE(sum(activation_id = ?), 0) AS activation_count
        FROM scene_model_reservations WHERE owner_id = ? AND reserved_at >= ? AND reserved_at < ?`)
        .get(claim.activationId, row.owner_id, start, start + 86_400_000) as Row;
      if (Number(count.owner_count) >= limits.owner || Number(count.activation_count) >= limits.activation) return false;
      this.db.prepare('INSERT INTO scene_model_reservations VALUES (?, ?, ?, ?, ?)').run(claim.id, claim.leaseEpoch, row.owner_id, claim.activationId, now);
      return true;
    });
  }

  deferRun(claim: SceneRunClaim, now: number, reason: 'source_not_ready' | 'daily_budget', retryAt: number): 'deferred' | 'failed' | 'discarded' {
    if (!Number.isSafeInteger(retryAt) || retryAt <= now) throw new Error('Invalid scene retry time');
    return this.transaction(() => {
      if (!this.isCurrentClaim(claim, now)) return 'discarded';
      const row = this.db.prepare('SELECT created_at FROM scene_runs WHERE id = ?').get(claim.id) as Row;
      if (reason === 'source_not_ready' && now - Number(row.created_at) >= 86_400_000) return this.failRun(claim, now, 'source_wait_expired') ? 'failed' : 'discarded';
      this.db.prepare("UPDATE scene_runs SET status = 'retry_wait', reason = ?, retry_at = ?, lease_owner = NULL, lease_until = NULL WHERE id = ?")
        .run(reason, retryAt, claim.id);
      return 'deferred';
    });
  }

  getRunInput(claim: SceneRunClaim, now: number): { activation: SceneActivation; subjectId: string; accountId?: string; notBefore?: number } | null {
    if (!this.isCurrentClaim(claim, now)) return null;
    const row = this.db.prepare(`SELECT a.owner_id, a.workspace_id, e.subject_id, e.account_id, e.event_type, e.occurred_at FROM scene_activations a
      JOIN scene_trigger_intents i ON i.activation_id = a.id JOIN scene_events e ON e.id = i.event_id
      WHERE i.id = ? AND a.id = ?`).get(claim.intentId, claim.activationId) as Row;
    return {
      activation: this.getActivation({ ownerId: String(row.owner_id), workspaceId: String(row.workspace_id) }, claim.activationId),
      subjectId: String(row.subject_id),
      ...(row.account_id !== null ? { accountId: String(row.account_id) } : {}),
      ...(['scene.work_item.due', 'scene.schedule.due'].includes(String(row.event_type)) ? { notBefore: Number(row.occurred_at) } : {}),
    };
  }

  saveSnapshot(claim: SceneRunClaim, hash: string, evidenceIds: string[], now: number): boolean {
    return this.transaction(() => {
      if (!this.isCurrentClaim(claim, now)) return false;
      this.db.prepare('INSERT INTO scene_context_snapshots VALUES (?, ?, ?, ?, ?)')
        .run(claim.id, claim.leaseEpoch, hash, JSON.stringify(evidenceIds), now);
      return true;
    });
  }

  finishReadOnlyRun(claim: SceneRunClaim, result: { kind: 'no_change' | 'observation' | 'artifact' | 'decision'; summary: string; evidenceIds: string[] }, now: number): boolean {
    return this.transaction(() => {
      if (!this.isCurrentClaim(claim, now)) return false;
      const row = this.db.prepare(`SELECT t.manifest_json, a.owner_id, a.workspace_id FROM scene_activations a JOIN scene_template_versions t
        ON a.template_key = t.template_key AND a.template_version = t.version WHERE a.id = ?`).get(claim.activationId) as Row;
      const template = sceneTemplateSchema.parse(JSON.parse(String(row.manifest_json)));
      if (!['no_change', 'observation', 'artifact', 'decision'].includes(result.kind) || !template.allowedOutcomeKinds.includes(result.kind)) throw new Error('Scene result kind is not allowed');
      if (result.kind !== 'no_change' && (!result.summary.trim() || result.evidenceIds.length === 0)) throw new Error('Scene result needs summary and evidence');
      const snapshot = this.db.prepare('SELECT content_hash, evidence_ids_json FROM scene_context_snapshots WHERE run_id = ? AND lease_epoch = ?').get(claim.id, claim.leaseEpoch) as Row | undefined;
      if (snapshot) {
        this.db.prepare(`UPDATE scene_work_items SET observed_fingerprint = ? WHERE activation_id = ? AND status = 'watching'
          AND EXISTS (SELECT 1 FROM scene_trigger_intents i JOIN scene_events e ON e.id = i.event_id
            WHERE i.id = ? AND e.subject_id = scene_work_items.subject_id AND e.account_id = scene_work_items.account_id)`)
          .run(snapshot.content_hash, claim.activationId, claim.intentId);
      }
      const outcomeId = randomUUID();
      this.db.prepare(`UPDATE scene_presentations SET status = 'withdrawn' WHERE outcome_id IN (
        SELECT o.id FROM scene_outcomes o JOIN scene_runs r ON r.id = o.run_id
        JOIN scene_trigger_intents i ON i.id = r.intent_id JOIN scene_events e ON e.id = i.event_id
        JOIN scene_trigger_intents current_intent ON current_intent.id = ?
        JOIN scene_events current_event ON current_event.id = current_intent.event_id
        WHERE r.activation_id = ? AND e.subject_id = current_event.subject_id AND e.account_id IS current_event.account_id
      )`).run(claim.intentId, claim.activationId);
      this.db.prepare('INSERT INTO scene_outcomes VALUES (?, ?, ?, ?, ?)').run(outcomeId, claim.id, result.kind, JSON.stringify(result), now);
      if (result.kind !== 'no_change') {
        const presentationId = randomUUID();
        this.db.prepare("INSERT INTO scene_presentations(id, outcome_id, destination, status, created_at) VALUES (?, ?, 'inbox', 'unread', ?)").run(presentationId, outcomeId, now);
        this.db.prepare(`INSERT INTO notification_result_outbox
          (id, owner_id, workspace_id, subject_id, status, attempt, next_attempt_at, created_at, updated_at)
          VALUES (?, ?, ?, ?, 'pending', 0, ?, ?, ?)`)
          .run(presentationId, row.owner_id, row.workspace_id, presentationId, now, now, now);
      }
      const reason = result.kind === 'no_change'
        ? (snapshot && JSON.parse(String(snapshot.evidence_ids_json)).length === 0 ? 'empty_input' : 'no_relevant_change') : null;
      this.db.prepare("UPDATE scene_runs SET status = ?, reason = ?, lease_owner = NULL, lease_until = NULL WHERE id = ?")
        .run(result.kind === 'no_change' ? 'skipped' : 'succeeded', reason, claim.id);
      this.db.prepare("UPDATE scene_trigger_intents SET status = 'resolved' WHERE id = ?").run(claim.intentId);
      return true;
    });
  }

  finishAdapterRun(claim: SceneRunClaim, result: { kind: 'artifact' | 'decision' | 'receipt'; summary: string; [key: string]: unknown }, now: number): boolean {
    return this.transaction(() => {
      if (!this.isCurrentClaim(claim, now)) return false;
      const row = this.db.prepare(`SELECT t.manifest_json, a.owner_id, a.workspace_id FROM scene_activations a JOIN scene_template_versions t
        ON a.template_key = t.template_key AND a.template_version = t.version WHERE a.id = ?`).get(claim.activationId) as Row;
      const template = sceneTemplateSchema.parse(JSON.parse(String(row.manifest_json)));
      if (template.execution.kind === 'agent' || !template.allowedOutcomeKinds.includes(result.kind)) throw new Error('Scene result kind is not allowed');
      if (!result.summary.trim()) throw new Error('Scene result needs a summary');
      const outcomeId = randomUUID();
      this.db.prepare(`UPDATE scene_presentations AS p SET status = 'withdrawn', withdrawn_at = ? WHERE p.outcome_id IN (
        SELECT o.id FROM scene_outcomes o JOIN scene_runs r ON r.id = o.run_id
        WHERE r.activation_id = ?
      )`).run(now, claim.activationId);
      this.db.prepare('INSERT INTO scene_outcomes VALUES (?, ?, ?, ?, ?)').run(outcomeId, claim.id, result.kind, JSON.stringify(result), now);
      const presentationId = randomUUID();
      this.db.prepare("INSERT INTO scene_presentations(id, outcome_id, destination, status, created_at) VALUES (?, ?, 'inbox', 'unread', ?)")
        .run(presentationId, outcomeId, now);
      this.db.prepare(`INSERT INTO notification_result_outbox
        (id, owner_id, workspace_id, subject_id, status, attempt, next_attempt_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'pending', 0, ?, ?, ?)`)
        .run(presentationId, row.owner_id, row.workspace_id, presentationId, now, now, now);
      this.db.prepare("UPDATE scene_runs SET status = 'succeeded', reason = NULL, lease_owner = NULL, lease_until = NULL WHERE id = ?").run(claim.id);
      this.db.prepare("UPDATE scene_trigger_intents SET status = 'resolved' WHERE id = ?").run(claim.intentId);
      return true;
    });
  }

  listInbox(principal: ScenePrincipal, limit = 50, afterId = '', activationId: string | null = null) {
    this.assertPrincipal(principal);
    const now = Date.now();
    if (activationId !== null) this.getActivation(principal, activationId);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Invalid scene inbox limit');
    const cursor = afterId ? this.db.prepare(`SELECT p.created_at FROM scene_presentations p
      JOIN scene_outcomes o ON o.id = p.outcome_id JOIN scene_runs r ON r.id = o.run_id
      JOIN scene_activations a ON a.id = r.activation_id WHERE p.id = ? AND a.owner_id = ? AND a.workspace_id = ?
      AND (? IS NULL OR a.id = ?)`)
      .get(afterId, principal.ownerId, principal.workspaceId, activationId, activationId) as Row | undefined : undefined;
    if (afterId && !cursor) throw new SceneNotFoundError('Scene inbox cursor not found');
    const rows = this.db.prepare(`SELECT p.id, p.status, o.id AS outcome_id, o.content_json, a.id AS activation_id
      FROM scene_presentations p JOIN scene_outcomes o ON o.id = p.outcome_id JOIN scene_runs r ON r.id = o.run_id
      JOIN scene_activations a ON a.id = r.activation_id WHERE a.owner_id = ? AND a.workspace_id = ?
      AND (? IS NULL OR a.id = ?)
      AND (p.status IN ('unread', 'read') OR (p.status = 'snoozed' AND p.snoozed_until <= ?))
      AND (p.expires_at IS NULL OR p.expires_at > ?) AND p.withdrawn_at IS NULL
      AND (? IS NULL OR p.created_at < ? OR (p.created_at = ? AND p.id < ?))
      ORDER BY p.created_at DESC, p.id DESC LIMIT ?`)
      .all(principal.ownerId, principal.workspaceId, activationId, activationId, now, now, cursor?.created_at ?? null, cursor?.created_at ?? null, cursor?.created_at ?? null, afterId, limit) as Row[];
    return rows.map((row) => this.getPresentation(principal, String(row.id)));
  }

  getPresentation(principal: ScenePrincipal, id: string) {
    this.assertPrincipal(principal);
    const row = this.db.prepare(`SELECT p.*, o.id AS outcome_id, o.content_json, r.activation_id, r.intent_id
      FROM scene_presentations p JOIN scene_outcomes o ON o.id = p.outcome_id
      JOIN scene_runs r ON r.id = o.run_id JOIN scene_activations a ON a.id = r.activation_id
      WHERE p.id = ? AND a.owner_id = ? AND a.workspace_id = ? AND p.withdrawn_at IS NULL AND p.status <> 'withdrawn'`)
      .get(id, principal.ownerId, principal.workspaceId);
    if (!row) throw new SceneNotFoundError('Scene presentation not found');
    const now = Date.now();
    const actionable = (row.status === 'unread' || row.status === 'read'
      || (row.status === 'snoozed' && row.snoozed_until !== null && Number(row.snoozed_until) <= now))
      && (row.expires_at === null || Number(row.expires_at) > now);
    const source = this.db.prepare(`SELECT m.subject, m.sender, m.thread_id FROM scene_trigger_intents i
      JOIN scene_events e ON e.id = i.event_id JOIN scene_mail_sources m ON m.id = e.subject_id
      AND m.owner_id = e.owner_id AND m.workspace_id = e.workspace_id AND m.account_id = e.account_id WHERE i.id = ?`).get(row.intent_id);
    const providers = this.getActivation(principal, String(row.activation_id)).permissions.contextProviders;
    const sources = source ? [{ kind: 'mail', title: String(source.subject), sender: String(source.sender),
      href: `https://mail.google.com/mail/#all/${encodeURIComponent(String(source.thread_id))}` }]
      : providers.includes('user_notes') ? [{ kind: 'notes', title: '', sender: '', href: `#/scenes/${row.activation_id}` }] : [];
    return { createdAt: Number(row.created_at), sources, sourceHealth: this.getSourceHealth(String(row.activation_id)),
      id: String(row.id), activationId: String(row.activation_id), outcomeId: String(row.outcome_id),
      content: JSON.parse(String(row.content_json)) as unknown, status: String(row.status), readOnly: !actionable };
  }

  listDigestResults(principal: ScenePrincipal, digestId: string, limit = 20, afterId = '') {
    this.assertPrincipal(principal);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new SceneInputError('Invalid digest page');
    if (!this.db.prepare('SELECT 1 FROM notification_digests WHERE id = ? AND owner_id = ? AND workspace_id = ?')
      .get(digestId, principal.ownerId, principal.workspaceId)) throw new SceneNotFoundError('Scene digest not found');
    const rows = this.db.prepare(`SELECT p.id FROM notification_digest_members m
      JOIN scene_presentations p ON p.id = m.subject_id JOIN scene_outcomes o ON o.id = p.outcome_id
      JOIN scene_runs r ON r.id = o.run_id JOIN scene_activations a ON a.id = r.activation_id
      WHERE m.digest_id = ? AND a.owner_id = ? AND a.workspace_id = ?
      AND p.withdrawn_at IS NULL AND p.status <> 'withdrawn' AND p.id > ? ORDER BY p.id LIMIT ?`)
      .all(digestId, principal.ownerId, principal.workspaceId, afterId, limit + 1);
    return { outcomes: rows.slice(0, limit).map((row) => this.getPresentation(principal, String(row.id))),
      nextCursor: rows.length > limit ? String(rows[limit - 1].id) : null };
  }

  failRun(claim: SceneRunClaim, now: number, reason: string, retryAt?: number): boolean {
    return this.transaction(() => {
      if (!this.isCurrentClaim(claim, now)) return false;
      const retry = retryAt !== undefined && claim.attempt < 3;
      if (retry && (!Number.isSafeInteger(retryAt) || retryAt <= now)) throw new Error('Invalid scene retry time');
      this.db.prepare('UPDATE scene_runs SET status = ?, reason = ?, retry_at = ?, lease_owner = NULL, lease_until = NULL WHERE id = ?')
        .run(retry ? 'retry_wait' : 'failed', reason, retry ? retryAt : null, claim.id);
      if (!retry) this.db.prepare("UPDATE scene_trigger_intents SET status = 'resolved' WHERE id = ?").run(claim.intentId);
      return true;
    });
  }

  private isCurrentClaim(claim: SceneRunClaim, now: number): boolean {
    return !!this.db.prepare(`SELECT 1 FROM scene_runs r JOIN scene_activations a ON a.id = r.activation_id
      WHERE r.id = ? AND r.intent_id = ? AND r.activation_id = ? AND r.activation_revision = ?
      AND r.status = 'running' AND r.lease_owner = ? AND r.lease_epoch = ? AND r.lease_until > ?
      AND a.status = 'active' AND a.revision = r.activation_revision AND ${checksAllowed}`)
      .get(claim.id, claim.intentId, claim.activationId, claim.activationRevision, claim.leaseOwner, claim.leaseEpoch, now, now / 1000);
  }

  private readClaim(id: string): SceneRunClaim {
    const row = this.db.prepare('SELECT * FROM scene_runs WHERE id = ?').get(id) as Row;
    return { id, intentId: String(row.intent_id), activationId: String(row.activation_id), activationRevision: Number(row.activation_revision),
      leaseOwner: String(row.lease_owner), leaseEpoch: Number(row.lease_epoch), attempt: Number(row.attempt) };
  }

  private assertPrincipal(principal: ScenePrincipal): void {
    if (!principal.ownerId?.trim() || !principal.workspaceId?.trim()) throw new Error('Scene principal is required');
  }
}
