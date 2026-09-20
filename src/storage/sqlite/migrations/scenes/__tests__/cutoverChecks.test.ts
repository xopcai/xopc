import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { installSceneSchema } from '../schema.js';
import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../../index.js';
import { getSqliteDatabase } from '../../../transaction.js';
import { convertSceneChecks } from '../checks.js';
import { assertSceneHistoryIntegrity } from '../integrity.js';
import { SceneRepository } from '../../../../../scenes/repository.js';
import { familyPlanTemplate } from '../../../../../scenes/templates.js';
import { SceneMetrics } from '../../../../../scenes/metrics.js';

describe('historical checklist conversion', () => {
  let directory: string;
  let db: DatabaseSync;
  let activationId: string;
  const principal = { ownerId: 'owner', workspaceId: 'workspace' };
  const timestamp = '2026-09-20T10:00:00Z';
  const now = Date.parse(timestamp);
  const convert = () => convertSceneChecks(db, { owners: [principal], activations: [{ workspaceId: 'workspace', activationId }] });
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'xopc-check-conversion-'));
    resetXopcDatabaseSingletonForTest(); openXopcDatabase({ path: join(directory, 'xopc.db') }); db = getSqliteDatabase();
    installSceneSchema(db);
    const repository = new SceneRepository(db); repository.installTemplate(familyPlanTemplate);
    activationId = repository.createActivation(principal, { templateKey: familyPlanTemplate.key, templateVersion: familyPlanTemplate.version,
      goal: 'Private checklist', scope: { kind: 'personal' }, permissions: { accountIds: [], contextProviders: [], effectHandlers: [] } }).id;
    db.prepare(`INSERT INTO heartbeat_checks(id, workspace_id, started_at, completed_at, status, detail, content,
      target, chat_id, fingerprint, delivery_status, next_attempt_at, expires_at)
      VALUES ('check', 'workspace', ?, ?, 'prepared', 'Original detail', 'Private content', 'telegram', '123', 'fingerprint', 'cancelled', ?, ?)`)
      .run(timestamp, timestamp, timestamp, '2026-09-21T10:00:00Z');
  });
  afterEach(() => { closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); rmSync(directory, { recursive: true, force: true }); });

  it('keeps content and delivery audit linked to an imported run without creating new work', () => {
    expect(convert()).toEqual({ checks: 1 });
    expect(db.prepare('SELECT * FROM scene_runs').get()).toMatchObject({ id: 'check', origin: 'import', status: 'succeeded', activation_id: activationId, created_at: now });
    expect(db.prepare('SELECT * FROM scene_check_details').get()).toMatchObject({ source_check_id: 'check', content: 'Private content', detail: 'Original detail', delivery_status: 'cancelled', chat_id: '123', fingerprint: 'fingerprint', completed_at: now, next_attempt_at: now });
    expect(() => assertSceneHistoryIntegrity(db)).not.toThrow();
    const repository = new SceneRepository(db);
    expect(repository.claimNext('worker', now)).toBeNull();
    expect(new SceneMetrics(db, () => now).forUser(principal).checks).toBe(0);
    expect(db.prepare('SELECT * FROM scene_events').all()).toEqual([]);
    expect(db.prepare('SELECT * FROM scene_presentations').all()).toEqual([]);
    expect(repository.getActivation(principal, activationId).status).toBe('needs_setup');
    expect(db.prepare('SELECT count(*) AS n FROM heartbeat_checks').get()?.n).toBe(1);
  });

  it.each(['pending', 'sending', 'queued', 'unknown'])('requires reconciliation for a %s handoff', (status) => {
    db.prepare('UPDATE heartbeat_checks SET delivery_status = ?').run(status);
    expect(convert).toThrow(); expect(db.prepare('SELECT * FROM scene_runs').all()).toEqual([]);
  });

  it.each([
    "UPDATE heartbeat_checks SET status = 'running'",
    "UPDATE heartbeat_checks SET started_at = '2026-02-30T00:00:00Z'",
    "UPDATE scene_activations SET status = 'active'",
    "UPDATE scene_activations SET owner_id = 'other'",
  ])('rejects invalid history or bindings: %s', (sql) => {
    db.exec(sql); expect(convert).toThrow(); expect(db.prepare('SELECT * FROM scene_runs').all()).toEqual([]);
  });

  it('supports outer rollback and refuses duplicate import', () => {
    db.exec('BEGIN'); convert(); db.exec('ROLLBACK');
    expect(db.prepare('SELECT * FROM scene_check_details').all()).toEqual([]);
    convert(); expect(convert).toThrow();
    expect(db.prepare('SELECT count(*) AS n FROM scene_runs').get()?.n).toBe(1);
    db.exec("UPDATE scene_check_details SET source_workspace_id = 'other'");
    expect(() => assertSceneHistoryIntegrity(db)).toThrow('check_identity');
  });
});
