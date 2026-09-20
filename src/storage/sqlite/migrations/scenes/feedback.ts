import type { DatabaseSync } from 'node:sqlite';

import { z } from 'zod';

import { resolveSceneCutoverBindings, type SceneCutoverBindings } from './bindings.js';
import { resolveScenePresentationBindings } from './presentationBindings.js';

const feedbackRow = z.strictObject({
  feedback_id: z.string().min(1), inbox_item_id: z.string().min(1), rating: z.enum(['useful', 'not_useful']),
  note: z.string(), created_at: z.string().datetime({ offset: true }),
});

/** Preserves every historical judgment; only the latest is the current projection. */
export function convertSceneFeedback(db: DatabaseSync, input: { owners: SceneCutoverBindings; presentations: unknown }): number {
  const owners = new Map(resolveSceneCutoverBindings(db, input.owners).map((row) => [row.workspaceId, row.ownerId]));
  const bindings = resolveScenePresentationBindings(db, owners, input.presentations);
  const rows = db.prepare('SELECT * FROM proactive_feedback ORDER BY rowid LIMIT 100001').all();
  if (rows.length > 100_000) throw new Error('Feedback conversion exceeds its reviewed limit');
  const ordered = rows.map((value) => {
    const row = feedbackRow.parse(value);
    const time = Date.parse(row.created_at);
    if (!Number.isSafeInteger(time) || time < 0) throw new Error('Invalid feedback timestamp');
    return { row, time };
  }).sort((left, right) => left.time - right.time);
  db.exec('SAVEPOINT scene_feedback_conversion');
  try {
    const latest = new Map<string, { rating: string; note: string; revision: number; time: number }>();
    for (const { row, time } of ordered) {
      const binding = bindings.get(row.inbox_item_id);
      if (!binding) throw new Error('Feedback conversion requires a presentation mapping');
      const revision = (latest.get(binding.id)?.revision ?? 0) + 1;
      db.prepare(`INSERT INTO scene_feedback_history (id, presentation_id, rating, note, revision, origin, recorded_at)
        VALUES (?, ?, ?, ?, ?, 'import', ?)`).run(row.feedback_id, binding.id, row.rating, row.note, revision, time);
      latest.set(binding.id, { rating: row.rating, note: row.note, revision, time });
    }
    for (const [id, row] of latest) db.prepare(`INSERT INTO scene_feedback(presentation_id, rating, note, revision, updated_at)
      VALUES (?, ?, ?, ?, ?)`).run(id, row.rating, row.note, row.revision, row.time);
    db.exec('RELEASE scene_feedback_conversion');
    return rows.length;
  } catch (error) {
    db.exec('ROLLBACK TO scene_feedback_conversion');
    db.exec('RELEASE scene_feedback_conversion');
    throw error;
  }
}
