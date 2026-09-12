import { randomUUID } from 'node:crypto';

import type { ProductNotification } from '@xopcai/gateway-contract';

import type { NotificationPlan } from '../../notifications/planner.js';
import { getSqliteDatabase, runSqliteWriteTransaction } from '../../storage/sqlite/transaction.js';
import { insightSourcesAuthorized } from '../execution/authorization.js';
import { effectiveProactivePolicy, localProactiveDay, proactivePreferences, quietHoursEnd, nextDigestTime } from '../policy/service.js';
import { viewingProactiveCards } from '../policy/presence.js';
import { getCard } from './cards.js';
import { getInboxItem } from './repository.js';
import type { InboxItem } from './types.js';

export { nextDigestTime } from '../policy/service.js';

export function queueDigest(item: InboxItem, mode: 'daily' | 'quiet', dueAt: Date): void {
  const policy = effectiveProactivePolicy(item.subscriptionId!);
  getSqliteDatabase().prepare(`INSERT INTO proactive_digest_queue(inbox_item_id, workspace_id, notification_revision, mode, due_at)
    VALUES (?, ?, ?, ?, ?) ON CONFLICT(inbox_item_id) DO UPDATE SET notification_revision = excluded.notification_revision,
    mode = excluded.mode, due_at = excluded.due_at, consumed_at = NULL
    WHERE proactive_digest_queue.notification_revision <> excluded.notification_revision`)
    .run(item.id, policy.workspaceId, item.notificationRevision!, mode, dueAt.toISOString());
}

export function digestCards(id: string, workspaceId: string) {
  const digest = getSqliteDatabase().prepare('SELECT * FROM proactive_digests WHERE digest_id = ? AND workspace_id = ?').get(id, workspaceId) as { occurrence_key: string } | undefined;
  if (!digest) throw new Error('Digest not found');
  const members = getSqliteDatabase().prepare('SELECT inbox_item_id, notification_revision FROM proactive_digest_members WHERE digest_id = ?').all(id) as Array<{ inbox_item_id: string; notification_revision: number }>;
  return members.flatMap((member) => {
    const item = getInboxItem(member.inbox_item_id);
    if (!item || !eligibleDigestItem(item, digest.occurrence_key.startsWith('daily:') ? 'daily' : 'quiet') || item.notificationRevision !== member.notification_revision) return [];
    const card = getCard(item.id, workspaceId);
    return card.status === 'withdrawn' ? [] : [card];
  });
}
function eligibleDigestItem(item: InboxItem, mode: 'daily' | 'quiet'): boolean {
  const policy = effectiveProactivePolicy(item.subscriptionId!);
  const daily = policy.preferences.digestEnabled || policy.settings.delivery === 'digest';
  if (mode === 'daily' ? !daily : policy.level === 'quiet' && !daily) return false;
  return Boolean(policy.enabled && policy.settings.delivery !== 'inbox' && !item.withdrawnAt
    && !['resolved', 'snoozed'].includes(item.status) && (!item.expiresAt || Date.parse(item.expiresAt) > Date.now())
    && insightSourcesAuthorized(item.insightId));
}

export function reserveWorkspaceAttention(workspaceId: string, key: string, now = new Date()): boolean {
  const db = getSqliteDatabase();
  const preferences = proactivePreferences(workspaceId);
  if (preferences.level === 'off' || (preferences.pausedUntil && Date.parse(preferences.pausedUntil) > now.getTime())) return false;
  if (db.prepare('SELECT 1 FROM proactive_notification_budget WHERE dedupe_key = ?').get(key)) return true;
  const day = localProactiveDay(now, preferences.timezone);
  const { count } = db.prepare('SELECT COUNT(*) AS count FROM proactive_notification_budget WHERE workspace_id = ? AND local_day = ?').get(workspaceId, day) as { count: number };
  if (count >= preferences.dailyNotificationLimit) return false;
  db.prepare('INSERT INTO proactive_notification_budget VALUES (?, ?, ?, ?)').run(key, workspaceId, day, now.toISOString());
  return true;
}

