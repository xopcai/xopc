import type { DatabaseSync } from 'node:sqlite';

import { z } from 'zod';

import { sceneContentHash } from './targetContract.js';
import { resolveSceneCutoverBindings, type SceneCutoverBindings } from './bindings.js';

const id = z.string().min(1);
const time = z.string().datetime({ offset: true }).transform((value) => Date.parse(value))
  .pipe(z.number().int().nonnegative());
const json = z.string().transform((value) => JSON.parse(value) as unknown)
  .transform((value) => { sceneContentHash(value); return JSON.stringify(value); });
const evidence = z.string().transform((value) => JSON.parse(value) as unknown)
  .pipe(z.array(id)).transform((value) => JSON.stringify(value));
const eventSchema = z.strictObject({
  event_id: id, type: id, schema_version: z.number().int().positive(), source_kind: id, source_id: id,
  device_id: z.string().nullable(), subject_kind: id, subject_id: id,
  actor_kind: z.enum(['user', 'agent', 'system', 'integration']), actor_id: z.string().nullable(),
  workspace_id: id, project_id: z.string().nullable(), agent_id: z.string().nullable(),
  occurred_at: time, observed_at: time, correlation_id: id, causation_id: z.string().nullable(), dedupe_key: id,
  sensitivity: z.enum(['public', 'personal', 'confidential', 'restricted']), payload_json: json, routed_at: time.nullable(),
});
const batchSchema = z.strictObject({
  batch_id: id, subscription_id: id, scenario_key: id, scenario_version: z.number().int().positive(),
  aggregation_key: id, window_started_at: time, window_ends_at: time, ready_at: time,
  status: z.enum(['collecting', 'ready', 'processing', 'processed', 'ignored', 'failed_retryable', 'failed_permanent', 'expired']),
  event_count: z.number().int().nonnegative(), created_at: time, updated_at: time,
});
const runSchema = z.strictObject({
  run_id: id, batch_id: id, subscription_id: id, scenario_key: id, scenario_version: z.number().int().positive(),
  prompt_revision_id: id.nullable(), context_snapshot_id: id.nullable(),
  status: z.enum(['running', 'completed', 'discarded', 'retryable', 'failed']), attempt: z.number().int().positive(),
  lease_owner: z.string().nullable(), lease_expires_at: time.nullable(), model_ref: z.string().nullable(),
  raw_output: z.string().nullable(), error_message: z.string().nullable(), next_attempt_at: time.nullable(),
  started_at: time, completed_at: time.nullable(), updated_at: time, outcome_reason: z.string().nullable(),
  policy_revision: z.number().int().nonnegative(), subscription_revision: z.number().int().nonnegative(),
  policy_snapshot_json: json.nullable(), input_tokens: z.number().int().nonnegative().nullable(),
  output_tokens: z.number().int().nonnegative().nullable(), estimated_cost_usd: z.number().finite().nonnegative().nullable(),
});
const bindingSchema = z.array(z.strictObject({ batchId: id, activationId: id }))
  .max(100_000)
  .refine((rows) => new Set(rows.map((row) => row.batchId)).size === rows.length, 'Duplicate batch binding');

