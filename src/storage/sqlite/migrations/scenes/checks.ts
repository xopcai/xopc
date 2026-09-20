import type { DatabaseSync } from 'node:sqlite';

import { z } from 'zod';

import { resolveSceneCutoverBindings, type SceneCutoverBindings } from './bindings.js';

const id = z.string().min(1);
const time = z.string().datetime({ offset: true }).transform((value) => Date.parse(value)).pipe(z.number().int().nonnegative());
const checkSchema = z.strictObject({
  id, workspace_id: id, started_at: time, completed_at: time.nullable(),
  status: z.enum(['blocked', 'empty_checklist', 'failed', 'cancelled', 'no_change', 'prepared', 'interrupted']),
  detail: z.string().nullable(), content: z.string().nullable(), target: z.string().nullable(), chat_id: z.string().nullable(),
  fingerprint: z.string().nullable(), delivery_status: z.enum(['none', 'no_target', 'duplicate', 'expired', 'cancelled']),
  next_attempt_at: time.nullable(), expires_at: time,
});

/** Imports completed checks as history, not events, approvals, notifications or future work. */
export function convertSceneChecks(db: DatabaseSync, input: { owners: SceneCutoverBindings; activations: unknown }) {
  const owners = new Map(resolveSceneCutoverBindings(db, input.owners).map((row) => [row.workspaceId, row.ownerId]));
  const bindings = z.array(z.strictObject({ workspaceId: id, activationId: id })).max(10_000)
    .refine((rows) => new Set(rows.map((row) => row.workspaceId)).size === rows.length
      && new Set(rows.map((row) => row.activationId)).size === rows.length).parse(input.activations);
  const targets = new Map(bindings.map((row) => [row.workspaceId, row.activationId]));
  const source = db.prepare('SELECT * FROM heartbeat_checks LIMIT 100001').all();
  if (source.length > 100_000) throw new Error('Check conversion exceeds reviewed limit');
  const checks = source.map((row) => checkSchema.parse(row));
  if (checks.some((row) => !targets.has(row.workspace_id))) throw new Error('Every check workspace requires an activation binding');
  db.exec('SAVEPOINT scene_check_conversion');
  try {
    for (const { workspaceId, activationId } of bindings) {
      const activation = db.prepare('SELECT owner_id, workspace_id, status FROM scene_activations WHERE id = ?').get(activationId);
      if (!activation || activation.owner_id !== owners.get(workspaceId) || activation.workspace_id !== workspaceId) throw new Error('Check history binding crosses ownership');
      if (activation.status === 'active') throw new Error('Check history requires an inactive activation');
    }
    for (const check of checks) {
      const activationId = targets.get(check.workspace_id)!;
      const activation = db.prepare('SELECT revision FROM scene_activations WHERE id = ?').get(activationId)!;
      const intentId = `check:${check.id}`;
      const status = check.status === 'prepared' ? 'succeeded' : check.status === 'failed' ? 'failed'
        : ['cancelled', 'interrupted'].includes(check.status) ? 'cancelled' : 'skipped';
      db.prepare(`INSERT INTO scene_trigger_intents
        (id, activation_id, activation_revision, trigger_key, occurrence_key, event_id, due_at, status)
        VALUES (?, ?, ?, 'historical_check', ?, NULL, ?, ?)`)
        .run(intentId, activationId, activation.revision, check.id, check.started_at, status === 'cancelled' ? 'cancelled' : 'resolved');
      db.prepare(`INSERT INTO scene_runs(id, origin, intent_id, activation_id, activation_revision, status, attempt, lease_epoch, reason, created_at)
        VALUES (?, 'import', ?, ?, ?, ?, 1, 1, ?, ?)`)
        .run(check.id, intentId, activationId, activation.revision, status, check.status, check.started_at);
      db.prepare('INSERT INTO scene_check_details VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(check.id, check.id, check.workspace_id, check.status, check.completed_at, check.detail, check.content,
          check.target, check.chat_id, check.fingerprint, check.delivery_status, check.next_attempt_at, check.expires_at);
    }
    if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Check conversion broke foreign keys');
    db.exec('RELEASE scene_check_conversion');
    return { checks: checks.length };
  } catch (error) {
    db.exec('ROLLBACK TO scene_check_conversion'); db.exec('RELEASE scene_check_conversion'); throw error;
  }
}
