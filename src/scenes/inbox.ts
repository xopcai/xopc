import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import { z } from 'zod';

import type { ScenePrincipal } from './contracts.js';
import { SceneConflictError, SceneNotFoundError } from './repository.js';

const feedbackSchema = z.strictObject({
  expectedRevision: z.number().int().nonnegative(),
  rating: z.enum(['useful', 'not_useful']),
  note: z.string().trim().max(2000).optional(),
});
const actionable = `withdrawn_at IS NULL AND (expires_at IS NULL OR expires_at > ?)
  AND (status IN ('unread', 'read') OR (status = 'snoozed' AND snoozed_until <= ?))`;

/** Feedback records a user's judgment, never an inferred successful action. */
export class SceneInboxService {
  constructor(private readonly db: DatabaseSync, private readonly clock: () => number = Date.now) {}

  setRead(principal: ScenePrincipal, id: string, read: boolean): void {
    if (typeof read !== 'boolean') throw new Error('Read state must be a boolean');
    this.assertVisible(principal, id);
    const now = this.clock();
    const result = this.db.prepare(`UPDATE scene_presentations SET status = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND ${actionable}`)
      .run(read ? 'read' : 'unread', now, id, now, now);
    if (result.changes !== 1) throw new SceneConflictError('Scene presentation was withdrawn');
  }

  feedback(principal: ScenePrincipal, id: string, value: unknown): number {
    const input = feedbackSchema.parse(value);
    this.assertVisible(principal, id);
    this.db.exec('SAVEPOINT scene_feedback_write');
    try {
      const now = this.clock();
      const note = input.note ?? String(this.db.prepare('SELECT note FROM scene_feedback WHERE presentation_id = ?').get(id)?.note ?? '');
      const result = input.expectedRevision === 0
        ? this.db.prepare(`INSERT INTO scene_feedback (presentation_id, rating, note, revision, updated_at)
            SELECT ?, ?, ?, 1, ? WHERE EXISTS (SELECT 1 FROM scene_presentations WHERE id = ? AND ${actionable})
            ON CONFLICT(presentation_id) DO NOTHING`).run(id, input.rating, note, now, id, now, now)
        : this.db.prepare(`UPDATE scene_feedback SET rating = ?, note = ?, revision = revision + 1, updated_at = ?
            WHERE presentation_id = ? AND revision = ?
            AND EXISTS (SELECT 1 FROM scene_presentations WHERE id = ? AND ${actionable})`)
          .run(input.rating, note, now, id, input.expectedRevision, id, now, now);
      if (result.changes !== 1) throw new SceneConflictError('Scene feedback changed');
      this.db.prepare(`INSERT INTO scene_feedback_history(id, presentation_id, rating, note, revision, recorded_at)
        VALUES (?, ?, ?, ?, ?, ?)`).run(randomUUID(), id, input.rating, note, input.expectedRevision + 1, now);
      this.db.exec('RELEASE scene_feedback_write');
      return input.expectedRevision + 1;
    } catch (error) {
      this.db.exec('ROLLBACK TO scene_feedback_write');
      this.db.exec('RELEASE scene_feedback_write');
      throw error;
    }
  }

  getFeedback(principal: ScenePrincipal, id: string): { rating: string; note: string; revision: number } | null {
    this.assertVisible(principal, id);
    const row = this.db.prepare('SELECT rating, note, revision FROM scene_feedback WHERE presentation_id = ?').get(id);
    return row ? { rating: String(row.rating), note: String(row.note), revision: Number(row.revision) } : null;
  }

  private assertVisible(principal: ScenePrincipal, id: string): void {
    if (!principal.ownerId?.trim() || !principal.workspaceId?.trim()) throw new Error('Scene principal is required');
    const row = this.db.prepare(`SELECT p.status, p.withdrawn_at, p.expires_at, p.snoozed_until FROM scene_presentations p
      JOIN scene_outcomes o ON o.id = p.outcome_id JOIN scene_runs r ON r.id = o.run_id
      JOIN scene_activations a ON a.id = r.activation_id
      WHERE p.id = ? AND a.owner_id = ? AND a.workspace_id = ?`).get(id, principal.ownerId, principal.workspaceId);
    if (!row) throw new SceneNotFoundError('Scene presentation not found');
    const now = this.clock();
    if (row.status === 'withdrawn' || row.withdrawn_at !== null) throw new SceneConflictError('Scene presentation was withdrawn');
    if (row.status === 'resolved' || (row.expires_at !== null && Number(row.expires_at) <= now)
      || (row.status === 'snoozed' && (row.snoozed_until === null || Number(row.snoozed_until) > now))) throw new SceneConflictError('Scene presentation is not currently actionable');
  }
}