/** Converts execution history without scheduling work, reading connectors or interpreting old prompts. */
export function convertSceneExecutionHistory(db: DatabaseSync, input: { owners: SceneCutoverBindings; batches: unknown }) {
  const owners = new Map(resolveSceneCutoverBindings(db, input.owners).map((row) => [row.workspaceId, row.ownerId]));
  const bindings = new Map(bindingSchema.parse(input.batches).map((row) => [row.batchId, row.activationId]));
  const read = <T>(table: string, schema: z.ZodType<T>): T[] => {
    const rows = db.prepare(`SELECT * FROM ${table} LIMIT 100001`).all();
    if (rows.length > 100_000) throw new Error(`Execution conversion exceeds reviewed limit: ${table}`);
    return rows.map((row) => schema.parse(row));
  };
  const events = read('proactive_events', eventSchema);
  const batches = read('proactive_signal_batches', batchSchema);
  const members = read('proactive_batch_events', z.strictObject({ batch_id: id, event_id: id, added_at: time }));
  const snapshots = read('proactive_context_snapshots', z.strictObject({ snapshot_id: id, batch_id: id, content_json: json, evidence_ids_json: evidence, created_at: time }));
  const runs = read('proactive_runs', runSchema);
  if (bindings.size !== batches.length || batches.some((row) => !bindings.has(row.batch_id))) throw new Error('Every historical batch requires an explicit activation binding');
  const eventMap = new Map(events.map((row) => [row.event_id, row]));
  const batchMap = new Map(batches.map((row) => [row.batch_id, row]));
  const snapshotMap = new Map(snapshots.map((row) => [row.snapshot_id, row]));
  const batchMembers = new Map<string, typeof members>();
  for (const member of members) {
    if (!batchMap.has(member.batch_id) || !eventMap.has(member.event_id)) throw new Error('Dangling historical batch membership');
    const list = batchMembers.get(member.batch_id) ?? [];
    list.push(member); batchMembers.set(member.batch_id, list);
  }

  db.exec('SAVEPOINT scene_execution_conversion');
  try {
    for (const event of events) {
      const ownerId = owners.get(event.workspace_id);
      if (!ownerId) throw new Error('Historical event ownership is missing');
      db.prepare(`INSERT INTO scene_events VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`)
        .run(event.event_id, ownerId, event.workspace_id, event.source_kind, event.dedupe_key,
          event.type, event.subject_id, event.occurred_at, event.observed_at);
      db.prepare(`INSERT INTO scene_event_details VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(event.event_id, event.schema_version, event.source_kind, event.source_id, event.device_id,
          event.subject_kind, event.actor_kind, event.actor_id, event.project_id, event.agent_id,
          event.correlation_id, event.causation_id, event.sensitivity, event.payload_json, event.routed_at);
    }
    for (const batch of batches) {
      if (batch.status === 'processing') throw new Error('Historical batch is still processing');
      const activation = db.prepare('SELECT * FROM scene_activations WHERE id = ?').get(bindings.get(batch.batch_id)!);
      const subscription = db.prepare('SELECT workspace_id, scenario_key FROM proactive_scenario_subscriptions WHERE subscription_id = ?').get(batch.subscription_id);
      if (!activation || !subscription || subscription.scenario_key !== batch.scenario_key
        || subscription.workspace_id !== activation.workspace_id || owners.get(String(subscription.workspace_id)) !== activation.owner_id) {
        throw new Error('Historical batch binding crosses ownership or scenario identity');
      }
      if (activation.status === 'active') throw new Error('Import destination must be inactive');
      const links = (batchMembers.get(batch.batch_id) ?? []).sort((a, b) => a.added_at - b.added_at || a.event_id.localeCompare(b.event_id));
      if (links.length !== batch.event_count) throw new Error('Historical batch event count differs from membership');
      if (links.some((link) => eventMap.get(link.event_id)!.workspace_id !== subscription.workspace_id)) throw new Error('Historical event crosses batch ownership');
      db.prepare(`INSERT INTO scene_trigger_intents VALUES (?, ?, ?, 'history', ?, ?, ?, ?)`)
        .run(batch.batch_id, activation.id, activation.revision, batch.batch_id, links[0]?.event_id ?? null,
          batch.ready_at, ['processed', 'ignored'].includes(batch.status) ? 'resolved' : 'cancelled');
      db.prepare('INSERT INTO scene_intent_details VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(batch.batch_id, batch.scenario_key, batch.scenario_version, batch.subscription_id, batch.aggregation_key,
          batch.window_started_at, batch.window_ends_at, batch.status, batch.event_count, batch.created_at, batch.updated_at);
      for (const link of links) db.prepare('INSERT INTO scene_intent_events VALUES (?, ?, ?)').run(batch.batch_id, link.event_id, link.added_at);
    }
    for (const snapshot of snapshots) {
      if (!batchMap.has(snapshot.batch_id)) throw new Error('Historical snapshot has no batch');
      db.prepare('INSERT INTO scene_evidence_snapshots VALUES (?, ?, ?, ?, ?, ?)')
        .run(snapshot.snapshot_id, snapshot.batch_id, snapshot.content_json,
          sceneContentHash(JSON.parse(snapshot.content_json)), snapshot.evidence_ids_json, snapshot.created_at);
    }
    for (const run of runs) {
      if (run.status === 'running' || run.lease_owner !== null || run.lease_expires_at !== null) throw new Error('Historical run requires offline reconciliation');
      const batch = batchMap.get(run.batch_id);
      if (!batch || batch.subscription_id !== run.subscription_id || batch.scenario_key !== run.scenario_key || batch.scenario_version !== run.scenario_version) throw new Error('Historical run batch identity mismatch');
      const snapshot = run.context_snapshot_id ? snapshotMap.get(run.context_snapshot_id) : null;
      if (run.context_snapshot_id && (!snapshot || snapshot.batch_id !== run.batch_id)) throw new Error('Historical run snapshot identity mismatch');
      if (run.prompt_revision_id && db.prepare('SELECT subscription_id FROM proactive_prompt_revisions WHERE revision_id = ?').get(run.prompt_revision_id)?.subscription_id !== run.subscription_id) throw new Error('Historical run instruction ownership mismatch');
      const activationId = bindings.get(run.batch_id)!;
      const activation = db.prepare('SELECT revision FROM scene_activations WHERE id = ?').get(activationId)!;
      const status = run.status === 'completed' ? 'succeeded' : run.status === 'discarded' ? 'skipped' : run.status === 'failed' ? 'failed' : 'cancelled';
      db.prepare(`INSERT INTO scene_runs(id, origin, intent_id, activation_id, activation_revision, status, attempt, lease_epoch, reason, created_at)
        VALUES (?, 'import', ?, ?, ?, ?, ?, 1, ?, ?)`)
        .run(run.run_id, run.batch_id, activationId, activation.revision, status, run.attempt,
          run.status === 'retryable' ? 'import_requires_review' : run.outcome_reason, run.started_at);
      db.prepare('INSERT INTO scene_run_details VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(run.run_id, run.scenario_key, run.scenario_version, run.subscription_id, run.prompt_revision_id,
          run.context_snapshot_id, run.status, run.model_ref, run.raw_output, run.error_message, run.completed_at, run.updated_at,
          run.next_attempt_at, run.outcome_reason, run.policy_revision, run.subscription_revision, run.policy_snapshot_json,
          run.input_tokens, run.output_tokens, run.estimated_cost_usd);
      if (snapshot) db.prepare('INSERT INTO scene_context_snapshots VALUES (?, 1, ?, ?, ?)')
        .run(run.run_id, sceneContentHash(JSON.parse(snapshot.content_json)), snapshot.evidence_ids_json, snapshot.created_at);
    }
    if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Execution conversion broke foreign keys');
    db.exec('RELEASE scene_execution_conversion');
    return { events: events.length, batches: batches.length, memberships: members.length, snapshots: snapshots.length, runs: runs.length };
  } catch (error) {
    db.exec('ROLLBACK TO scene_execution_conversion'); db.exec('RELEASE scene_execution_conversion'); throw error;
  }
}
