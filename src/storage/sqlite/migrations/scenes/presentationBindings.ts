import type { DatabaseSync } from 'node:sqlite';

import { z } from 'zod';

export interface ScenePresentationBinding { id: string; ownerId: string; workspaceId: string }
const mappingSchema = z.array(z.strictObject({ inboxItemId: z.string().min(1), presentationId: z.string().min(1) }))
  .max(100_000).refine((rows) => new Set(rows.map((row) => row.inboxItemId)).size === rows.length
    && new Set(rows.map((row) => row.presentationId)).size === rows.length, 'Duplicate presentation mapping');

/** Resolves explicit historical identity links without trusting client-supplied ownership. */
export function resolveScenePresentationBindings(db: DatabaseSync, owners: ReadonlyMap<string, string>, value: unknown): Map<string, ScenePresentationBinding> {
  return new Map(mappingSchema.parse(value).map((mapping) => {
    const target = db.prepare(`SELECT a.owner_id, a.workspace_id FROM scene_presentations p
      JOIN scene_outcomes o ON o.id = p.outcome_id JOIN scene_runs r ON r.id = o.run_id
      JOIN scene_activations a ON a.id = r.activation_id WHERE p.id = ?`).get(mapping.presentationId);
    const source = db.prepare(`SELECT s.workspace_id FROM proactive_inbox_items i
      JOIN proactive_insights x ON x.insight_id = i.insight_id
      JOIN proactive_scenario_subscriptions s ON s.subscription_id = x.subscription_id WHERE i.inbox_item_id = ?`).get(mapping.inboxItemId);
    if (!source || !target || target.workspace_id !== source.workspace_id || owners.get(String(source.workspace_id)) !== target.owner_id) {
      throw new Error('Presentation mapping crosses ownership or references missing history');
    }
    return [mapping.inboxItemId, { id: mapping.presentationId, ownerId: String(target.owner_id), workspaceId: String(target.workspace_id) }] as const;
  }));
}
