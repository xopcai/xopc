import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SceneRepository } from '../repository.js';

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
    db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
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
    expect(repository.listInbox(principal)).toHaveLength(1);
  });
});
