import type { DatabaseSync } from 'node:sqlite';

import { z } from 'zod';

import type { ScenePrincipal } from './contracts.js';
import { SceneConflictError, SceneNotFoundError } from './repository.js';

const feedbackSchema = z.strictObject({
  expectedRevision: z.number().int().nonnegative(),
  rating: z.enum(['useful', 'not_useful']),
  note: z.string().trim().max(2000).default(''),
});

/** Feedback records a user's judgment, never an inferred successful action. */
export class SceneInboxService {
  constructor(private readonly db: DatabaseSync, private readonly clock: () => number = Date.now) {}

  setRead(principal: ScenePrincipal, id: string, read: boolean): void {
    if (typeof read !== 'boolean') throw new Error('Read state must be a boolean');
    this.assertVisible(principal, id);
    const result = this.db.prepare("UPDATE scene_presentations SET status = ? WHERE id = ? AND status <> 'withdrawn'")
      .run(read ? 'read' : 'unread', id);
    if (result.changes !== 1) throw new SceneConflictError('Scene presentation was withdrawn');
  }

  feedback(principal: ScenePrincipal, id: string, value: unknown): number {
    const input = feedbackSchema.parse(value);
    this.assertVisible(principal, id);
    const result = input.expectedRevision === 0
      ? this.db.prepare(`INSERT INTO scene_feedback (presentation_id, rating, note, revision, updated_at)
          SELECT ?, ?, ?, 1, ? WHERE EXISTS (SELECT 1 FROM scene_presentations WHERE id = ? AND status <> 'withdrawn')
          ON CONFLICT(presentation_id) DO NOTHING`).run(id, input.rating, input.note, this.clock(), id)
      : this.db.prepare(`UPDATE scene_feedback SET rating = ?, note = ?, revision = revision + 1, updated_at = ?
          WHERE presentation_id = ? AND revision = ?
          AND EXISTS (SELECT 1 FROM scene_presentations WHERE id = ? AND status <> 'withdrawn')`)
        .run(input.rating, input.note, this.clock(), id, input.expectedRevision, id);
    if (result.changes !== 1) throw new SceneConflictError('Scene feedback changed');
    return input.expectedRevision + 1;
  }

  getFeedback(principal: ScenePrincipal, id: string): { rating: string; note: string; revision: number } | null {
    this.assertVisible(principal, id);
    const row = this.db.prepare('SELECT rating, note, revision FROM scene_feedback WHERE presentation_id = ?').get(id);
    return row ? { rating: String(row.rating), note: String(row.note), revision: Number(row.revision) } : null;
  }

  private assertVisible(principal: ScenePrincipal, id: string): void {
    if (!principal.ownerId?.trim() || !principal.workspaceId?.trim()) throw new Error('Scene principal is required');
    const row = this.db.prepare(`SELECT p.status FROM scene_presentations p
      JOIN scene_outcomes o ON o.id = p.outcome_id JOIN scene_runs r ON r.id = o.run_id
      JOIN scene_activations a ON a.id = r.activation_id
      WHERE p.id = ? AND a.owner_id = ? AND a.workspace_id = ?`).get(id, principal.ownerId, principal.workspaceId);
    if (!row) throw new SceneNotFoundError('Scene presentation not found');
    if (row.status === 'withdrawn') throw new SceneConflictError('Scene presentation was withdrawn');
  }
}
