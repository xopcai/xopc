import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../storage/sqlite/index.js';
import { getSqliteDatabase } from '../../storage/sqlite/transaction.js';
import { ProactiveInboxService } from '../inbox/service.js';
import { ProactiveInboxWorker } from '../inbox/worker.js';

describe('proactive inbox', () => {
  let stateDir: string;
  let inbox: ProactiveInboxService;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-proactive-inbox-'));
    resetXopcDatabaseSingletonForTest(); openXopcDatabase({ path: join(stateDir, 'xopc.db') });
    inbox = new ProactiveInboxService();
    const db = getSqliteDatabase();
    db.prepare(`INSERT INTO proactive_signal_batches
      (batch_id, subscription_id, scenario_key, scenario_version, aggregation_key, window_started_at, window_ends_at, ready_at, status, event_count, created_at, updated_at)
      VALUES ('batch', 'default-blocked-work', 'blocked_work', 1, 'workspace:default', '2026-08-13T00:00:00.000Z', '2026-08-13T00:01:00.000Z', '2026-08-13T00:01:00.000Z', 'processed', 1, '2026-08-13T00:00:00.000Z', '2026-08-13T00:00:00.000Z')`).run();
    db.prepare(`INSERT INTO proactive_runs
      (run_id, batch_id, subscription_id, scenario_key, scenario_version, status, attempt, started_at, completed_at, updated_at)
      VALUES ('run', 'batch', 'default-blocked-work', 'blocked_work', 1, 'completed', 1, '2026-08-13T00:00:00.000Z', '2026-08-13T00:00:01.000Z', '2026-08-13T00:00:01.000Z')`).run();
    db.prepare(`INSERT INTO proactive_insights
      (insight_id, run_id, subscription_id, scenario_key, title, summary, why_now, impact, recommendation, decision_json, urgency, confidence, value_score, evidence_ids_json, created_at)
      VALUES ('insight', 'run', 'default-blocked-work', 'blocked_work', 'Needs a decision', 'Blocked', 'Changed now', 'Delivery risk', 'Choose owner',
        '{"question":"Who should own this?","options":[{"id":"assign-alice","label":"Assign Alice","consequence":"Alice owns the blocker"},{"id":"assign-bob","label":"Assign Bob","consequence":"Bob owns the blocker"}]}',
        'high', .9, .85, '["event"]', '2026-08-13T00:00:01.000Z')`).run();
  });

  afterEach(() => { closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); rmSync(stateDir, { recursive: true, force: true }); });

  it('projects once, delivers durably, and captures the user decision', async () => {
    const deliver = vi.fn(async () => {});
    const worker = new ProactiveInboxWorker({ deliver });
    await worker.tick();
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(inbox.list()).toHaveLength(1);
    await worker.tick();
    expect(deliver).toHaveBeenCalledTimes(1);
    const item = inbox.list()[0]!;
    expect(inbox.transition(item.id, { status: 'read' }).status).toBe('read');
    const instruction = inbox.instruct(item.id, 'Only notify me when delivery is at risk.');
    expect(instruction.revisionId).toBeTruthy();
    expect(getSqliteDatabase().prepare('SELECT user_instructions, status FROM proactive_prompt_revisions WHERE revision_id = ?')
      .get(instruction.revisionId)).toMatchObject({ status: 'published', user_instructions: expect.stringContaining('Only notify me') });
    expect(() => inbox.decide(item.id, 'unknown')).toThrow('valid decision option');
    expect(inbox.decide(item.id, 'assign-alice', 'Owner agreed').status).toBe('resolved');
    inbox.feedback(item.id, 'useful');
  });

  it('wakes snoozed items only through explicit maintenance', () => {
    inbox.project(new Date('2026-08-13T00:00:02.000Z'));
    const item = inbox.list()[0]!;
    inbox.transition(item.id, { status: 'snoozed', snoozedUntil: '2026-08-13T01:00:00.000Z' });
    expect(inbox.wakeSnoozed(new Date('2026-08-13T00:30:00.000Z'))).toBe(0);
    expect(inbox.wakeSnoozed(new Date('2026-08-13T01:00:00.000Z'))).toBe(1);
    expect(inbox.list()[0]?.status).toBe('unread');
  });
});
