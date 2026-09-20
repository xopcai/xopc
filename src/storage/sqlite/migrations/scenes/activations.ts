import type { DatabaseSync } from 'node:sqlite';

import { z } from 'zod';

import { sceneContentHash } from './targetContract.js';
import { resolveSceneCutoverBindings, type SceneCutoverBindings } from './bindings.js';

const id = z.string().min(1);
const time = z.string().datetime({ offset: true }).transform((value) => Date.parse(value)).pipe(z.number().int().nonnegative());
const settings = z.string().transform((value) => JSON.parse(value) as unknown).pipe(z.record(z.string(), z.unknown()))
  .transform((value) => { sceneContentHash(value); return JSON.stringify(value); });
const bindingSchema = z.array(z.strictObject({ subscriptionId: id, activationId: id })).max(100_000)
  .refine((rows) => new Set(rows.map((row) => row.subscriptionId)).size === rows.length
    && new Set(rows.map((row) => row.activationId)).size === rows.length, 'Ambiguous activation history binding');

/** Copies private instructions and configuration evidence, never publishing a template or granting permissions. */
export function convertSceneActivationHistory(db: DatabaseSync, input: { owners: SceneCutoverBindings; activations: unknown }) {
  const owners = new Map(resolveSceneCutoverBindings(db, input.owners).map((row) => [row.workspaceId, row.ownerId]));
  const bindings = new Map(bindingSchema.parse(input.activations).map((row) => [row.subscriptionId, row.activationId]));
  const read = <T>(table: string, schema: z.ZodType<T>): T[] => {
    const rows = db.prepare(`SELECT * FROM ${table} LIMIT 100001`).all();
    if (rows.length > 100_000) throw new Error(`Activation conversion exceeds reviewed limit: ${table}`);
    return rows.map((row) => schema.parse(row));
  };
  const subscriptions = read('proactive_scenario_subscriptions', z.strictObject({
    subscription_id: id, scenario_key: id, workspace_id: id, scope_kind: z.enum(['workspace', 'project']),
    scope_id: id, enabled: z.union([z.literal(0), z.literal(1)]), active_prompt_revision_id: id.nullable(), created_at: time, updated_at: time,
  }));
  const revisions = read('proactive_prompt_revisions', z.strictObject({
    revision_id: id, subscription_id: id, revision: z.number().int().positive(), status: z.enum(['draft', 'published', 'retired']),
    base_template_version: z.number().int().positive(), user_instructions: z.string(), content_hash: id, created_at: time, published_at: time.nullable(),
  }));
  const policies = read('proactive_subscription_settings', z.strictObject({ subscription_id: id, settings_json: settings, revision: z.number().int().positive() }));
  const schedules = read('proactive_schedule_state', z.strictObject({ subscription_id: id, next_due_at: time, last_checked_at: time.nullable(), last_fingerprint: z.string().nullable() }));
  if (bindings.size !== subscriptions.length || subscriptions.some((row) => !bindings.has(row.subscription_id))) throw new Error('Every subscription requires an explicit activation binding');
  const subscriptionsById = new Map(subscriptions.map((row) => [row.subscription_id, row]));
  const revisionsById = new Map(revisions.map((row) => [row.revision_id, row]));
  const policiesById = new Map(policies.map((row) => [row.subscription_id, row]));
  const schedulesById = new Map(schedules.map((row) => [row.subscription_id, row]));
  for (const row of [...revisions, ...policies, ...schedules]) {
    if (!subscriptionsById.has(row.subscription_id)) throw new Error('Dangling private subscription history');
  }
  db.exec('SAVEPOINT scene_activation_history_conversion');
  try {
    for (const subscription of subscriptions) {
      const activation = db.prepare('SELECT owner_id, workspace_id, status, permissions_json FROM scene_activations WHERE id = ?').get(bindings.get(subscription.subscription_id)!);
      if (!activation || activation.workspace_id !== subscription.workspace_id || owners.get(subscription.workspace_id) !== activation.owner_id) throw new Error('Private instruction binding crosses ownership');
      if (activation.status === 'active') throw new Error('Private instruction import requires an inactive activation');
      if (subscription.active_prompt_revision_id !== null) {
        const revision = revisionsById.get(subscription.active_prompt_revision_id);
        if (!revision || revision.subscription_id !== subscription.subscription_id || revision.status !== 'published') throw new Error('Active instruction revision does not belong to its subscription');
      }
    }
    for (const revision of revisions) db.prepare('INSERT INTO scene_instruction_revisions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(revision.revision_id, bindings.get(revision.subscription_id)!, revision.revision, revision.status, revision.base_template_version,
        revision.user_instructions, revision.content_hash, revision.created_at, revision.published_at);
    for (const subscription of subscriptions) {
      const policy = policiesById.get(subscription.subscription_id);
      const schedule = schedulesById.get(subscription.subscription_id);
      db.prepare('INSERT INTO scene_activation_details VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(bindings.get(subscription.subscription_id)!, subscription.subscription_id, subscription.scenario_key,
          subscription.scope_kind, subscription.scope_id, subscription.enabled, subscription.active_prompt_revision_id,
          subscription.created_at, subscription.updated_at, policy?.settings_json ?? null, policy?.revision ?? null,
          schedule?.next_due_at ?? null, schedule?.last_checked_at ?? null, schedule?.last_fingerprint ?? null);
    }
    if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Private instruction conversion broke foreign keys');
    db.exec('RELEASE scene_activation_history_conversion');
    return { subscriptions: subscriptions.length, revisions: revisions.length, settings: policies.length, schedules: schedules.length };
  } catch (error) {
    db.exec('ROLLBACK TO scene_activation_history_conversion'); db.exec('RELEASE scene_activation_history_conversion'); throw error;
  }
}
