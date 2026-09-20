import type { DatabaseSync } from 'node:sqlite';

import { NotificationResultOutbox, type NotificationResult, type PublicationDecision } from '../notifications/resultOutbox.js';
import { notificationQuietUntil } from '../notifications/quietHours.js';
import { sceneNotificationEligibility, type SceneNotificationEligibility } from './notificationEligibility.js';
import { ScenePreferenceService, sceneChecksAllowed } from './preferences.js';

/** The required host callback applies attention policy and persists notification/dispatch records, without sending. */
export function createSceneNotificationOutbox(db: DatabaseSync,
  publish: (result: NotificationResult, eligible: Extract<SceneNotificationEligibility, { action: 'eligible' }>) => PublicationDecision,
  clock: () => number = Date.now): NotificationResultOutbox {
  return new NotificationResultOutbox(db, (result) => {
    const now = clock();
    const eligibility = sceneNotificationEligibility(db, result, now);
    if (eligibility.action === 'cancel') return { action: 'settle', reason: eligibility.reason };
    if (eligibility.action === 'defer') return { ...eligibility, reason: 'result_snoozed' };
    const preferences = new ScenePreferenceService(db).get(result);
    if (!sceneChecksAllowed(preferences, now)) return { action: 'settle', reason: 'checks_paused' };
    if (preferences.notificationsMuted || preferences.level === 'quiet') return { action: 'settle', reason: 'notifications_muted' };
    if (preferences.suppressWhileViewing && db.prepare(`SELECT 1 FROM notification_presence
      WHERE owner_id = ? AND workspace_id = ? AND subject_id = ? AND subject_revision = ? AND expires_at > ?`)
      .get(result.ownerId, result.workspaceId, result.subjectId, eligibility.revision, now)) return { action: 'settle', reason: 'result_viewed' };
    const quietUntil = notificationQuietUntil(preferences, now);
    if (quietUntil !== null) return { action: 'defer', until: quietUntil, reason: 'quiet_hours' };
    return publish(result, eligibility);
  }, clock);
}
