import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

import type { ProductNotification } from '@xopcai/gateway-contract';

import { enqueueBrowserDispatches } from '../notifications/browserSubscriptions.js';
import { createNotificationEvent } from '../notifications/store.js';
import { notificationQuietUntil } from '../notifications/quietHours.js';
import { runSqliteSavepoint } from '../storage/sqlite/transaction.js';
import { intersectPermissions, sceneContentHash, type SceneActivation, type ScenePermission } from './contracts.js';
import { createSceneNotificationOutbox } from './notificationPublication.js';
import { ScenePreferenceService, sceneChecksAllowed, type ScenePreferences } from './preferences.js';
import { SceneRepository } from './repository.js';
import { nextSceneScheduleAt } from './schedule.js';
import { sceneNotificationEligibility } from './notificationEligibility.js';

/** Page notifications commit with the result outbox; transport routing is never inferred. */
export class SceneResultNotifications {
  private readonly outbox;
  private committed: ProductNotification[] = [];

  constructor(private readonly db: DatabaseSync, private readonly authorize: (activation: SceneActivation) => ScenePermission,
    private readonly publish: (notification: ProductNotification) => void,
    private readonly clock: () => number = Date.now) {
    const repository = new SceneRepository(db);
    const preferences = new ScenePreferenceService(db);
    this.outbox = createSceneNotificationOutbox(db, (result, eligible) => {
      const activation = repository.getActivation(result, eligible.activationId);
      const granted = intersectPermissions(activation.permissions, authorize(activation));
      if (sceneContentHash(granted) !== sceneContentHash(intersectPermissions(activation.permissions))) {
        return { action: 'settle', reason: 'permission_revoked' };
      }
      const now = clock();
      const policy = preferences.get(result);
      if (policy.digestEnabled) {
        const due = nextSceneScheduleAt({ weekdays: [0, 1, 2, 3, 4, 5, 6], hour: policy.digestHour,
          minute: policy.digestMinute, timeZone: policy.timezone }, now);
        db.prepare(`INSERT INTO notification_digest_queue(subject_id, owner_id, workspace_id, subject_revision, mode, due_at, status)
          VALUES (?, ?, ?, ?, 'daily', ?, 'pending') ON CONFLICT(subject_id) DO UPDATE SET
          subject_revision = excluded.subject_revision, due_at = excluded.due_at, status = 'pending', consumed_at = NULL`)
          .run(result.subjectId, result.ownerId, result.workspaceId, eligible.revision, due);
        return { action: 'settle', reason: 'digest_queued' };
      }
      const key = `scene.result:${eligible.presentationId}:${eligible.revision}`;
      if (!this.reserveBudget(result, key, policy, now)) return { action: 'settle', reason: 'daily_budget' };
      const event = createNotificationEvent({ dedupeKey: key, createdAt: now, deviceIds: [], notification: {
        type: 'scene.result', priority: 'normal',
        target: { kind: 'scene_result', activationId: eligible.activationId, presentationId: eligible.presentationId },
        title: { en: 'A scene result is ready', zh: '场景有新成果' },
        body: { en: 'Open the scene to review it.', zh: '打开场景查看并反馈。' },
        payload: { ownerId: result.ownerId, workspaceId: result.workspaceId, notificationRevision: eligible.revision,
          deliveryChannel: 'in_app' },
      } }, db);
      if (policy.preferredChannel === 'browser') {
        enqueueBrowserDispatches(db, result, event.notification.id, result.subjectId, eligible.revision, now);
      }
      if (event.created) this.committed.push(event.notification);
      return { action: 'settle', reason: 'page_notification' };
    }, clock);
  }

  /** Realtime is a hint after commit; durable results and events survive a disconnected page. */
  drain(limit = 100): number {
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error('Invalid scene notification batch size');
    let drained = 0;
    for (; drained < limit; drained++) {
      this.committed = [];
      if (!this.outbox.drainOne()) break;
      // The outbox may have rolled back a failed publication. Only deliver committed events.
      for (const event of this.committed) {
        if (this.db.prepare('SELECT 1 FROM notification_events WHERE event_id = ?').get(event.id)) this.publish(event);
      }
    }
    this.flushDigests();
    return drained;
  }