export function flushDueDigests(persist: (plan: NotificationPlan) => ProductNotification | null, now = new Date()): ProductNotification[] {
  return runSqliteWriteTransaction((db) => {
    const groups = db.prepare(`SELECT workspace_id, mode FROM proactive_digest_queue WHERE consumed_at IS NULL AND due_at <= ? GROUP BY workspace_id, mode LIMIT 20`).all(now.toISOString()) as Array<{ workspace_id: string; mode: 'daily' | 'quiet' }>;
    const notifications: ProductNotification[] = [];
    for (const group of groups) {
      const preferences = proactivePreferences(group.workspace_id);
      const until = quietHoursEnd(preferences, now);
      if (until) { db.prepare('UPDATE proactive_digest_queue SET due_at = ? WHERE workspace_id = ? AND mode = ? AND consumed_at IS NULL').run(until.toISOString(), group.workspace_id, group.mode); continue; }
      const queued = db.prepare('SELECT inbox_item_id FROM proactive_digest_queue WHERE workspace_id = ? AND mode = ? AND consumed_at IS NULL AND due_at <= ? ORDER BY due_at LIMIT 500').all(group.workspace_id, group.mode, now.toISOString()) as Array<{ inbox_item_id: string }>;
      const seen = new Set<string>();
      const items = queued.flatMap((row) => {
        const item = getInboxItem(row.inbox_item_id);
        if (!item || !eligibleDigestItem(item, group.mode)) return [];
        const key = item.correlationKey ?? item.id;
        if (seen.has(key)) return [];
        seen.add(key); return [item];
      });
      const occurrence = `${group.mode}:${localProactiveDay(now, preferences.timezone)}`;
      const existing = db.prepare('SELECT 1 FROM proactive_digests WHERE workspace_id = ? AND occurrence_key = ?').get(group.workspace_id, occurrence);
      if (existing && items.length) {
        const tomorrow = nextDigestTime(preferences, new Date(now.getTime() + 60000));
        db.prepare('UPDATE proactive_digest_queue SET due_at = ? WHERE workspace_id = ? AND mode = ? AND consumed_at IS NULL').run(tomorrow.toISOString(), group.workspace_id, group.mode);
        continue;
      }
      if (!items.length || (preferences.suppressWhileViewing && viewingProactiveCards(group.workspace_id, now.getTime()))) {
        for (const row of queued) db.prepare('UPDATE proactive_digest_queue SET consumed_at = ? WHERE inbox_item_id = ?').run(now.toISOString(), row.inbox_item_id);
        continue;
      }
      const key = `proactive.digest:${group.workspace_id}:${occurrence}`;
      if (!reserveWorkspaceAttention(group.workspace_id, key, now)) {
        db.prepare('UPDATE proactive_digest_queue SET due_at = ? WHERE workspace_id = ? AND mode = ? AND consumed_at IS NULL').run(nextDigestTime(preferences, new Date(now.getTime() + 60000)).toISOString(), group.workspace_id, group.mode);
        continue;
      }
      const id = randomUUID();
      db.prepare('INSERT INTO proactive_digests(digest_id, workspace_id, occurrence_key, created_at) VALUES (?, ?, ?, ?)').run(id, group.workspace_id, occurrence, now.toISOString());
      for (const item of items) db.prepare('INSERT INTO proactive_digest_members VALUES (?, ?, ?)').run(id, item.id, item.notificationRevision!);
      const notification = persist({ dedupeKey: key, notification: {
        type: 'proactive.insight', target: { kind: 'proactive_digest', digestId: id }, priority: 'normal',
        title: { en: 'Your work digest is ready', zh: '你的工作摘要已就绪' },
        body: { en: `${items.length} updates to review in xopc.`, zh: `有 ${items.length} 项变化，打开 xopc 查看。` }, payload: { digestId: id },
      } });
      if (notification) {
        db.prepare('UPDATE proactive_digests SET notification_id = ? WHERE digest_id = ?').run(notification.id, id);
        notifications.push(notification);
      }
      for (const row of queued) db.prepare('UPDATE proactive_digest_queue SET consumed_at = ? WHERE inbox_item_id = ?').run(now.toISOString(), row.inbox_item_id);
    }
    return notifications;
  });
}
