import type { DatabaseSync } from 'node:sqlite';

import { createBrowserNotificationTransport } from '../../notifications/browserTransport.js';
import { NotificationDispatcher, type NotificationDispatch } from '../../notifications/dispatch.js';
import { notificationQuietUntil } from '../../notifications/quietHours.js';
import { intersectPermissions, sceneContentHash, type SceneActivation, type ScenePermission } from '../../scenes/contracts.js';
import { sceneNotificationEligibility } from '../../scenes/notificationEligibility.js';
import { ScenePreferenceService, sceneChecksAllowed } from '../../scenes/preferences.js';
import { SceneRepository } from '../../scenes/repository.js';

export function createSceneBrowserDispatcher(db: DatabaseSync, authorize: (activation: SceneActivation) => ScenePermission, clock = Date.now) {
  const repository = new SceneRepository(db);
  const members = (dispatch: NotificationDispatch) => dispatch.subjectId
    ? [{ subject_id: dispatch.subjectId, subject_revision: dispatch.subjectRevision }]
    : db.prepare(`SELECT m.subject_id, m.subject_revision FROM notification_digest_members m
        JOIN notification_digests d ON d.id = m.digest_id
        WHERE d.notification_id = ? AND d.owner_id = ? AND d.workspace_id = ?`)
      .all(dispatch.notificationId, dispatch.ownerId, dispatch.workspaceId);
  const eligible = (dispatch: NotificationDispatch, subject: Record<string, unknown>) => {
    const result = sceneNotificationEligibility(db, { ...dispatch, subjectId: String(subject.subject_id) }, clock(), Number(subject.subject_revision));
    if (result.action !== 'eligible') return null;
    const activation = repository.getActivation(dispatch, result.activationId);
    if (sceneContentHash(intersectPermissions(activation.permissions, authorize(activation))) !== sceneContentHash(intersectPermissions(activation.permissions))) return null;
    return result;
  };
  const transport = createBrowserNotificationTransport(db, { clock, route: dispatch => {
    if (!dispatch.subjectId) return '/scenes/inbox';
    const result = eligible(dispatch, { subject_id: dispatch.subjectId, subject_revision: dispatch.subjectRevision });
    return result ? `/scenes/${encodeURIComponent(result.activationId)}?result=${encodeURIComponent(result.presentationId)}` : null;
  } });
  return new NotificationDispatcher(db, { clock, send: transport, authorize: async dispatch => {
    const policy = new ScenePreferenceService(db).get(dispatch);
    if (!sceneChecksAllowed(policy, clock()) || policy.notificationsMuted || policy.level === 'quiet'
      || policy.preferredChannel !== 'browser') return { action: 'cancel' };
    const current = members(dispatch).filter(subject => eligible(dispatch, subject)).filter(subject => !policy.suppressWhileViewing
      || !db.prepare(`SELECT 1 FROM notification_presence WHERE owner_id = ? AND workspace_id = ?
        AND subject_id = ? AND subject_revision = ? AND expires_at > ?`)
        .get(dispatch.ownerId, dispatch.workspaceId, subject.subject_id, subject.subject_revision, clock()));
    if (!current.length) return { action: 'cancel' };
    const until = notificationQuietUntil(policy, clock());
    return until === null ? { action: 'send' } : { action: 'defer', until };
  } });
}
