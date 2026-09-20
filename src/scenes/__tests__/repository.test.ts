import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SceneRepository } from '../repository.js';
import { installSceneStorage } from '../../storage/sqlite/scenes-schema.js';
import { sceneNotificationEligibility } from '../notificationEligibility.js';
import { createSceneNotificationOutbox } from '../notificationPublication.js';
import { ScenePreferenceService } from '../preferences.js';

const principal = { ownerId: 'local-user', workspaceId: 'workspace' };
const manifest = {
  schemaVersion: 1, key: 'mail-follow-up', version: '1.0.0', title: 'Mail follow-up', description: 'Prepare a follow-up',
  goalMode: 'ongoing', contextProviders: ['mail'], triggers: [{ id: 'check', type: 'manual' }, { id: 'due', type: 'schedule' }],
  execution: { kind: 'agent', instruction: 'Read the authorized thread and prepare a follow-up.', limits: { timeoutSeconds: 90, maxIterations: 6, maxToolCalls: 6, maxOutputTokens: 2000 } },
  allowedOutcomeKinds: ['no_change', 'artifact', 'decision'], allowedEffectHandlers: [],
};

describe('durable scene repository', () => {
  let db: DatabaseSync;
  let repository: SceneRepository;
  let directory: string;
  let activationId: string;
  const event = { source: 'mail:personal', sourceEventId: 'thread:1:revision:1', eventType: 'mail.changed', subjectId: 'thread:1', occurredAt: 1000 };
  const outcome = { kind: 'artifact' as const, summary: 'A reply draft', evidenceIds: ['thread:1:revision:1'] };
  const accept = (occurrenceKey = 'check:1') => repository.acceptTrigger(principal, activationId, { event, triggerKey: 'check', occurrenceKey, dueAt: 1000 }, 1000);

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'xopc-scenes-test-'));
    db = new DatabaseSync(join(directory, 'scenes.db'));
    db.exec('PRAGMA foreign_keys = ON');
    installSceneStorage(db);

    repository = new SceneRepository(db);
    repository.installTemplate(manifest);
    const activation = repository.createActivation(principal, {
      templateKey: manifest.key, templateVersion: manifest.version, goal: 'Follow up this thread', scope: { kind: 'objects', ids: ['thread:1'] },
      permissions: { contextProviders: ['mail'], accountIds: ['personal'], effectHandlers: [] },
    });
    activationId = activation.id;
    repository.transitionActivation(principal, activationId, 1, 'active');
  });

  afterEach(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });

  it('keeps published versions immutable', () => {
    expect(() => repository.installTemplate(manifest)).not.toThrow();
    expect(() => repository.installTemplate({ ...manifest, title: 'Changed' })).toThrow('immutable');
  });

  it('does not pause model work when only notifications are muted', () => {
    new ScenePreferenceService(db).update(principal, { expectedRevision: 0, notificationsMuted: true });
    accept(); expect(repository.claimNext('worker', 1000)).not.toBeNull();
    expect(repository.getActivation(principal, activationId).revision).toBe(2);
  });

  it('invalidates active claims across a global pause and resume', () => {
    accept(); const claim = repository.claimNext('worker', 1000)!;
    const service = new ScenePreferenceService(db);
    service.update(principal, { expectedRevision: 0, checksPaused: true });
    expect(repository.claimNext('other', 1001)).toBeNull();
    expect(repository.getRunInput(claim, 1001)).toBeNull();
    service.update(principal, { expectedRevision: 1, checksPaused: false });
    expect(repository.finishReadOnlyRun(claim, outcome, 1002)).toBe(false);
    expect(repository.getActivation(principal, activationId).revision).toBe(4);
    expect(db.prepare('SELECT * FROM notification_result_outbox').all()).toEqual([]);
  });

  it('keeps pending checks unclaimed until a timed pause expires', () => {
    new ScenePreferenceService(db).update(principal, { expectedRevision: 0, checksPausedUntil: new Date(2000).toISOString() });
    accept();
    expect(repository.claimNext('worker', 1000)).toBeNull();
    expect(repository.claimNext('worker', 2000)).not.toBeNull();
  });

  it('commits the result, presentation and notification outbox exactly once', () => {
    accept(); const claim = repository.claimNext('worker', 1000)!;
    expect(repository.finishReadOnlyRun(claim, outcome, 1001)).toBe(true);
    expect(repository.finishReadOnlyRun(claim, outcome, 1002)).toBe(false);
    const presentation = db.prepare('SELECT id FROM scene_presentations').get()!;
    expect(db.prepare('SELECT * FROM notification_result_outbox').all()).toMatchObject([
      { subject_id: presentation.id, owner_id: principal.ownerId, workspace_id: principal.workspaceId, status: 'pending', attempt: 0 },
    ]);
    expect(db.prepare('SELECT count(*) AS n FROM scene_outcomes').get()?.n).toBe(1);
  });

  it('rolls back the complete result when the outbox cannot be written', () => {
    accept(); const claim = repository.claimNext('worker', 1000)!;
    db.exec(`CREATE TRIGGER fail_outbox BEFORE INSERT ON notification_result_outbox
      BEGIN SELECT RAISE(ABORT, 'Injected publication failure'); END`);
    expect(() => repository.finishReadOnlyRun(claim, outcome, 1001)).toThrow('Injected');
    expect(db.prepare('SELECT * FROM scene_outcomes').all()).toEqual([]);
    expect(db.prepare('SELECT * FROM scene_presentations').all()).toEqual([]);
    expect(db.prepare('SELECT status FROM scene_runs').get()?.status).toBe('running');
    db.exec('DROP TRIGGER fail_outbox');
    expect(repository.finishReadOnlyRun(claim, outcome, 1002)).toBe(true);
  });

  it('does not notify on no change or after an activation is paused', () => {
    accept(); const claim = repository.claimNext('worker', 1000)!;
    expect(repository.finishReadOnlyRun(claim, { kind: 'no_change', summary: '', evidenceIds: [] }, 1001)).toBe(true);
    accept('check:2'); const next = repository.claimNext('worker', 1002)!;
    repository.transitionActivation(principal, activationId, 2, 'paused');
    expect(repository.finishReadOnlyRun(next, outcome, 1003)).toBe(false);
    expect(db.prepare('SELECT * FROM notification_result_outbox').all()).toEqual([]);
  });

  it.each([
    ["UPDATE scene_activations SET status = 'paused'", 'activation_inactive'],
    ['UPDATE scene_activations SET revision = revision + 1', 'activation_changed'],
    ["UPDATE scene_presentations SET status = 'read'", 'result_reviewed'],
    ["UPDATE scene_presentations SET status = 'resolved'", 'result_reviewed'],
    ["UPDATE scene_presentations SET status = 'withdrawn'", 'result_withdrawn'],
    ['UPDATE scene_presentations SET withdrawn_at = 1000', 'result_withdrawn'],
    ['UPDATE scene_presentations SET expires_at = 1001', 'result_expired'],
  ])('settles without dispatching an ineligible result: %s', (sql, reason) => {
    accept(); repository.finishReadOnlyRun(repository.claimNext('worker', 1000)!, outcome, 1001);
    const subjectId = String(db.prepare('SELECT id FROM scene_presentations').get()!.id);
    db.exec(sql);
    expect(sceneNotificationEligibility(db, { id: subjectId, ...principal, subjectId }, 1001)).toEqual({ action: 'cancel', reason });
    const outbox = createSceneNotificationOutbox(db, () => { throw new Error('Must not publish'); }, () => 1001);
    expect(outbox.drainOne()).toBe(true);
    expect(db.prepare('SELECT status, decision_reason FROM notification_result_outbox').get()).toMatchObject({ status: 'settled', decision_reason: reason });
  });

  it('rejects cross-owner, cross-workspace and stale notification revisions', () => {
    accept(); repository.finishReadOnlyRun(repository.claimNext('worker', 1000)!, outcome, 1001);
    const subjectId = String(db.prepare('SELECT id FROM scene_presentations').get()!.id);
    const result = { id: subjectId, ...principal, subjectId };
    expect(sceneNotificationEligibility(db, { ...result, ownerId: 'other' }, 1001).action).toBe('cancel');
    expect(sceneNotificationEligibility(db, { ...result, workspaceId: 'other' }, 1001).action).toBe('cancel');
    expect(sceneNotificationEligibility(db, result, 1001, 2)).toEqual({ action: 'cancel', reason: 'result_changed' });
    expect(sceneNotificationEligibility(db, result, 1001, 1)).toMatchObject({ action: 'eligible', activationId, revision: 1 });
  });

  it('defers snoozed results and invokes host policy only when eligible', () => {
    accept(); repository.finishReadOnlyRun(repository.claimNext('worker', 1000)!, outcome, 1001);
    db.exec("UPDATE scene_presentations SET status = 'snoozed', snoozed_until = 2000");
    let now = 1001; let published = 0;
    const outbox = createSceneNotificationOutbox(db, (_result, eligible) => {
      expect(eligible).toMatchObject({ activationId, revision: 1, kind: 'artifact' });
      published++; return { action: 'settle' };
    }, () => now);
    outbox.drainOne(); expect(published).toBe(0);
    expect(db.prepare('SELECT next_attempt_at, attempt FROM notification_result_outbox').get()).toMatchObject({ next_attempt_at: 2000, attempt: 0 });
    now = 2000; outbox.drainOne(); expect(published).toBe(1);
    expect(outbox.drainOne()).toBe(false);
  });

  it('suppresses muted notifications without removing the result', () => {
    accept(); repository.finishReadOnlyRun(repository.claimNext('worker', 1000)!, outcome, 1001);
    new ScenePreferenceService(db).update(principal, { expectedRevision: 0, notificationsMuted: true });
    createSceneNotificationOutbox(db, () => { throw new Error('Must not publish'); }, () => 1001).drainOne();
    expect(db.prepare('SELECT status, decision_reason FROM notification_result_outbox').get()).toMatchObject({ status: 'settled', decision_reason: 'notifications_muted' });
    expect(repository.listInbox(principal)).toHaveLength(1);
  });

  it('defers quiet hours without invoking the host or consuming attempts', () => {
    accept(); repository.finishReadOnlyRun(repository.claimNext('worker', 1000)!, outcome, 1001);
    new ScenePreferenceService(db).update(principal, { expectedRevision: 0, timezone: 'UTC' });
    createSceneNotificationOutbox(db, () => { throw new Error('Must not publish'); }, () => 1001).drainOne();
    expect(db.prepare('SELECT * FROM notification_result_outbox').get()).toMatchObject({ status: 'pending', decision_reason: 'quiet_hours', attempt: 0, next_attempt_at: 8 * 3600_000 });
  });

  it.each([['local-user', 2000, 0], ['other', 2000, 1], ['local-user', 1000, 1]] as const)
    ('suppresses only current, same-owner viewing presence: %s %s', (owner, expiresAt, expectedPublications) => {
      accept(); repository.finishReadOnlyRun(repository.claimNext('worker', 1000)!, outcome, 1001);
      const subjectId = String(db.prepare('SELECT id FROM scene_presentations').get()!.id);
      db.prepare('INSERT INTO notification_presence VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(owner, principal.workspaceId, 'client', 'web', expiresAt, subjectId, 1);
      let published = 0;
      createSceneNotificationOutbox(db, () => { published++; return { action: 'settle' }; }, () => 1001).drainOne();
      expect(published).toBe(expectedPublications);
      expect(db.prepare('SELECT status FROM notification_result_outbox').get()?.status).toBe('settled');
    });

  it('isolates activations by principal and workspace', () => {
    expect(() => repository.getActivation({ ...principal, ownerId: 'another' }, activationId)).toThrow('not found');
    expect(() => repository.getActivation({ ...principal, workspaceId: 'another' }, activationId)).toThrow('not found');
    expect(() => repository.getActivation({ ...principal, ownerId: '' }, activationId)).toThrow('required');
  });

  it('requires current revision and cancels pending work when paused', () => {
    accept();
    expect(() => repository.transitionActivation(principal, activationId, 1, 'paused')).toThrow('changed');
    repository.transitionActivation(principal, activationId, 2, 'paused');
    expect(repository.claimNext('worker', 1000)).toBeNull();
    expect(() => accept('check:2')).toThrow('not active');
  });

  it('stores duplicate events and occurrences exactly once', () => {
    const first = accept();
    expect(accept()).toBe(first);
    expect(db.prepare('SELECT count(*) AS n FROM scene_events').get()?.n).toBe(1);
    expect(db.prepare('SELECT count(*) AS n FROM scene_trigger_intents').get()?.n).toBe(1);
  });

  it('rejects event identity reuse with changed content', () => {
    accept();
    expect(() => repository.acceptTrigger(principal, activationId, {
      event: { ...event, subjectId: 'another-thread' }, triggerKey: 'check', occurrenceKey: 'check:1', dueAt: 1000,
    }, 1000)).toThrow('different content');
  });

  it('does not accept an unregistered trigger', () => {
    expect(() => repository.acceptTrigger(principal, activationId, { event, triggerKey: 'unknown', occurrenceKey: 'one', dueAt: 1000 }, 1000)).toThrow('does not match');
    expect(db.prepare('SELECT count(*) AS n FROM scene_events').get()?.n).toBe(0);
  });

  it('joins the enclosing domain transaction', () => {
    db.exec('BEGIN');
    accept();
    db.exec('ROLLBACK');
    expect(db.prepare('SELECT count(*) AS n FROM scene_trigger_intents').get()?.n).toBe(0);
    expect(db.prepare('SELECT count(*) AS n FROM scene_events').get()?.n).toBe(0);
  });

  it('resumes durable work after reopening the database', () => {
    accept();
    db.close();
    db = new DatabaseSync(join(directory, 'scenes.db'));
    repository = new SceneRepository(db);
    const claim = repository.claimNext('worker', 1000)!;
    expect(repository.finishReadOnlyRun(claim, outcome, 1100)).toBe(true);
    expect(repository.claimNext('worker', 1200)).toBeNull();
  });

  it('allows only one active run per activation', () => {
    accept(); accept('check:2');
    const first = repository.claimNext('worker-1', 1000)!;
    const secondConnection = new DatabaseSync(join(directory, 'scenes.db'));
    try { expect(new SceneRepository(secondConnection).claimNext('worker-2', 1000)).toBeNull(); }
    finally { secondConnection.close(); }
    repository.finishReadOnlyRun(first, outcome, 1001);
    expect(repository.claimNext('worker-2', 1002)).not.toBeNull();
  });

  it('fences an expired worker after a new claim', () => {
    accept();
    const first = repository.claimNext('worker', 1000, 100)!;
    const second = repository.claimNext('worker', 1100, 100)!;
    expect(second.id).toBe(first.id);
    expect(second.leaseEpoch).toBe(2);
    expect(repository.renewLease(first, 1101, 100)).toBe(false);
    expect(repository.finishReadOnlyRun(first, outcome, 1101)).toBe(false);
    expect(repository.finishReadOnlyRun(second, outcome, 1101)).toBe(true);
    expect(repository.finishReadOnlyRun(second, outcome, 1102)).toBe(false);
  });

  it('rejects completion after expiration even without a replacement worker', () => {
    accept(); const claim = repository.claimNext('worker', 1000, 100)!;
    expect(repository.finishReadOnlyRun(claim, outcome, 1100)).toBe(false);
  });

  it('rejects completion after pause and resume', () => {
    accept(); const claim = repository.claimNext('worker', 1000)!;
    repository.transitionActivation(principal, activationId, 2, 'paused');
    repository.transitionActivation(principal, activationId, 3, 'active');
    expect(repository.finishReadOnlyRun(claim, outcome, 1001)).toBe(false);
  });

  it('bounds retries and resolves exhausted work', () => {
    accept();
    const first = repository.claimNext('worker', 1000, 100)!;
    expect(repository.failRun(first, 1001, 'temporary_failure', 1100)).toBe(true);
    expect(repository.claimNext('worker', 1099)).toBeNull();
    const second = repository.claimNext('worker', 1100, 100)!;
    expect(second.attempt).toBe(2);
    const third = repository.claimNext('worker', 1200, 100)!;
    expect(third.attempt).toBe(3);
    expect(repository.claimNext('worker', 1300)).toBeNull();
    expect(db.prepare('SELECT status FROM scene_runs').get()?.status).toBe('failed');
    expect(db.prepare('SELECT status FROM scene_trigger_intents').get()?.status).toBe('resolved');
  });

  it('requires evidence and never completes the ongoing activation with its run', () => {
    accept(); const claim = repository.claimNext('worker', 1000)!;
    expect(() => repository.finishReadOnlyRun(claim, { ...outcome, evidenceIds: [] }, 1001)).toThrow('evidence');
    expect(repository.finishReadOnlyRun(claim, outcome, 1002)).toBe(true);
    expect(repository.getActivation(principal, activationId).status).toBe('active');
  });

  it('cannot accept a forged claim for a different activation or intent', () => {
    accept(); const claim = repository.claimNext('worker', 1000)!;
    expect(repository.finishReadOnlyRun({ ...claim, activationId: 'other' }, outcome, 1001)).toBe(false);
    expect(repository.finishReadOnlyRun({ ...claim, intentId: 'other' }, outcome, 1001)).toBe(false);
  });

  it('enqueues a due work item once and preserves the exact account in its claim', () => {
    repository.createWorkItem(principal, activationId, { subjectId: 'thread:1', accountId: 'personal', dueAt: 2000 }, 1000);
    expect(repository.enqueueDueWorkItems(1999)).toBe(0);
    expect(repository.enqueueDueWorkItems(2000)).toBe(1);
    expect(repository.enqueueDueWorkItems(2001)).toBe(0);
    const claim = repository.claimNext('worker', 2001)!;
    expect(repository.getRunInput(claim, 2001)).toMatchObject({ subjectId: 'thread:1', accountId: 'personal' });
  });

  it('rejects a work item outside the exact account and object scope', () => {
    expect(() => repository.createWorkItem(principal, activationId, { subjectId: 'thread:2', accountId: 'personal', dueAt: 2000 }, 1000)).toThrow('scope');
    expect(() => repository.createWorkItem(principal, activationId, { subjectId: 'thread:1', accountId: 'work', dueAt: 2000 }, 1000)).toThrow('account');
    expect(() => repository.createWorkItem(principal, activationId, { subjectId: 'thread:1', accountId: 'personal', dueAt: 1000 }, 1000)).toThrow('future');
  });

  it('pauses an expired deadline rather than creating a catch-up storm', () => {
    repository.createWorkItem(principal, activationId, { subjectId: 'thread:1', accountId: 'personal', dueAt: 2000 }, 1000);
    expect(repository.enqueueDueWorkItems(86_402_001)).toBe(0);
    expect(db.prepare('SELECT status, last_check_reason FROM scene_work_items').get()).toMatchObject({ status: 'paused', last_check_reason: 'deadline_expired' });
  });

  it('atomically publishes useful results to the scoped inbox, but not no_change', () => {
    accept(); const first = repository.claimNext('worker', 1000)!;
    repository.finishReadOnlyRun(first, outcome, 1001);
    expect(repository.listInbox(principal)).toHaveLength(1);
    expect(repository.listInbox({ ...principal, ownerId: 'another' })).toEqual([]);
    accept('check:2'); const second = repository.claimNext('worker', 1002)!;
    repository.finishReadOnlyRun(second, { kind: 'no_change', summary: '', evidenceIds: [] }, 1003);
    expect(repository.listInbox(principal)).toHaveLength(0);
  });

  it('reschedules with CAS, cancels the old claim, and creates a new occurrence', () => {
    const item = repository.createWorkItem(principal, activationId, { subjectId: 'thread:1', accountId: 'personal', dueAt: 2000 }, 1000);
    repository.enqueueDueWorkItems(2000);
    const claim = repository.claimNext('worker', 2000)!;
    const updated = repository.updateWorkItem(principal, item.id, { expectedRevision: 1, dueAt: 4000 }, 2001);
    expect(updated.revision).toBe(2);
    expect(repository.finishReadOnlyRun(claim, outcome, 2002)).toBe(false);
    expect(() => repository.updateWorkItem(principal, item.id, { expectedRevision: 1, status: 'completed' }, 2002)).toThrow('changed');
    expect(repository.enqueueDueWorkItems(3999)).toBe(0);
    expect(repository.enqueueDueWorkItems(4000)).toBe(1);
    expect(repository.claimNext('worker', 4000)?.intentId).not.toBe(claim.intentId);
  });

  it('withdraws completed item results but leaves the ongoing activation active', () => {
    const item = repository.createWorkItem(principal, activationId, { subjectId: 'thread:1', accountId: 'personal', dueAt: 2000 }, 1000);
    repository.enqueueDueWorkItems(2000);
    repository.finishReadOnlyRun(repository.claimNext('worker', 2000)!, outcome, 2001);
    expect(repository.listInbox(principal)).toHaveLength(1);
    repository.updateWorkItem(principal, item.id, { expectedRevision: 1, status: 'completed' }, 2002);
    expect(repository.listInbox(principal)).toEqual([]);
    expect(repository.getActivation(principal, activationId).status).toBe('active');
    expect(repository.enqueueDueWorkItems(3000)).toBe(0);
    expect(() => repository.updateWorkItem({ ...principal, ownerId: 'other' }, item.id, { expectedRevision: 2, status: 'watching' }, 3000)).toThrow('not found');
    expect(() => repository.updateWorkItem(principal, item.id, { expectedRevision: 2, status: 'watching' }, 3000)).toThrow('completed');
  });

  it('atomically reserves model calls once per lease and resets UTC daily budgets', () => {
    accept();
    const first = repository.claimNext('worker', 1000)!;
    expect(repository.reserveModelCall(first, 1000, { activation: 1, owner: 1 })).toBe(true);
    expect(repository.reserveModelCall(first, 1000, { activation: 1, owner: 1 })).toBe(false);
    repository.finishReadOnlyRun(first, outcome, 1001);
    accept('second');
    const second = repository.claimNext('worker', 1002)!;
    expect(repository.reserveModelCall(second, 1002, { activation: 1, owner: 1 })).toBe(false);
    expect(repository.deferRun(second, 1002, 'daily_budget', 86_400_000)).toBe('deferred');
    const resumed = repository.claimNext('worker', 86_400_000)!;
    expect(resumed.attempt).toBe(1);
    expect(repository.reserveModelCall(resumed, 86_400_000, { activation: 1, owner: 1 })).toBe(true);
  });

  it('waits for sources without consuming retry attempts and eventually expires', () => {
    accept();
    let claim = repository.claimNext('worker', 1000)!;
    for (let index = 0; index < 5; index += 1) {
      const now = 1000 + index * 60_000;
      expect(repository.deferRun(claim, now, 'source_not_ready', now + 60_000)).toBe('deferred');
      claim = repository.claimNext('worker', now + 60_000)!;
      expect(claim.attempt).toBe(1);
    }
    repository.deferRun(claim, 301_000, 'source_not_ready', 86_401_000);
    claim = repository.claimNext('worker', 86_401_000)!;
    expect(repository.deferRun(claim, 86_401_000, 'source_not_ready', 86_461_000)).toBe('failed');
    expect(db.prepare('SELECT reason FROM scene_runs').get()?.reason).toBe('source_wait_expired');
    expect(repository.claimNext('worker', 86_461_000)).toBeNull();
  });

  it('counts owner budgets across workspaces without charging a different owner', () => {
    accept();
    const first = repository.claimNext('worker', 1000)!;
    repository.reserveModelCall(first, 1000, { activation: 10, owner: 1 });
    repository.finishReadOnlyRun(first, outcome, 1001);
    for (const ownerId of [principal.ownerId, 'different-owner']) {
      const other = { ownerId, workspaceId: 'other-workspace' };
      const activation = repository.createActivation(other, { templateKey: manifest.key, templateVersion: manifest.version,
        goal: 'Another follow-up', scope: { kind: 'personal' }, permissions: { accountIds: [], contextProviders: [], effectHandlers: [] } });
      repository.transitionActivation(other, activation.id, 1, 'active');
      repository.acceptTrigger(other, activation.id, { event, triggerKey: 'check', occurrenceKey: 'one', dueAt: 1002 }, 1002);
      const claim = repository.claimNext('worker', 1002)!;
      expect(repository.reserveModelCall(claim, 1002, { activation: 10, owner: 1 })).toBe(ownerId !== principal.ownerId);
      repository.failRun(claim, 1003, 'test_finished');
    }
  });

  it('recovers a deferred third attempt instead of leaving it stuck forever', () => {
    accept();
    repository.claimNext('worker', 1000, 100);
    repository.claimNext('worker', 1100, 100);
    const third = repository.claimNext('worker', 1200, 100)!;
    expect(third.attempt).toBe(3);
    repository.deferRun(third, 1201, 'source_not_ready', 2000);
    const resumed = repository.claimNext('worker', 2000)!;
    expect(resumed.attempt).toBe(3);
    expect(repository.finishReadOnlyRun(resumed, outcome, 2001)).toBe(true);
  });

  it('requeues a cancelled deadline when its activation resumes', () => {
    repository.createWorkItem(principal, activationId, { subjectId: 'thread:1', accountId: 'personal', dueAt: 2000 }, 1000);
    repository.enqueueDueWorkItems(2000);
    const old = repository.claimNext('worker', 2000)!;
    repository.transitionActivation(principal, activationId, 2, 'paused');
    repository.transitionActivation(principal, activationId, 3, 'active');
    expect(repository.enqueueDueWorkItems(2100)).toBe(1);
    const resumed = repository.claimNext('worker', 2100)!;
    expect(resumed.intentId).not.toBe(old.intentId);
    expect(repository.finishReadOnlyRun(old, outcome, 2101)).toBe(false);
    expect(repository.finishReadOnlyRun(resumed, outcome, 2101)).toBe(true);
    expect(repository.enqueueDueWorkItems(2102)).toBe(0);
  });
});
