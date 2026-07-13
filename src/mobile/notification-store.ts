import { randomUUID } from 'node:crypto';

import { getSqliteDatabase, runSqliteWriteTransaction } from '../storage/sqlite/transaction.js';

import {
  DEFAULT_MOBILE_NOTIFICATION_PREFERENCES,
  type MobileActivityEvent,
  type MobileDevice,
  type MobileNotificationPermission,
  type MobileNotificationPreferences,
  type MobilePlatform,
} from './notification-types.js';

type MobileDeviceRow = {
  device_id: string;
  platform: string;
  push_token: string;
  enabled: number;
  permissions: string;
  preferences_json: string;
  app_version: string | null;
  last_seen_at: number;
  created_at: number;
  updated_at: number;
};

type MobileActivityEventRow = {
  event_id: string;
  event_type: MobileActivityEvent['type'];
  entity_kind: MobileActivityEvent['entity']['kind'];
  entity_id: string;
  priority: MobileActivityEvent['priority'];
  title: string;
  body: string | null;
  deep_link: string;
  payload_json: string;
  created_at: number;
};

function parseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function normalizePreferences(input?: Partial<MobileNotificationPreferences>): MobileNotificationPreferences {
  return {
    needsInput: input?.needsInput ?? DEFAULT_MOBILE_NOTIFICATION_PREFERENCES.needsInput,
    failed: input?.failed ?? DEFAULT_MOBILE_NOTIFICATION_PREFERENCES.failed,
    completed: input?.completed ?? DEFAULT_MOBILE_NOTIFICATION_PREFERENCES.completed,
    automationFailed: input?.automationFailed ?? DEFAULT_MOBILE_NOTIFICATION_PREFERENCES.automationFailed,
  };
}

