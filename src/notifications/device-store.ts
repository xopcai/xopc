import { getSqliteDatabase, runSqliteWriteTransaction } from '../storage/sqlite/transaction.js';

import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  type NotificationDevice,
  type NotificationDevicePlatform,
  type NotificationLanguage,
  type NotificationPermission,
  type NotificationPreferences,
} from './types.js';

const DEVICE_LEASE_MS = 7 * 24 * 60 * 60 * 1_000;

type NotificationDeviceRow = {
  device_id: string;
  platform: string;
  push_token: string;
  enabled: number;
  permissions: string;
  preferences_json: string;
  locale: string;
  app_version: string | null;
  lease_expires_at: number;
  last_seen_at: number;
  created_at: number;
  updated_at: number;
};

function parsePreferences(raw: string): Partial<NotificationPreferences> {
  try {
    const value = JSON.parse(raw) as unknown;
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Partial<NotificationPreferences>
      : {};
  } catch {
    return {};
  }
}

function normalizePreferences(input?: Partial<NotificationPreferences>): NotificationPreferences {
  return {
    chatCompleted: input?.chatCompleted ?? DEFAULT_NOTIFICATION_PREFERENCES.chatCompleted,
    chatFailed: input?.chatFailed ?? DEFAULT_NOTIFICATION_PREFERENCES.chatFailed,
    taskNeedsInput: input?.taskNeedsInput ?? DEFAULT_NOTIFICATION_PREFERENCES.taskNeedsInput,
    taskBlocked: input?.taskBlocked ?? DEFAULT_NOTIFICATION_PREFERENCES.taskBlocked,
    taskFailed: input?.taskFailed ?? DEFAULT_NOTIFICATION_PREFERENCES.taskFailed,
    taskCompleted: input?.taskCompleted ?? DEFAULT_NOTIFICATION_PREFERENCES.taskCompleted,
    automationCompleted: input?.automationCompleted ?? DEFAULT_NOTIFICATION_PREFERENCES.automationCompleted,
    automationFailed: input?.automationFailed ?? DEFAULT_NOTIFICATION_PREFERENCES.automationFailed,
    proactiveInsight: input?.proactiveInsight ?? DEFAULT_NOTIFICATION_PREFERENCES.proactiveInsight,
  };
}

function deviceFromRow(row: NotificationDeviceRow): NotificationDevice {
  return {
    id: row.device_id,
    platform: row.platform === 'android' ? 'android' : 'ios',
    pushToken: row.push_token,
    enabled: row.enabled !== 0,
    permissions: row.permissions === 'granted' || row.permissions === 'denied' ? row.permissions : 'unknown',
    preferences: normalizePreferences(parsePreferences(row.preferences_json)),
    locale: row.locale === 'zh' ? 'zh' : 'en',
    appVersion: row.app_version ?? undefined,
    leaseExpiresAt: row.lease_expires_at,
    lastSeenAt: row.last_seen_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export type RegisterNotificationDeviceInput = {
  deviceId: string;
  platform: NotificationDevicePlatform;
  pushToken: string;
  permissions: NotificationPermission;
  preferences?: Partial<NotificationPreferences>;
  locale: NotificationLanguage;
  appVersion?: string;
};

export function registerNotificationDevice(input: RegisterNotificationDeviceInput): NotificationDevice {
  const now = Date.now();
  const preferences = input.preferences
    ? normalizePreferences(input.preferences)
    : getNotificationDevice(input.deviceId)?.preferences ?? normalizePreferences();
  runSqliteWriteTransaction((db) => {
    db.prepare(
      `DELETE FROM device_push_endpoints
       WHERE push_token = ? AND device_id <> ?`,
    ).run(input.pushToken, input.deviceId);
    db.prepare(
      `INSERT INTO device_push_endpoints (
        device_id, platform, push_token, enabled, permissions, preferences_json,
        locale, app_version, lease_expires_at, last_seen_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(device_id) DO UPDATE SET
        platform = excluded.platform,
        push_token = excluded.push_token,
        enabled = excluded.enabled,
        permissions = excluded.permissions,
        preferences_json = excluded.preferences_json,
        locale = excluded.locale,
        app_version = excluded.app_version,
        lease_expires_at = excluded.lease_expires_at,
        last_seen_at = excluded.last_seen_at,
        updated_at = excluded.updated_at`,
    ).run(
      input.deviceId,
      input.platform,
      input.pushToken,
      input.permissions === 'granted' ? 1 : 0,
      input.permissions,
      JSON.stringify(preferences),
      input.locale,
      input.appVersion?.trim() || null,
      now + DEVICE_LEASE_MS,
      now,
      now,
      now,
    );
  });
  return getNotificationDevice(input.deviceId)!;
}

export function getNotificationDevice(deviceId: string): NotificationDevice | null {
  const row = getSqliteDatabase()
    .prepare('SELECT * FROM device_push_endpoints WHERE device_id = ?')
    .get(deviceId) as NotificationDeviceRow | undefined;
  return row ? deviceFromRow(row) : null;
}

export function listDeliverableNotificationDevices(now = Date.now()): NotificationDevice[] {
  return (getSqliteDatabase().prepare(
    `SELECT * FROM device_push_endpoints
     WHERE enabled = 1 AND permissions = 'granted' AND lease_expires_at > ?
     ORDER BY updated_at DESC`,
  ).all(now) as NotificationDeviceRow[]).map(deviceFromRow);
}

export function updateNotificationDevicePreferences(
  deviceId: string,
  patch: Partial<NotificationPreferences>,
): NotificationDevice | null {
  const current = getNotificationDevice(deviceId);
  if (!current) return null;
  const preferences = normalizePreferences({ ...current.preferences, ...patch });
  runSqliteWriteTransaction((db) => {
    db.prepare('UPDATE device_push_endpoints SET preferences_json = ?, updated_at = ? WHERE device_id = ?')
      .run(JSON.stringify(preferences), Date.now(), deviceId);
  });
  return getNotificationDevice(deviceId);
}

export function removeNotificationDevice(deviceId: string): boolean {
  return runSqliteWriteTransaction((db) =>
    db.prepare('DELETE FROM device_push_endpoints WHERE device_id = ?').run(deviceId).changes > 0,
  );
}

export function disableNotificationDeviceForPushToken(pushToken: string): void {
  runSqliteWriteTransaction((db) => {
    db.prepare('UPDATE device_push_endpoints SET enabled = 0, updated_at = ? WHERE push_token = ?')
      .run(Date.now(), pushToken);
  });
}
