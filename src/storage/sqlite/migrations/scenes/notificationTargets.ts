import type { DatabaseSync } from 'node:sqlite';

import { z } from 'zod';

const id = z.string().min(1);
const deliveryFields = {
  deliveryChannel: z.enum(['all', 'browser', 'mobile', 'telegram']).optional(),
  deliveryMode: z.enum(['all', 'auto', 'browser', 'mobile', 'telegram']).optional(),
};
const targetSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('insight'), inboxItemId: id }),
  z.strictObject({ kind: z.literal('proactive_digest'), digestId: id }),
]);

/** Rewrites shared notification links once, retaining event IDs, dedupe keys, device receipts and acknowledgements. */
export function convertSceneNotificationTargets(db: DatabaseSync): number {
  const rows = db.prepare("SELECT event_id, target_json, payload_json FROM notification_events WHERE event_type = 'proactive.insight' LIMIT 100001").all();
  if (rows.length > 100_000) throw new Error('Notification target conversion exceeds reviewed limit');
  db.exec('SAVEPOINT scene_notification_targets');
  try {
    for (const row of rows) {
      const target = targetSchema.parse(JSON.parse(String(row.target_json)));
      let type: string;
      let nextTarget: object;
      let nextPayload: object;
      if (target.kind === 'insight') {
        const presentation = db.prepare(`SELECT p.id, o.id AS outcome_id, r.activation_id, a.owner_id, a.workspace_id
          FROM scene_presentations p JOIN scene_outcomes o ON o.id = p.outcome_id
          JOIN scene_runs r ON r.id = o.run_id JOIN scene_activations a ON a.id = r.activation_id WHERE p.id = ?`).get(target.inboxItemId);
        if (!presentation) throw new Error('Notification target references missing scene history');
        const payload = z.strictObject({ ...deliveryFields, inboxItemId: id.optional(), insightId: id.optional(),
          notificationRevision: z.number().int().positive().optional() }).parse(JSON.parse(String(row.payload_json)));
        if ((payload.inboxItemId !== undefined && payload.inboxItemId !== target.inboxItemId)
          || (payload.insightId !== undefined && payload.insightId !== presentation.outcome_id)) throw new Error('Notification payload identity mismatch');
        type = 'scene.result';
        nextTarget = { kind: 'scene_result', activationId: presentation.activation_id, presentationId: presentation.id };
        nextPayload = { ownerId: presentation.owner_id, workspaceId: presentation.workspace_id, outcomeId: presentation.outcome_id,
          presentationId: presentation.id, imported: true, deliveryChannel: payload.deliveryChannel, deliveryMode: payload.deliveryMode,
          ...(payload.notificationRevision === undefined ? {} : { notificationRevision: payload.notificationRevision }) };
      } else {
        const digest = db.prepare('SELECT owner_id, workspace_id FROM notification_digests WHERE id = ?').get(target.digestId);
        if (!digest) throw new Error('Notification target references missing digest history');
        const payload = z.strictObject({ ...deliveryFields, digestId: id.optional() }).parse(JSON.parse(String(row.payload_json)));
        if (payload.digestId !== undefined && payload.digestId !== target.digestId) throw new Error('Digest payload identity mismatch');
        type = 'scene.digest'; nextTarget = { kind: 'scene_digest', digestId: target.digestId };
        nextPayload = { ownerId: digest.owner_id, workspaceId: digest.workspace_id, digestId: target.digestId,
          imported: true, deliveryChannel: payload.deliveryChannel, deliveryMode: payload.deliveryMode };
      }
      db.prepare('UPDATE notification_events SET event_type = ?, target_json = ?, payload_json = ? WHERE event_id = ?')
        .run(type, JSON.stringify(nextTarget), JSON.stringify(nextPayload), row.event_id);
    }
    db.exec('RELEASE scene_notification_targets');
    return rows.length;
  } catch (error) {
    db.exec('ROLLBACK TO scene_notification_targets'); db.exec('RELEASE scene_notification_targets'); throw error;
  }
}