function deviceFromRow(row: MobileDeviceRow): MobileDevice {
  return {
    id: row.device_id,
    platform: row.platform === 'android' ? 'android' : 'ios',
    pushToken: row.push_token,
    enabled: row.enabled !== 0,
    permissions: row.permissions === 'granted' || row.permissions === 'denied' ? row.permissions : 'unknown',
    preferences: normalizePreferences(parseJson<Partial<MobileNotificationPreferences>>(row.preferences_json, {})),
    appVersion: row.app_version ?? undefined,
    lastSeenAt: row.last_seen_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function activityFromRow(row: MobileActivityEventRow): MobileActivityEvent {
  return {
    id: row.event_id,
    type: row.event_type,
    entity: { kind: row.entity_kind, id: row.entity_id },
    priority: row.priority,
    title: row.title,
    body: row.body ?? undefined,
    deepLink: row.deep_link,
    payload: parseJson<Record<string, unknown>>(row.payload_json, {}),
    createdAt: row.created_at,
  };
}

export type RegisterMobileDeviceInput = {
  id: string;
  platform: MobilePlatform;
  pushToken: string;
  permissions: MobileNotificationPermission;
  preferences?: Partial<MobileNotificationPreferences>;
  appVersion?: string;
};

export function registerMobileDevice(input: RegisterMobileDeviceInput): MobileDevice {
  const now = Date.now();
  const preferences = input.preferences
    ? normalizePreferences(input.preferences)
    : getMobileDevice(input.id)?.preferences ?? normalizePreferences();
  runSqliteWriteTransaction((db) => {
    // An Expo token can rotate or be restored onto a new installation id. Keep one
    // active device record per token so the unique index cannot reject a re-register.
    db.prepare(
      `DELETE FROM mobile_devices
       WHERE push_provider = 'expo' AND push_token = ? AND device_id <> ?`,
    ).run(input.pushToken, input.id);
    db.prepare(
      `INSERT INTO mobile_devices (
        device_id, platform, push_token, permissions, preferences_json,
        app_version, last_seen_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(device_id) DO UPDATE SET
        platform = excluded.platform,
        push_token = excluded.push_token,
        enabled = 1,
        permissions = excluded.permissions,
        preferences_json = excluded.preferences_json,
        app_version = excluded.app_version,
        last_seen_at = excluded.last_seen_at,
        updated_at = excluded.updated_at`,
    ).run(
      input.id,
      input.platform,
      input.pushToken,
      input.permissions,
      JSON.stringify(preferences),
      input.appVersion?.trim() || null,
      now,
      now,
      now,
    );
  });
  return getMobileDevice(input.id)!;
}

export function getMobileDevice(deviceId: string): MobileDevice | null {
  const row = getSqliteDatabase()
    .prepare(`SELECT * FROM mobile_devices WHERE device_id = ?`)
    .get(deviceId) as MobileDeviceRow | undefined;
  return row ? deviceFromRow(row) : null;
}

export function listEnabledMobileDevices(): MobileDevice[] {
  return (getSqliteDatabase()
    .prepare(`SELECT * FROM mobile_devices WHERE enabled = 1 AND permissions = 'granted' ORDER BY updated_at DESC`)
    .all() as MobileDeviceRow[]).map(deviceFromRow);
}

export function updateMobileDevicePreferences(
  deviceId: string,
  patch: Partial<MobileNotificationPreferences>,
): MobileDevice | null {
  const current = getMobileDevice(deviceId);
  if (!current) return null;
  const preferences = normalizePreferences({ ...current.preferences, ...patch });
  runSqliteWriteTransaction((db) => {
    db.prepare(`UPDATE mobile_devices SET preferences_json = ?, updated_at = ? WHERE device_id = ?`)
      .run(JSON.stringify(preferences), Date.now(), deviceId);
  });
  return getMobileDevice(deviceId);
}

export function removeMobileDevice(deviceId: string): boolean {
  return runSqliteWriteTransaction((db) =>
    db.prepare(`DELETE FROM mobile_devices WHERE device_id = ?`).run(deviceId).changes > 0,
  );
}

export function disableMobileDeviceForPushToken(pushToken: string): void {
  runSqliteWriteTransaction((db) => {
    db.prepare(`UPDATE mobile_devices SET enabled = 0, updated_at = ? WHERE push_token = ?`)
      .run(Date.now(), pushToken);
  });
}

export type CreateMobileActivityEventInput = Omit<MobileActivityEvent, 'id' | 'createdAt'> & {
  id?: string;
  createdAt?: number;
};

export function createMobileActivityEvent(input: CreateMobileActivityEventInput): MobileActivityEvent {
  const event: MobileActivityEvent = {
    ...input,
    id: input.id ?? randomUUID(),
    createdAt: input.createdAt ?? Date.now(),
  };
  runSqliteWriteTransaction((db) => {
    db.prepare(
      `INSERT INTO mobile_activity_events (
        event_id, event_type, entity_kind, entity_id, priority, title, body,
        deep_link, payload_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      event.id,
      event.type,
      event.entity.kind,
      event.entity.id,
      event.priority,
      event.title,
      event.body ?? null,
      event.deepLink,
      JSON.stringify(event.payload),
      event.createdAt,
    );
  });
  return event;
}

export function listMobileActivityEvents(options?: { cursor?: number; limit?: number }): {
  items: MobileActivityEvent[];
  nextCursor: number | null;
} {
  const limit = Math.max(1, Math.min(100, options?.limit ?? 50));
  const cursor = options?.cursor;
  const rows = (cursor == null
    ? getSqliteDatabase().prepare(`SELECT * FROM mobile_activity_events ORDER BY created_at DESC LIMIT ?`).all(limit)
    : getSqliteDatabase().prepare(`SELECT * FROM mobile_activity_events WHERE created_at < ? ORDER BY created_at DESC LIMIT ?`).all(cursor, limit)
  ) as MobileActivityEventRow[];
  const items = rows.map(activityFromRow);
  return { items, nextCursor: items.length === limit ? items[items.length - 1]!.createdAt : null };
}

export function acknowledgeMobileActivityEvent(eventId: string, deviceId: string): boolean {
  if (!getMobileDevice(deviceId)) return false;
  const exists = getSqliteDatabase()
    .prepare(`SELECT 1 FROM mobile_activity_events WHERE event_id = ?`)
    .get(eventId);
  if (!exists) return false;
  runSqliteWriteTransaction((db) => {
    db.prepare(
      `INSERT OR REPLACE INTO mobile_activity_acknowledgements (event_id, device_id, acknowledged_at)
       VALUES (?, ?, ?)`,
    ).run(eventId, deviceId, Date.now());
  });
  return true;
}