  private reserveBudget(owner: { ownerId: string; workspaceId: string }, key: string, policy: ScenePreferences, now: number): boolean {
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: policy.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
    if (this.db.prepare('SELECT 1 FROM notification_attention_budget WHERE dedupe_key = ?').get(key)) return true;
    const used = Number(this.db.prepare(`SELECT count(*) AS n FROM notification_attention_budget
      WHERE owner_id = ? AND workspace_id = ? AND local_day = ?`).get(owner.ownerId, owner.workspaceId, day)?.n);
    if (used >= policy.dailyNotificationLimit) return false;
    this.db.prepare('INSERT INTO notification_attention_budget VALUES (?, ?, ?, ?, ?)').run(key, owner.ownerId, owner.workspaceId, day, now);
    return true;
  }

  private flushDigests(): void {
    const now = this.clock();
    const owners = this.db.prepare(`SELECT DISTINCT owner_id, workspace_id FROM notification_digest_queue
      WHERE status = 'pending' AND due_at <= ? ORDER BY owner_id, workspace_id LIMIT 100`).all(now);
    for (const owner of owners) {
      const event = runSqliteSavepoint(this.db, () => {
        const principal = { ownerId: String(owner.owner_id), workspaceId: String(owner.workspace_id) };
        const policy = new ScenePreferenceService(this.db).get(principal);
        const rows = this.db.prepare(`SELECT * FROM notification_digest_queue WHERE owner_id = ? AND workspace_id = ?
          AND status = 'pending' AND due_at <= ? ORDER BY due_at, subject_id LIMIT 100`).all(principal.ownerId, principal.workspaceId, now);
        const quiet = notificationQuietUntil(policy, now);
        const members: Array<{ id: string; revision: number }> = [];
        for (const row of rows) {
          const result = { ...principal, id: String(row.subject_id), subjectId: String(row.subject_id) };
          const eligible = sceneNotificationEligibility(this.db, result, now, Number(row.subject_revision));
          let until = eligible.action === 'defer' ? eligible.until : null;
          let allowed = eligible.action === 'eligible' && sceneChecksAllowed(policy, now) && !policy.notificationsMuted && policy.level !== 'quiet';
          if (allowed && eligible.action === 'eligible') {
            const activation = new SceneRepository(this.db).getActivation(principal, eligible.activationId);
            allowed = sceneContentHash(intersectPermissions(activation.permissions, this.authorize(activation)))
              === sceneContentHash(intersectPermissions(activation.permissions));
            if (policy.suppressWhileViewing && this.db.prepare(`SELECT 1 FROM notification_presence WHERE owner_id = ? AND workspace_id = ?
              AND subject_id = ? AND subject_revision = ? AND expires_at > ?`)
              .get(principal.ownerId, principal.workspaceId, row.subject_id, row.subject_revision, now)) allowed = false;
            if (allowed) until = quiet;
          }
          if (until !== null) {
            this.db.prepare('UPDATE notification_digest_queue SET due_at = ? WHERE subject_id = ?').run(until, row.subject_id);
            continue;
          }
          this.db.prepare("UPDATE notification_digest_queue SET status = 'consumed', consumed_at = ? WHERE subject_id = ?").run(now, row.subject_id);
          if (allowed) members.push({ id: String(row.subject_id), revision: Number(row.subject_revision) });
        }
        if (!members.length) return null;
        const occurrence = `daily:${rows[0].due_at}:${members[0].id}`;
        const key = `scene.digest:${sceneContentHash([principal, occurrence])}`;
        if (!this.reserveBudget(principal, key, policy, now)) return null;
        const id = randomUUID();
        const created = createNotificationEvent({ dedupeKey: key, createdAt: now, deviceIds: [], notification: {
          type: 'scene.digest', priority: 'normal', target: { kind: 'scene_digest', digestId: id },
          title: { en: 'Your scene digest is ready', zh: '场景摘要已就绪' },
          body: { en: 'Open the app to review your results.', zh: '打开页面查看成果。' },
          payload: { ...principal, deliveryChannel: 'in_app' },
        } }, this.db);
        this.db.prepare('INSERT INTO notification_digests VALUES (?, ?, ?, ?, ?, ?)')
          .run(id, principal.ownerId, principal.workspaceId, occurrence, now, created.notification.id);
        const insert = this.db.prepare('INSERT INTO notification_digest_members VALUES (?, ?, ?)');
        for (const member of members) insert.run(id, member.id, member.revision);
        if (policy.preferredChannel === 'browser') {
          enqueueBrowserDispatches(this.db, principal, created.notification.id, null, 1, now);
        }
        return created.created ? created.notification : null;
      });
      if (event) this.publish(event);
    }
  }
}
