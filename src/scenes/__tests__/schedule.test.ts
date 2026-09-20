import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SceneRepository } from '../repository.js';
import { nextSceneScheduleAt } from '../schedule.js';
import { familyPlanTemplate } from '../templates.js';

const weekly = { weekdays: [0], hour: 9, minute: 0, timeZone: 'America/New_York' };
const timestamp = (value: string) => Date.parse(value);

describe('local scene schedules', () => {
  it('keeps local wall time across daylight saving changes', () => {
    expect(nextSceneScheduleAt(weekly, timestamp('2026-03-01T15:00:00Z'))).toBe(timestamp('2026-03-08T13:00:00Z'));
    expect(nextSceneScheduleAt(weekly, timestamp('2026-10-25T15:00:00Z'))).toBe(timestamp('2026-11-01T14:00:00Z'));
  });
  it('uses a strictly later occurrence and rejects invalid schedules', () => {
    expect(nextSceneScheduleAt(weekly, timestamp('2026-03-08T13:00:00Z'))).toBe(timestamp('2026-03-15T13:00:00Z'));
    for (const value of [{ ...weekly, timeZone: 'invalid' }, { ...weekly, weekdays: [0, 0] }, { ...weekly, hour: 24 }, { ...weekly, expr: '* * * * *' }]) {
      expect(() => nextSceneScheduleAt(value, 1000)).toThrow();
    }
  });
  it('moves nonexistent local times to the next valid minute and does not repeat the fall-back occurrence', () => {
    expect(nextSceneScheduleAt({ ...weekly, hour: 2, minute: 30 }, timestamp('2026-03-07T15:00:00Z')))
      .toBe(timestamp('2026-03-08T07:00:00Z'));
    const repeated = { ...weekly, hour: 1, minute: 30 };
    expect(nextSceneScheduleAt(repeated, timestamp('2026-10-31T15:00:00Z'))).toBe(timestamp('2026-11-01T05:30:00Z'));
    expect(nextSceneScheduleAt(repeated, timestamp('2026-11-01T05:30:00Z'))).toBe(timestamp('2026-11-08T06:30:00Z'));
  });
  it('handles half-hour spring gaps without assuming a one-hour offset', () => {
    expect(nextSceneScheduleAt({ weekdays: [0], hour: 2, minute: 15, timeZone: 'Australia/Lord_Howe' }, timestamp('2026-10-03T00:00:00Z')))
      .toBe(timestamp('2026-10-03T15:30:00Z'));
  });
});

describe('durable scene schedule cursors', () => {
  let db: DatabaseSync;
  let repository: SceneRepository;
  let activationId: string;
  const principal = { ownerId: 'owner', workspaceId: 'workspace' };
  const start = timestamp('2026-03-01T15:00:00Z');
  const due = timestamp('2026-03-08T13:00:00Z');
  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON');
    db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
    repository = new SceneRepository(db);
    repository.installTemplate(familyPlanTemplate);
    const activation = repository.createActivation(principal, {
      templateKey: familyPlanTemplate.key, templateVersion: familyPlanTemplate.version, goal: 'Prepare next week', scope: { kind: 'personal' },
      permissions: { accountIds: [], contextProviders: ['user_notes'], effectHandlers: [] },
    });
    activationId = activation.id;
    repository.transitionActivation(principal, activationId, 1, 'active', start);
  });
  afterEach(() => db.close());
  const configure = () => repository.setSchedule(principal, activationId, 'weekly-review', 0, weekly, start);

  it('publishes once and persists a future cursor independently of the worker', () => {
    configure();
    expect(repository.enqueueDueSchedules(due - 1)).toBe(0);
    expect(repository.enqueueDueSchedules(due)).toBe(1);
    repository = new SceneRepository(db);
    expect(repository.enqueueDueSchedules(due)).toBe(0);
    expect(db.prepare('SELECT occurred_at FROM scene_events').get()?.occurred_at).toBe(due);
    expect(db.prepare('SELECT next_due_at FROM scene_schedule_cursors').get()?.next_due_at).toBe(timestamp('2026-03-15T13:00:00Z'));
    expect(repository.claimNext('worker', due)).not.toBeNull();
  });
  it('requires ownership, a registered schedule trigger and current revision', () => {
    expect(() => repository.setSchedule({ ...principal, ownerId: 'other' }, activationId, 'weekly-review', 0, weekly, start)).toThrow('not found');
    expect(() => repository.setSchedule(principal, activationId, 'check', 0, weekly, start)).toThrow('Unknown');
    configure();
    expect(() => configure()).toThrow('changed');
    expect(repository.setSchedule(principal, activationId, 'weekly-review', 1, { ...weekly, hour: 10 }, start)).toBe(2);
  });
  it('cancels already claimed schedule work when the user changes its time', () => {
    configure();
    repository.enqueueDueSchedules(due);
    const claim = repository.claimNext('worker', due)!;
    repository.setSchedule(principal, activationId, 'weekly-review', 1, { ...weekly, hour: 10 }, due);
    expect(repository.getRunInput(claim, due)).toBeNull();
  });
  it('does not replay missed occurrences after a pause and resume', () => {
    configure();
    repository.transitionActivation(principal, activationId, 2, 'paused', start);
    expect(repository.enqueueDueSchedules(due)).toBe(0);
    repository.transitionActivation(principal, activationId, 3, 'active', due + 1000);
    expect(repository.enqueueDueSchedules(due + 1000)).toBe(0);
    expect(db.prepare('SELECT revision FROM scene_schedule_cursors').get()?.revision).toBe(2);
  });
  it('bounds catch-up to 24 hours and never enqueues a backlog', () => {
    configure();
    expect(repository.enqueueDueSchedules(due + 1000)).toBe(1);
    expect(repository.enqueueDueSchedules(due + 30 * 86_400_000)).toBe(0);
    expect(db.prepare('SELECT count(*) AS n FROM scene_events').get()?.n).toBe(1);
    expect(Number(db.prepare('SELECT next_due_at FROM scene_schedule_cursors').get()?.next_due_at)).toBeGreaterThan(due + 30 * 86_400_000);
  });
  it('rolls back cursor progress and events with the enclosing transaction', () => {
    configure();
    db.exec('BEGIN');
    expect(repository.enqueueDueSchedules(due)).toBe(1);
    db.exec('ROLLBACK');
    expect(repository.enqueueDueSchedules(due)).toBe(1);
  });
});
