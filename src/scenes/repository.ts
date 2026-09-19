import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import {
  activationInputSchema, canTransitionActivation, sceneContentHash, sceneTemplateSchema,
  type ActivationStatus, type SceneActivation, type ScenePrincipal, type SceneTemplate,
} from './contracts.js';

type Row = Record<string, string | number | null>;

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

/** The caller supplies the database; production wiring is installed at cutover only. */
export class SceneRepository {
  constructor(private readonly db: DatabaseSync) {}

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
    return {
      id: String(row.id), ...principal,
      templateKey: String(row.template_key), templateVersion: String(row.template_version), goal: String(row.goal),
      scope: JSON.parse(String(row.scope_json)), permissions: JSON.parse(String(row.permissions_json)),
      status: row.status as ActivationStatus, revision: Number(row.revision),
    };
  }

  createWorkItem(principal: ScenePrincipal, activationId: string, input: { subjectId: string; accountId: string; dueAt: number }, now: number): SceneWorkItem {
    return this.transaction(() => {
      const activation = this.getActivation(principal, activationId);
      if (activation.status !== 'active') throw new SceneConflictError('Scene activation is not active');
      if (!input.subjectId.trim() || !activation.permissions.accountIds.includes(input.accountId)) throw new Error('Work item account is not authorized');
      if (activation.scope.kind !== 'objects' || !activation.scope.ids.includes(input.subjectId)) throw new Error('Mail follow-up requires an explicit object scope');
      if (!this.getTemplate(activation.templateKey, activation.templateVersion).triggers.some((item) => item.type === 'schedule')) throw new Error('Work item template needs a schedule trigger');
      if (!Number.isSafeInteger(input.dueAt) || input.dueAt <= now) throw new Error('Work item deadline must be in the future');
      const id = randomUUID();
      this.db.prepare(`INSERT INTO scene_work_items VALUES (?, ?, ?, ?, ?, 1, 'watching', NULL, NULL)`)
        .run(id, activationId, input.subjectId, input.accountId, input.dueAt);
      return { id, activationId, ...input, revision: 1, status: 'watching' };
    });
  }

  /** Due dates are durable; restarting cannot generate a second occurrence. */
  enqueueDueWorkItems(now: number): number {
    return this.transaction(() => {
      const rows = this.db.prepare(`SELECT w.*, a.owner_id, a.workspace_id FROM scene_work_items w
        JOIN scene_activations a ON a.id = w.activation_id WHERE w.status = 'watching' AND a.status = 'active'
        AND w.due_at <= ? AND (w.last_triggered_revision IS NULL OR w.last_triggered_revision <> w.revision)
        ORDER BY w.due_at, w.id LIMIT 100`).all(now) as Row[];
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

  transitionActivation(principal: ScenePrincipal, id: string, revision: number, status: ActivationStatus): SceneActivation {
    return this.transaction(() => {
      const activation = this.getActivation(principal, id);
      if (activation.revision !== revision || !canTransitionActivation(activation.status, status)) {
        throw new SceneConflictError('Scene activation changed or transition is invalid');
      }
      this.db.prepare('UPDATE scene_activations SET status = ?, revision = revision + 1 WHERE id = ?').run(status, id);
      this.db.prepare("UPDATE scene_trigger_intents SET status = 'cancelled' WHERE activation_id = ? AND status IN ('pending', 'claimed')").run(id);
      this.db.prepare("UPDATE scene_runs SET status = 'cancelled', reason = 'activation_changed', lease_owner = NULL, lease_until = NULL WHERE activation_id = ? AND status IN ('running', 'retry_wait')").run(id);
      return this.getActivation(principal, id);
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
        WHERE a.status = 'active' AND a.revision = r.activation_revision AND r.attempt < 3
        AND ((r.status = 'running' AND r.lease_until <= ?) OR (r.status = 'retry_wait' AND r.retry_at <= ?))
        ORDER BY r.created_at, r.id LIMIT 1`).get(now, now) as Row | undefined;
      if (retry) {
        this.db.prepare(`UPDATE scene_runs SET status = 'running', attempt = attempt + 1, lease_epoch = lease_epoch + 1,
          lease_owner = ?, lease_until = ?, retry_at = NULL WHERE id = ?`).run(worker, now + leaseMs, retry.id);
        return this.readClaim(String(retry.id));
      }
      const intent = this.db.prepare(`SELECT i.* FROM scene_trigger_intents i JOIN scene_activations a ON a.id = i.activation_id
        WHERE i.status = 'pending' AND i.due_at <= ? AND a.status = 'active' AND a.revision = i.activation_revision
        AND NOT EXISTS (SELECT 1 FROM scene_runs r WHERE r.activation_id = a.id AND r.status IN ('running', 'retry_wait'))
        ORDER BY i.due_at, i.id LIMIT 1`).get(now) as Row | undefined;
      if (!intent) return null;
      const id = randomUUID();
      this.db.prepare(`INSERT INTO scene_runs (id, intent_id, activation_id, activation_revision, status, attempt, lease_epoch, lease_owner, lease_until, created_at)
        VALUES (?, ?, ?, ?, 'running', 1, 1, ?, ?, ?)`).run(id, intent.id, intent.activation_id, intent.activation_revision, worker, now + leaseMs, now);
      this.db.prepare("UPDATE scene_trigger_intents SET status = 'claimed' WHERE id = ?").run(intent.id);
      return this.readClaim(id);
    });
  }

  renewLease(claim: SceneRunClaim, now: number, leaseMs: number): boolean {
    if (!Number.isSafeInteger(leaseMs) || leaseMs < 1) throw new Error('Invalid scene lease');
    return this.db.prepare(`UPDATE scene_runs SET lease_until = ? WHERE id = ? AND status = 'running'
      AND lease_owner = ? AND lease_epoch = ? AND lease_until > ?`)
      .run(now + leaseMs, claim.id, claim.leaseOwner, claim.leaseEpoch, now).changes === 1;
  }

  getRunInput(claim: SceneRunClaim, now: number): { activation: SceneActivation; subjectId: string; accountId?: string; notBefore?: number } | null {
    if (!this.isCurrentClaim(claim, now)) return null;
    const row = this.db.prepare(`SELECT a.owner_id, a.workspace_id, e.subject_id, e.account_id, e.event_type, e.occurred_at FROM scene_activations a
      JOIN scene_trigger_intents i ON i.activation_id = a.id JOIN scene_events e ON e.id = i.event_id
      WHERE i.id = ? AND a.id = ?`).get(claim.intentId, claim.activationId) as Row;
    return { activation: this.getActivation({ ownerId: String(row.owner_id), workspaceId: String(row.workspace_id) }, claim.activationId), subjectId: String(row.subject_id), ...(row.account_id !== null ? { accountId: String(row.account_id) } : {}), ...(row.event_type === 'scene.work_item.due' ? { notBefore: Number(row.occurred_at) } : {}) };
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
      const row = this.db.prepare(`SELECT t.manifest_json FROM scene_activations a JOIN scene_template_versions t
        ON a.template_key = t.template_key AND a.template_version = t.version WHERE a.id = ?`).get(claim.activationId) as Row;
      const template = sceneTemplateSchema.parse(JSON.parse(String(row.manifest_json)));
      if (!['no_change', 'observation', 'artifact', 'decision'].includes(result.kind) || !template.allowedOutcomeKinds.includes(result.kind)) throw new Error('Scene result kind is not allowed');
      if (result.kind !== 'no_change' && (!result.summary.trim() || result.evidenceIds.length === 0)) throw new Error('Scene result needs summary and evidence');
      const outcomeId = randomUUID();
      this.db.prepare('INSERT INTO scene_outcomes VALUES (?, ?, ?, ?, ?)').run(outcomeId, claim.id, result.kind, JSON.stringify(result), now);
      if (result.kind !== 'no_change') {
        this.db.prepare("INSERT INTO scene_presentations VALUES (?, ?, 'inbox', 'unread', ?)").run(randomUUID(), outcomeId, now);
      }
      this.db.prepare("UPDATE scene_runs SET status = ?, lease_owner = NULL, lease_until = NULL WHERE id = ?")
        .run(result.kind === 'no_change' ? 'skipped' : 'succeeded', claim.id);
      this.db.prepare("UPDATE scene_trigger_intents SET status = 'resolved' WHERE id = ?").run(claim.intentId);
      return true;
    });
  }

  listInbox(principal: ScenePrincipal, limit = 50): Array<{ id: string; activationId: string; outcomeId: string; content: unknown; status: string }> {
    this.assertPrincipal(principal);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Invalid scene inbox limit');
    const rows = this.db.prepare(`SELECT p.id, p.status, o.id AS outcome_id, o.content_json, a.id AS activation_id
      FROM scene_presentations p JOIN scene_outcomes o ON o.id = p.outcome_id JOIN scene_runs r ON r.id = o.run_id
      JOIN scene_activations a ON a.id = r.activation_id WHERE a.owner_id = ? AND a.workspace_id = ?
      AND p.status <> 'withdrawn' ORDER BY p.created_at DESC, p.id DESC LIMIT ?`).all(principal.ownerId, principal.workspaceId, limit) as Row[];
    return rows.map((row) => ({ id: String(row.id), activationId: String(row.activation_id), outcomeId: String(row.outcome_id), content: JSON.parse(String(row.content_json)), status: String(row.status) }));
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
      AND a.status = 'active' AND a.revision = r.activation_revision`)
      .get(claim.id, claim.intentId, claim.activationId, claim.activationRevision, claim.leaseOwner, claim.leaseEpoch, now);
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
