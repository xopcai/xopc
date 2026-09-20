import type { DatabaseSync } from 'node:sqlite';

import type { NotificationResult } from '../notifications/resultOutbox.js';

export type SceneNotificationEligibility = { action: 'cancel'; reason: string }
  | { action: 'defer'; until: number }
  | { action: 'eligible'; activationId: string; presentationId: string; revision: number; kind: string };

/** Local result eligibility only. The host must still recheck connector authorization and attention policy. */
export function sceneNotificationEligibility(db: DatabaseSync, result: NotificationResult,
  now: number, expectedRevision?: number): SceneNotificationEligibility {
  if (!result.ownerId.trim() || !result.workspaceId.trim() || !result.subjectId.trim()) return { action: 'cancel', reason: 'invalid_scope' };
  const row = db.prepare(`SELECT p.id, p.status, p.notification_revision, p.withdrawn_at, p.expires_at, p.snoozed_until,
      r.activation_id, r.activation_revision, a.revision, a.status AS activation_status, o.kind
    FROM scene_presentations p JOIN scene_outcomes o ON o.id = p.outcome_id
    JOIN scene_runs r ON r.id = o.run_id JOIN scene_activations a ON a.id = r.activation_id
    WHERE p.id = ? AND p.destination = 'inbox' AND a.owner_id = ? AND a.workspace_id = ?`)
    .get(result.subjectId, result.ownerId, result.workspaceId);
  if (!row) return { action: 'cancel', reason: 'result_unavailable' };
  if (row.activation_status !== 'active') return { action: 'cancel', reason: 'activation_inactive' };
  if (row.activation_revision !== row.revision) return { action: 'cancel', reason: 'activation_changed' };
  if (row.kind === 'no_change') return { action: 'cancel', reason: 'no_change' };
  if (expectedRevision !== undefined && row.notification_revision !== expectedRevision) return { action: 'cancel', reason: 'result_changed' };
  if (row.withdrawn_at !== null || row.status === 'withdrawn') return { action: 'cancel', reason: 'result_withdrawn' };
  if (row.expires_at !== null && Number(row.expires_at) <= now) return { action: 'cancel', reason: 'result_expired' };
  if (row.status === 'read' || row.status === 'resolved') return { action: 'cancel', reason: 'result_reviewed' };
  if (row.status === 'snoozed') {
    if (row.snoozed_until === null) return { action: 'cancel', reason: 'invalid_snooze' };
    if (Number(row.snoozed_until) > now) return { action: 'defer', until: Number(row.snoozed_until) };
  } else if (row.status !== 'unread') return { action: 'cancel', reason: 'result_unavailable' };
  return { action: 'eligible', activationId: String(row.activation_id), presentationId: String(row.id),
    revision: Number(row.notification_revision), kind: String(row.kind) };
}
