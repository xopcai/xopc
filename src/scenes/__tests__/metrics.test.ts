import { DatabaseSync } from 'node:sqlite';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SceneInboxService } from '../inbox.js';
import { SceneMetrics } from '../metrics.js';
import { SceneRepository } from '../repository.js';
import { installSceneStorage } from '../../storage/sqlite/scenes-schema.js';
import { familyPlanTemplate } from '../templates.js';

describe('scene usefulness metrics and feedback evidence', () => {
  let db: DatabaseSync;
  let repository: SceneRepository;
  let inbox: SceneInboxService;
  let metrics: SceneMetrics;
  let presentationId: string;
  const principal = { ownerId: 'owner', workspaceId: 'workspace' };
  let now: number;
  beforeEach(() => {
    now = Date.parse('2026-09-20T10:00:00Z');
    db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON');
    installSceneStorage(db);

    repository = new SceneRepository(db);
    inbox = new SceneInboxService(db, () => now);
    metrics = new SceneMetrics(db, () => now + 1);
    repository.installTemplate(familyPlanTemplate);
    const activation = repository.createActivation(principal, { templateKey: familyPlanTemplate.key, templateVersion: familyPlanTemplate.version,
      goal: 'Make time for rest', scope: { kind: 'personal' }, permissions: { accountIds: [], contextProviders: ['user_notes'], effectHandlers: [] } });
    repository.transitionActivation(principal, activation.id, 1, 'active');
    repository.acceptManualCheck(principal, activation.id, 'check', 'one', now);
    repository.finishReadOnlyRun(repository.claimNext('test', now)!, { kind: 'artifact', summary: 'Keep Sunday free', evidenceIds: ['notes'] }, now);
    presentationId = repository.listInbox(principal)[0].id;
  });
  afterEach(() => db.close());

  it('does not count a completed check or read card as useful work', () => {
    inbox.setRead(principal, presentationId, true);
    expect(metrics.forUser(principal)).toMatchObject({ checks: 1, ratedOutcomes: 0, usefulOutcomes: 0, scenesWithUsefulOutcomes: 0 });
  });

  it('preserves corrections while counting only the latest explicit judgment', () => {
    inbox.feedback(principal, presentationId, { expectedRevision: 0, rating: 'useful', note: 'Private feedback' });
    expect(metrics.forUser(principal)).toMatchObject({ ratedOutcomes: 1, usefulOutcomes: 1, scenesWithUsefulOutcomes: 1 });
    now += 1;
    inbox.feedback(principal, presentationId, { expectedRevision: 1, rating: 'not_useful' });
    const result = metrics.forUser(principal);
    expect(result).toMatchObject({ ratedOutcomes: 1, usefulOutcomes: 0, unhelpfulOutcomes: 1, scenesWithUsefulOutcomes: 0 });
    expect(JSON.stringify(result)).not.toContain('Private');
    expect(db.prepare('SELECT rating, revision FROM scene_feedback_history ORDER BY revision').all())
      .toMatchObject([{ rating: 'useful', revision: 1 }, { rating: 'not_useful', revision: 2 }]);
  });

  it('does not duplicate evidence when a stale feedback write is retried', () => {
    inbox.feedback(principal, presentationId, { expectedRevision: 0, rating: 'useful' });
    expect(() => inbox.feedback(principal, presentationId, { expectedRevision: 0, rating: 'useful' })).toThrow('changed');
    expect(db.prepare('SELECT count(*) AS n FROM scene_feedback_history').get()?.n).toBe(1);
  });

  it('rolls back the current rating if appending its evidence fails', () => {
    db.exec("CREATE TRIGGER fail_feedback BEFORE INSERT ON scene_feedback_history BEGIN SELECT RAISE(ABORT, 'Injected failure'); END");
    expect(() => inbox.feedback(principal, presentationId, { expectedRevision: 0, rating: 'useful' })).toThrow('Injected failure');
    expect(inbox.getFeedback(principal, presentationId)).toBeNull();
    expect(metrics.forUser(principal).ratedOutcomes).toBe(0);
  });

  it('bounds the rolling window and does not expose invalid or future data', () => {
    inbox.feedback(principal, presentationId, { expectedRevision: 0, rating: 'useful' });
    now += 8 * 86_400_000;
    expect(metrics.forUser(principal).ratedOutcomes).toBe(0);
    expect(metrics.forUser(principal, 30).ratedOutcomes).toBe(1);
    for (const days of [0, 91, 1.5, NaN]) expect(() => metrics.forUser(principal, days)).toThrow('window');
    expect(() => metrics.forUser({ ownerId: '', workspaceId: 'workspace' })).toThrow('principal');
  });
});
