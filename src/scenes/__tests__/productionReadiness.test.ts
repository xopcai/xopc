import { DatabaseSync } from 'node:sqlite';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installSceneStorage } from '../../storage/sqlite/scenes-schema.js';
import { SceneExecutionService } from '../execution.js';
import { SceneCapabilityRegistry } from '../registry.js';
import { SceneInboxService } from '../inbox.js';
import { SceneMailObservationService } from '../mailObservations.js';
import { SceneMetrics } from '../metrics.js';
import { sceneNotificationEligibility } from '../notificationEligibility.js';
import { ScenePreferenceService } from '../preferences.js';
import { sceneSourceFailureReason } from '../readiness.js';
import { SceneRepository } from '../repository.js';
import { familyPlanTemplate, mailFollowUpTemplate } from '../templates.js';

describe('production readiness regressions', () => {
  let db: DatabaseSync;
  let repository: SceneRepository;
  let now: number;
  let id: string;
  const principal = { ownerId: 'owner', workspaceId: 'workspace' };
  const permissions = { accountIds: ['gmail'], contextProviders: ['mail'], effectHandlers: [] };
  const evidence = { ...principal, id: 'message', subjectId: 'thread', accountId: 'gmail', revision: '1', freshUntil: 9e15, content: 'Please reply.' };
  const read = vi.fn(async () => [evidence]);
  const execute = vi.fn(async () => ({ kind: 'artifact', summary: 'Suggested reply', evidenceIds: ['message'] }));
  const service = () => new SceneExecutionService(repository, new SceneCapabilityRegistry([{ id: 'mail', read }]), { execute }, async () => permissions, () => now);
  const check = async () => {
    now += 1;
    repository.acceptManualCheck(principal, id, 'check', String(now), now);
    return service().runNext('test');
  };
  beforeEach(() => {
    now = Date.now();
    db = new DatabaseSync(':memory:'); db.exec('PRAGMA foreign_keys = ON'); installSceneStorage(db);
    repository = new SceneRepository(db); repository.installTemplate(mailFollowUpTemplate);
    const activation = repository.createActivation(principal, { templateKey: mailFollowUpTemplate.key, templateVersion: mailFollowUpTemplate.version,
      goal: 'Follow up', scope: { kind: 'objects', ids: ['thread'] }, permissions });
    id = activation.id; repository.transitionActivation(principal, id, 1, 'active', now);
    read.mockReset().mockResolvedValue([evidence]); execute.mockClear();
  });
  afterEach(() => db.close());

  it.each([
    [new Error('Request failed: HTTP 429'), 'source_rate_limited'],
    [new Error('Mail item timed out'), 'source_timeout'],
    [{ statusCode: 403 }, 'needs_permission'],
    ['invalid_grant', 'needs_permission'],
  ])('classifies provider failures without exposing raw details', (error, reason) => {
    expect(sceneSourceFailureReason(error)).toBe(reason);
  });

  it('preserves the result, read state, feedback and notification identity on a new unchanged manual check', async () => {
    await check();
    const original = repository.listInbox(principal)[0];
    const inbox = new SceneInboxService(db, () => now);
    inbox.setRead(principal, original.id, true);
    inbox.feedback(principal, original.id, { expectedRevision: 0, rating: 'useful' });
    expect(await check()).toBe('completed');
    expect(execute).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledTimes(4);
    expect(repository.listInbox(principal)).toMatchObject([{ id: original.id, status: 'read' }]);
    expect(inbox.getFeedback(principal, original.id)).toMatchObject({ rating: 'useful', revision: 1 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM notification_result_outbox').get()?.n).toBe(1);
    expect(db.prepare("SELECT reason FROM scene_runs WHERE status = 'skipped'").get()?.reason).toBe('unchanged_result');
    read.mockResolvedValue([{ ...evidence, revision: '2', content: 'New reply received' }]);
    await check();
    expect(execute).toHaveBeenCalledTimes(2);
    expect(repository.listInbox(principal)[0].id).not.toBe(original.id);
  });

  it('still runs a new scheduled cycle even when its context matches the last result', async () => {
    await check();
    repository.acceptTrigger(principal, id, { triggerKey: 'check', occurrenceKey: 'next-cycle', dueAt: now,
      event: { source: 'schedule', sourceEventId: 'next-cycle', subjectId: 'thread', accountId: 'gmail', eventType: 'scene.schedule.due', occurredAt: now } }, now);
    await service().runNext('test');
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('persists a source outage, marks the old result uncertain, defers its notification and clears health on recovery', async () => {
    repository.createWorkItem(principal, id, { subjectId: 'thread', accountId: 'gmail', dueAt: now + 1000 }, now);
    await check();
    const original = repository.listInbox(principal)[0];
    const observer = () => new SceneMailObservationService(new SceneRepository(db), { id: 'mail', read }, async () => permissions, () => now);
    read.mockRejectedValueOnce(Object.assign(new Error('private provider error'), { status: 401 }));
    expect(await observer().scan(new AbortController().signal)).toMatchObject({ unavailable: 1 });
    expect(repository.getSourceHealth(id)).toMatchObject({ reason: 'needs_permission', consecutiveFailures: 1, retryAt: now + 60000 });
    expect(repository.getPresentation(principal, original.id).sourceHealth?.reason).toBe('needs_permission');
    const result = { ...principal, id: original.id, subjectId: original.id };
    expect(sceneNotificationEligibility(db, result, now).action).toBe('defer');
    expect(new SceneMetrics(db, () => now).diagnostics(principal).activations[0].source_reason).toBe('needs_permission');
    expect(JSON.stringify(repository.getSourceHealth(id))).not.toContain('private');
    await observer().scan(new AbortController().signal);
    expect(repository.getSourceHealth(id)).toMatchObject({ reason: null, consecutiveFailures: 0, lastSuccessAt: now });
    expect(sceneNotificationEligibility(db, result, now).action).toBe('eligible');
  });

  it('shows setup requirements and removes fired or paused deadlines from upcoming checks', () => {
    expect(repository.getActivation(principal, id).setupMissing).toEqual(['deadline']);
    repository.createWorkItem(principal, id, { subjectId: 'thread', accountId: 'gmail', dueAt: now + 1000 }, now);
    expect(repository.getActivation(principal, id).setupMissing).toEqual([]);
    const metrics = new SceneMetrics(db, () => now);
    expect(metrics.diagnostics(principal).activations[0].next_deadline_check_at).toBe(now + 1000);
    now += 1001; repository.enqueueDueWorkItems(now);
    expect(metrics.diagnostics(principal).activations[0]).toMatchObject({ next_deadline_check_at: null, deadline_at: now - 1 });
    const activation = repository.getActivation(principal, id);
    repository.transitionActivation(principal, id, activation.revision, 'paused', now);
    expect(metrics.diagnostics(principal).activations[0]).toMatchObject({ next_schedule_at: null, next_deadline_check_at: null });
  });

  it('requires family notes and a schedule, and respects the global pause in diagnostics', () => {
    repository.installTemplate(familyPlanTemplate);
    const family = repository.createActivation(principal, { templateKey: familyPlanTemplate.key, templateVersion: familyPlanTemplate.version,
      goal: 'Arrange the week', scope: { kind: 'personal' }, permissions: { accountIds: [], contextProviders: ['user_notes'], effectHandlers: [] } });
    repository.transitionActivation(principal, family.id, 1, 'active', now);
    expect(repository.getActivation(principal, family.id).setupMissing).toEqual(['notes', 'schedule']);
    repository.writeNotes(principal, family.id, { content: 'Sunday is free', expectedRevision: 0, validUntil: null }, now);
    repository.setSchedule(principal, family.id, 'weekly-review', 0, { weekdays: [0], hour: 9, minute: 0, timeZone: 'UTC' }, now);
    expect(repository.getActivation(principal, family.id).setupMissing).toEqual([]);
    new ScenePreferenceService(db).update(principal, { expectedRevision: 0, checksPaused: true });
    expect(new SceneMetrics(db, () => now).diagnostics(principal).activations.every(row => row.next_schedule_at === null)).toBe(true);
  });

  it('exposes a readable scoped source and generation time instead of only citation identifiers', async () => {
    db.prepare('INSERT INTO scene_mail_sources VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('thread', principal.ownerId, principal.workspaceId, 'gmail', 'abc123', 'Meeting time', 'Alice', now);
    await check();
    const result = repository.listInbox(principal)[0];
    expect(result.createdAt).toBe(now);
    expect(result.sources).toEqual([{ kind: 'mail', title: 'Meeting time', sender: 'Alice', href: 'https://mail.google.com/mail/#all/abc123' }]);
    expect(() => repository.getPresentation({ ...principal, ownerId: 'someone-else' }, result.id)).toThrow();
  });
});
