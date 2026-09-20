import type { DatabaseSync } from 'node:sqlite';

import type { ScenePrincipal } from './contracts.js';

/** Explicit feedback is a usefulness signal, not proof of adoption or saved time. */
export class SceneMetrics {
  constructor(private readonly db: DatabaseSync, private readonly clock: () => number = Date.now) {}

  forUser(principal: ScenePrincipal, days = 7) {
    if (!principal.ownerId?.trim() || !principal.workspaceId?.trim()) throw new Error('Scene principal is required');
    if (!Number.isInteger(days) || days < 1 || days > 90) throw new Error('Scene metric window must be 1–90 days');
    const until = this.clock();
    const since = until - days * 86_400_000;
    const feedback = this.db.prepare(`SELECT
      COUNT(*) AS ratedOutcomes,
      COALESCE(SUM(CASE WHEN f.rating = 'useful' THEN 1 ELSE 0 END), 0) AS usefulOutcomes,
      COALESCE(SUM(CASE WHEN f.rating = 'not_useful' THEN 1 ELSE 0 END), 0) AS unhelpfulOutcomes,
      COUNT(DISTINCT CASE WHEN f.rating = 'useful' THEN a.id END) AS scenesWithUsefulOutcomes
      FROM scene_feedback_history f JOIN scene_feedback latest
        ON latest.presentation_id = f.presentation_id AND latest.revision = f.revision
      JOIN scene_presentations p ON p.id = f.presentation_id JOIN scene_outcomes o ON o.id = p.outcome_id
      JOIN scene_runs r ON r.id = o.run_id JOIN scene_activations a ON a.id = r.activation_id
      WHERE a.owner_id = ? AND a.workspace_id = ? AND f.origin = 'user'
        AND f.recorded_at >= ? AND f.recorded_at < ?`)
      .get(principal.ownerId, principal.workspaceId, since, until)!;
    const work = this.db.prepare(`SELECT COUNT(*) AS checks,
      COALESCE(SUM(CASE WHEN r.status = 'failed' THEN 1 ELSE 0 END), 0) AS failedChecks,
      COALESCE(SUM(CASE WHEN r.status = 'skipped' THEN 1 ELSE 0 END), 0) AS skippedChecks
      FROM scene_runs r JOIN scene_activations a ON a.id = r.activation_id
      WHERE a.owner_id = ? AND a.workspace_id = ? AND r.origin = 'execution' AND r.created_at >= ? AND r.created_at < ?`)
      .get(principal.ownerId, principal.workspaceId, since, until)!;
    return { window: { since, until, days },
      ratedOutcomes: Number(feedback.ratedOutcomes), usefulOutcomes: Number(feedback.usefulOutcomes),
      unhelpfulOutcomes: Number(feedback.unhelpfulOutcomes), scenesWithUsefulOutcomes: Number(feedback.scenesWithUsefulOutcomes),
      checks: Number(work.checks), failedChecks: Number(work.failedChecks), skippedChecks: Number(work.skippedChecks),
    };
  }
}
