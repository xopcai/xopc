import type { DatabaseSync } from 'node:sqlite';

import { z } from 'zod';

import { resolveSceneCutoverBindings, type SceneCutoverBindings } from './bindings.js';
import { resolveScenePresentationBindings } from './presentationBindings.js';
import { scenePreferencesSchema } from './targetContract.js';

/** Preserves typed choices and expiring presence; never renews a lease or restores execution permissions. */
export function convertScenePreferences(db: DatabaseSync, input: { owners: SceneCutoverBindings; presentations: unknown }) {
  const owners = new Map(resolveSceneCutoverBindings(db, input.owners).map((row) => [row.workspaceId, row.ownerId]));
  const presentations = resolveScenePresentationBindings(db, owners, input.presentations);
  const read = (table: string) => {
    const rows = db.prepare(`SELECT * FROM ${table} LIMIT 100001`).all();
    if (rows.length > 100_000) throw new Error(`Preference conversion exceeds reviewed limit: ${table}`);
    return rows;
  };
  const preferences = read('proactive_preferences').map((row) => z.strictObject({
    workspace_id: z.string().min(1), preferences_json: z.string(), revision: z.number().int().positive(),
  }).parse(row));
  const presence = read('proactive_presence').map((row) => z.strictObject({
    workspace_id: z.string().min(1), client_id: z.string().min(1), surface: z.enum(['web', 'electron', 'mobile']),
    expires_at: z.number().int().nonnegative(), inbox_item_id: z.string().min(1).nullable(),
    notification_revision: z.number().int().positive().nullable(),
  }).parse(row));
  db.exec('SAVEPOINT scene_preferences_conversion');
  try {
    for (const row of preferences) {
      const parsed = scenePreferencesSchema.extend({ revision: z.number().int().nonnegative().optional() }).parse(JSON.parse(row.preferences_json));
      const { revision, ...value } = parsed;
      if (revision !== undefined && revision !== row.revision) throw new Error('Preference revision mismatch');
      db.prepare('INSERT INTO scene_preferences VALUES (?, ?, ?, ?)')
        .run(owners.get(row.workspace_id)!, row.workspace_id, JSON.stringify(value), row.revision);
    }
    for (const row of presence) {
      const subject = row.inbox_item_id === null ? undefined : presentations.get(row.inbox_item_id);
      if (row.inbox_item_id !== null && !subject) throw new Error('Presence requires a presentation mapping');
      if (subject && (subject.workspaceId !== row.workspace_id || subject.ownerId !== owners.get(row.workspace_id))) throw new Error('Presence crosses ownership');
      db.prepare('INSERT INTO notification_presence VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(owners.get(row.workspace_id)!, row.workspace_id, row.client_id, row.surface, row.expires_at,
          subject?.id ?? null, row.notification_revision, row.inbox_item_id);
    }
    db.exec('RELEASE scene_preferences_conversion');
    return { preferences: preferences.length, presence: presence.length };
  } catch (error) {
    db.exec('ROLLBACK TO scene_preferences_conversion'); db.exec('RELEASE scene_preferences_conversion'); throw error;
  }
}
