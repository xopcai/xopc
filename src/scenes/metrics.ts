import type { DatabaseSync } from 'node:sqlite';

import type { ScenePrincipal } from './contracts.js';

/** Explicit feedback is a usefulness signal, not proof of adoption or saved time. */
export class SceneMetrics {
  constructor(
    private readonly db: DatabaseSync,
    private readonly clock: () => number = Date.now,
    private readonly modelRef: () => string | null = () => null,
  ) {}

  diagnostics(principal: ScenePrincipal) {
    if (!principal.ownerId.trim() || !principal.workspaceId.trim()) throw new Error('Scene principal is required');
    const now = this.clock();
    const queue = this.db.prepare(`SELECT COUNT(*) AS depth, MIN(i.due_at) AS oldest
      FROM scene_trigger_intents i JOIN scene_activations a ON a.id = i.activation_id
      WHERE a.owner_id = ? AND a.workspace_id = ? AND i.status = 'pending'`)
      .get(principal.ownerId, principal.workspaceId)!;
    const usage = this.db.prepare(`SELECT COUNT(*) AS calls, COALESCE(SUM(u.total_tokens), 0) AS tokens,
      COALESCE(SUM(u.estimated_cost), 0) AS cost FROM scene_model_usage u JOIN scene_runs r ON r.id = u.run_id
      JOIN scene_activations a ON a.id = r.activation_id WHERE a.owner_id = ? AND a.workspace_id = ? AND u.recorded_at >= ?`)
      .get(principal.ownerId, principal.workspaceId, now - 7 * 86400000)!;
    const connectorReads = Number(this.db.prepare(`SELECT COALESCE(SUM(request_count), 0) AS count FROM scene_connector_usage
      WHERE owner_id = ? AND workspace_id = ? AND utc_day >= ?`).get(principal.ownerId, principal.workspaceId, Math.floor(now / 86400000) - 6)?.count);
    const notifications = this.db.prepare(`SELECT status, COUNT(*) AS count FROM notification_dispatches
      WHERE owner_id = ? AND workspace_id = ? GROUP BY status`).all(principal.ownerId, principal.workspaceId);
    const activations = this.db.prepare(`SELECT a.id, a.status,
      (SELECT MAX(created_at) FROM scene_runs WHERE activation_id = a.id) AS last_check_at,
      (SELECT reason FROM scene_runs WHERE activation_id = a.id ORDER BY created_at DESC, id DESC LIMIT 1) AS last_reason,
      CASE WHEN a.status = 'active' THEN (SELECT MIN(next_due_at) FROM scene_schedule_cursors WHERE activation_id = a.id) END AS next_schedule_at,
      (SELECT MIN(due_at) FROM scene_work_items WHERE activation_id = a.id AND status = 'watching') AS deadline_at,
      CASE WHEN a.status = 'active' THEN (SELECT MIN(due_at) FROM scene_work_items WHERE activation_id = a.id AND status = 'watching' AND (last_triggered_revision IS NULL OR last_triggered_revision <> revision)) END AS next_deadline_check_at,
      (SELECT MIN(retry_at) FROM scene_runs WHERE activation_id = a.id AND status = 'retry_wait') AS retry_at,
      (SELECT reason FROM scene_source_health WHERE activation_id = a.id) AS source_reason,
      (SELECT last_attempt_at FROM scene_source_health WHERE activation_id = a.id) AS source_attempt_at,
      (SELECT consecutive_failures FROM scene_source_health WHERE activation_id = a.id) AS source_failures,
      (SELECT last_success_at FROM scene_source_health WHERE activation_id = a.id) AS source_success_at,
      (SELECT retry_at FROM scene_source_health WHERE activation_id = a.id) AS source_retry_at
      FROM scene_activations a WHERE a.owner_id = ? AND a.workspace_id = ? ORDER BY a.id LIMIT 100`)
      .all(principal.ownerId, principal.workspaceId);
    const policyRow = this.db.prepare('SELECT preferences_json FROM scene_preferences WHERE owner_id = ? AND workspace_id = ?').get(principal.ownerId, principal.workspaceId);
    const policy = policyRow ? JSON.parse(String(policyRow.preferences_json)) : {};
    const checksPaused = policy.checksPaused === true || Date.parse(policy.checksPausedUntil ?? '') > now;
    if (checksPaused) for (const activation of activations) { activation.next_schedule_at = null; activation.next_deadline_check_at = null; activation.retry_at = null; }
    let currentModel: string | null = null;
    try { currentModel = this.modelRef(); } catch { /* Readiness reports invalid model configuration. */ }
    return { checksPaused, currentModel, pendingChecks: Number(queue.depth), oldestDueWaitMs: queue.oldest == null ? 0 : Math.max(0, now - Number(queue.oldest)),
      lastSevenDays: { modelCalls: Number(usage.calls), connectorReads, tokens: Number(usage.tokens), estimatedCost: Number(usage.cost) }, notifications, activations };
  }

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
      WHERE a.owner_id = ? AND a.workspace_id = ?
        AND f.recorded_at >= ? AND f.recorded_at < ?`)
      .get(principal.ownerId, principal.workspaceId, since, until)!;
    const work = this.db.prepare(`SELECT COUNT(*) AS checks,
      COALESCE(SUM(CASE WHEN r.status = 'failed' THEN 1 ELSE 0 END), 0) AS failedChecks,
      COALESCE(SUM(CASE WHEN r.status = 'skipped' THEN 1 ELSE 0 END), 0) AS skippedChecks
      FROM scene_runs r JOIN scene_activations a ON a.id = r.activation_id
      WHERE a.owner_id = ? AND a.workspace_id = ? AND r.created_at >= ? AND r.created_at < ?`)
      .get(principal.ownerId, principal.workspaceId, since, until)!;
    return { window: { since, until, days },
      ratedOutcomes: Number(feedback.ratedOutcomes), usefulOutcomes: Number(feedback.usefulOutcomes),
      unhelpfulOutcomes: Number(feedback.unhelpfulOutcomes), scenesWithUsefulOutcomes: Number(feedback.scenesWithUsefulOutcomes),
      checks: Number(work.checks), failedChecks: Number(work.failedChecks), skippedChecks: Number(work.skippedChecks),
    };
  }
}
