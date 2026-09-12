import {
  ProactivePreferencesSchema, ProactivePreferencesUpdateSchema, ProactiveSubscriptionSettingsSchema,
  type ProactiveLevel, type ProactivePreferences,
} from '@xopcai/gateway-contract';

import { getSqliteDatabase, runSqliteWriteTransaction } from '../../storage/sqlite/transaction.js';

export class ProactiveConflict extends Error {}

type SettingsRow = { settings_json: string; revision: number };
export function subscriptionSettings(id: string) {
  const row = getSqliteDatabase().prepare('SELECT settings_json, revision FROM proactive_subscription_settings WHERE subscription_id = ?').get(id) as SettingsRow | undefined;
  return { ...ProactiveSubscriptionSettingsSchema.parse(row ? JSON.parse(row.settings_json) : {}), revision: row?.revision ?? 0, managed: Boolean(row) };
}

export function proactivePreferences(workspaceId: string): ProactivePreferences {
  const row = getSqliteDatabase().prepare('SELECT preferences_json, revision FROM proactive_preferences WHERE workspace_id = ?').get(workspaceId) as { preferences_json: string; revision: number } | undefined;
  return ProactivePreferencesSchema.parse(row ? { ...JSON.parse(row.preferences_json), revision: row.revision } : {});
}

export function updateProactivePreferences(workspaceId: string, value: unknown): ProactivePreferences {
  const { expectedRevision, ...patch } = ProactivePreferencesUpdateSchema.parse(value);
  return runSqliteWriteTransaction((db) => {
    const current = proactivePreferences(workspaceId);
    if (current.revision !== expectedRevision) throw new ProactiveConflict('Preferences changed; refresh and try again');
    const next = ProactivePreferencesSchema.parse({ ...current, ...patch, revision: current.revision + 1 });
    if (next.preferredChannel === 'telegram' && !next.telegram) throw new Error('Telegram destination is required');
    db.prepare(`INSERT INTO proactive_preferences(workspace_id, preferences_json, revision) VALUES (?, ?, ?)
      ON CONFLICT(workspace_id) DO UPDATE SET preferences_json = excluded.preferences_json, revision = excluded.revision`)
      .run(workspaceId, JSON.stringify(next), next.revision);
    if (next.timezone !== current.timezone || next.digestHour !== current.digestHour || next.digestMinute !== current.digestMinute) {
      db.prepare("UPDATE proactive_digest_queue SET due_at = ? WHERE workspace_id = ? AND mode = 'daily' AND consumed_at IS NULL").run(nextDigestTime(next, new Date()).toISOString(), workspaceId);
    }
    if (next.level === 'off') {
      db.prepare('DELETE FROM proactive_digest_queue WHERE workspace_id = ?').run(workspaceId);
      db.prepare(`UPDATE proactive_delivery_outbox SET status = 'delivered', error_message = 'proactive_disabled'
        WHERE status IN ('pending', 'retryable') AND inbox_item_id IN (
          SELECT i.inbox_item_id FROM proactive_inbox_items i JOIN proactive_insights x USING(insight_id)
          JOIN proactive_scenario_subscriptions s USING(subscription_id) WHERE s.workspace_id = ?
        )`).run(workspaceId);
    }
    return next;
  });
}

export function effectiveProactivePolicy(subscriptionId: string, now = new Date()) {
  const sub = getSqliteDatabase().prepare('SELECT workspace_id, enabled FROM proactive_scenario_subscriptions WHERE subscription_id = ?').get(subscriptionId) as { workspace_id: string; enabled: number } | undefined;
  const settings = subscriptionSettings(subscriptionId);
  const preferences = proactivePreferences(sub?.workspace_id ?? 'default');
  const level: ProactiveLevel = preferences.level === 'off' ? 'off' : settings.level ?? preferences.level;
  const enabled = Boolean(sub?.enabled) && level !== 'off'
    && !(preferences.pausedUntil && Date.parse(preferences.pausedUntil) > now.getTime());
  return { enabled, level, settings, preferences, workspaceId: sub?.workspace_id ?? '',
    scanIntervalMinutes: settings.scanIntervalMinutes ?? (level === 'active' ? 30 : level === 'quiet' ? 1440 : 120) };
}

export function localProactiveDay(now: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export function quietHoursEnd(preferences: ProactivePreferences, now: Date): Date | null {
  const { quietStartHour: start, quietEndHour: end, timezone } = preferences;
  const quiet = (at: Date) => {
    const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: '2-digit', hourCycle: 'h23' }).format(at));
    return start !== end && (start < end ? hour >= start && hour < end : hour >= start || hour < end);
  };
  if (!quiet(now)) return null;
  for (let minutes = 1; minutes <= 2880; minutes++) {
    const at = new Date(Math.floor(now.getTime() / 60000) * 60000 + minutes * 60000);
    if (!quiet(at)) return at;
  }
  return new Date(now.getTime() + 86400000);
}

/** Called in the same transaction as notification persistence. Reservations survive retries. */
export function reserveProactiveNotification(subscriptionId: string, dedupeKey: string, now = new Date()): 'allowed' | 'suppressed' | Date {
  return runSqliteWriteTransaction((db) => {
    const policy = effectiveProactivePolicy(subscriptionId, now);
    if (!policy.enabled) return 'suppressed';
    if (!policy.settings.managed && policy.preferences.revision === 0) return 'allowed';
    if (policy.level === 'quiet' || policy.settings.delivery === 'inbox') return 'suppressed';
    const end = quietHoursEnd(policy.preferences, now);
    if (end) return end;
    if (db.prepare('SELECT 1 FROM proactive_notification_budget WHERE dedupe_key = ?').get(dedupeKey)) return 'allowed';
    const day = localProactiveDay(now, policy.preferences.timezone);
    const count = db.prepare('SELECT COUNT(*) AS count FROM proactive_notification_budget WHERE workspace_id = ? AND local_day = ?').get(policy.workspaceId, day) as { count: number };
    if (count.count >= policy.preferences.dailyNotificationLimit) return 'suppressed';
    db.prepare('INSERT INTO proactive_notification_budget(dedupe_key, workspace_id, local_day, created_at) VALUES (?, ?, ?, ?)').run(dedupeKey, policy.workspaceId, day, now.toISOString());
    return 'allowed';
  });
}

export function nextDigestTime(preferences: ProactivePreferences, after: Date): Date {
  const formatter = new Intl.DateTimeFormat('en-GB', { timeZone: preferences.timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const target = preferences.digestHour * 60 + preferences.digestMinute;
  let previousMinute = -1;
  let previousDay = '';
  for (let offset = 0; offset <= 2880; offset++) {
    const date = new Date(Math.floor(after.getTime() / 60000) * 60000 + offset * 60000);
    const parts = formatter.formatToParts(date);
    const minute = Number(parts.find((part) => part.type === 'hour')?.value) * 60 + Number(parts.find((part) => part.type === 'minute')?.value);
    const day = localProactiveDay(date, preferences.timezone);
    if (minute === target || (offset > 0 && previousDay === day && previousMinute < target && minute > target)) return date;
    previousMinute = minute; previousDay = day;
  }
  return new Date(after.getTime() + 86400000);
}
