import { randomUUID } from 'node:crypto';

import {
  ProductNotificationSchema,
  type ProductNotification,
} from '@xopcai/gateway-contract';

import { getSqliteDatabase, runSqliteWriteTransaction } from '../storage/sqlite/transaction.js';

type NotificationEventRow = {
  event_id: string;
  event_type: string;
  target_json: string;
  priority: string;
  title_en: string;
  title_zh: string;
  body_en: string | null;
  body_zh: string | null;
  payload_json: string;
  created_at: number;
};

export type NotificationDelivery = {
  event: ProductNotification;
  deviceId: string;
  pushToken: string;
  locale: 'en' | 'zh';
  attempts: number;
  providerTicketId?: string;
};

type NotificationDeliveryRow = NotificationEventRow & {
  device_id: string;
  push_token: string;
  locale: string;
  attempts: number;
  provider_ticket_id: string | null;
};

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function eventFromRow(row: NotificationEventRow): ProductNotification {
  return ProductNotificationSchema.parse({
    schemaVersion: 1,
    id: row.event_id,
    type: row.event_type,
    target: parseJson(row.target_json),
    priority: row.priority,
    title: { en: row.title_en, zh: row.title_zh },
    ...(row.body_en && row.body_zh ? { body: { en: row.body_en, zh: row.body_zh } } : {}),
    payload: parseJson(row.payload_json),
    createdAt: row.created_at,
  });
}

function deliveryFromRow(row: NotificationDeliveryRow): NotificationDelivery {
  return {
    event: eventFromRow(row),
    deviceId: row.device_id,
    pushToken: row.push_token,
    locale: row.locale === 'zh' ? 'zh' : 'en',
    attempts: row.attempts,
    ...(row.provider_ticket_id ? { providerTicketId: row.provider_ticket_id } : {}),
  };
}

export function createNotificationEvent(input: {
  dedupeKey: string;
  notification: Omit<ProductNotification, 'id' | 'createdAt' | 'schemaVersion'>;
  deviceIds: string[];
  createdAt?: number;
}): { notification: ProductNotification; created: boolean } {
  const id = randomUUID();
  const createdAt = input.createdAt ?? Date.now();
  const created = runSqliteWriteTransaction((db) => {
    const inserted = db.prepare(
      `INSERT OR IGNORE INTO notification_events (
        event_id, dedupe_key, event_type, target_json, priority,
        title_en, title_zh, body_en, body_zh, payload_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.dedupeKey,
      input.notification.type,
      JSON.stringify(input.notification.target),
      input.notification.priority,
      input.notification.title.en,
      input.notification.title.zh,
      input.notification.body?.en ?? null,
      input.notification.body?.zh ?? null,
      JSON.stringify(input.notification.payload),
      createdAt,
    ).changes > 0;
    if (inserted) {
      const enqueue = db.prepare(
        `INSERT INTO notification_deliveries (
          event_id, device_id, status, next_attempt_at, updated_at
        ) VALUES (?, ?, 'pending', ?, ?)`,
      );
      for (const deviceId of input.deviceIds) enqueue.run(id, deviceId, createdAt, createdAt);
    }
    return inserted;
  });
  const row = getSqliteDatabase().prepare(
    'SELECT * FROM notification_events WHERE dedupe_key = ?',
  ).get(input.dedupeKey) as NotificationEventRow;
  return { notification: eventFromRow(row), created };
}

export function listNotificationEvents(options: {
  afterId?: string;
  since?: number;
  limit?: number;
} = {}): { items: ProductNotification[]; nextCursor: string | null } {
  const limit = Math.max(1, Math.min(100, options.limit ?? 50));
  const after = options.afterId
    ? getSqliteDatabase().prepare(
      'SELECT created_at, event_id FROM notification_events WHERE event_id = ?',
    ).get(options.afterId) as { created_at: number; event_id: string } | undefined
    : undefined;
  const rows = (after
    ? getSqliteDatabase().prepare(
      `SELECT * FROM notification_events
       WHERE created_at > ? OR (created_at = ? AND event_id > ?)
       ORDER BY created_at, event_id LIMIT ?`,
    ).all(after.created_at, after.created_at, after.event_id, limit)
    : getSqliteDatabase().prepare(
      `SELECT * FROM notification_events WHERE created_at >= ?
       ORDER BY created_at, event_id LIMIT ?`,
    ).all(options.since ?? Date.now(), limit)) as NotificationEventRow[];
  const items = rows.map(eventFromRow);
  return { items, nextCursor: items.at(-1)?.id ?? null };
}

export function acknowledgeNotification(
  eventId: string,
  consumerId: string,
  surface: 'web' | 'electron' | 'mobile',
): boolean {
  const exists = getSqliteDatabase().prepare(
    'SELECT 1 FROM notification_events WHERE event_id = ?',
  ).get(eventId);
  if (!exists) return false;
  runSqliteWriteTransaction((db) => {
    db.prepare(
      `INSERT INTO notification_acknowledgements (
        event_id, consumer_id, surface, acknowledged_at
      ) VALUES (?, ?, ?, ?)
      ON CONFLICT(event_id, consumer_id) DO UPDATE SET
        surface = excluded.surface,
        acknowledged_at = excluded.acknowledged_at`,
    ).run(eventId, consumerId, surface, Date.now());
  });
  return true;
}

const DELIVERY_JOIN = `
  SELECT e.*, d.device_id, d.attempts, d.provider_ticket_id,
         n.push_token, n.locale
  FROM notification_deliveries d
  JOIN notification_events e ON e.event_id = d.event_id
  JOIN notification_devices n ON n.device_id = d.device_id
`;

export function listDueNotificationDeliveries(
  status: 'pending' | 'accepted',
  now = Date.now(),
  limit = 100,
): NotificationDelivery[] {
  return (getSqliteDatabase().prepare(
    `${DELIVERY_JOIN}
     WHERE d.status = ? AND d.next_attempt_at <= ?
       AND n.enabled = 1 AND n.permissions = 'granted' AND n.lease_expires_at > ?
     ORDER BY d.next_attempt_at LIMIT ?`,
  ).all(status, now, now, Math.max(1, Math.min(1_000, limit))) as NotificationDeliveryRow[])
    .map(deliveryFromRow);
}

export function markNotificationDeliveryAccepted(
  eventId: string,
  deviceId: string,
  ticketId: string,
  receiptAt: number,
): void {
  runSqliteWriteTransaction((db) => {
    db.prepare(
      `UPDATE notification_deliveries
       SET status = 'accepted', attempts = attempts + 1, provider_ticket_id = ?,
           next_attempt_at = ?, last_error = NULL, updated_at = ?
       WHERE event_id = ? AND device_id = ?`,
    ).run(ticketId, receiptAt, Date.now(), eventId, deviceId);
  });
}

export function markNotificationDeliveryDelivered(eventId: string, deviceId: string): void {
  runSqliteWriteTransaction((db) => {
    db.prepare(
      `UPDATE notification_deliveries
       SET status = 'delivered', last_error = NULL, updated_at = ?
       WHERE event_id = ? AND device_id = ?`,
    ).run(Date.now(), eventId, deviceId);
  });
}

export function markNotificationDeliveryDead(eventId: string, deviceId: string, error: string): void {
  runSqliteWriteTransaction((db) => {
    db.prepare(
      `UPDATE notification_deliveries
       SET status = 'dead', attempts = attempts + 1, last_error = ?, updated_at = ?
       WHERE event_id = ? AND device_id = ?`,
    ).run(error.slice(0, 500), Date.now(), eventId, deviceId);
  });
}

export function rescheduleNotificationDelivery(
  eventId: string,
  deviceId: string,
  status: 'pending' | 'accepted',
  nextAttemptAt: number,
  error: string,
): void {
  runSqliteWriteTransaction((db) => {
    db.prepare(
      `UPDATE notification_deliveries
       SET status = ?, attempts = attempts + 1, next_attempt_at = ?, last_error = ?, updated_at = ?
       WHERE event_id = ? AND device_id = ?`,
    ).run(status, nextAttemptAt, error.slice(0, 500), Date.now(), eventId, deviceId);
  });
}

export function notificationDeliveryMetrics(): {
  pending: number;
  accepted: number;
  delivered: number;
  dead: number;
  due: number;
  devices: { deliverable: number; expired: number; disabled: number };
  oldestPendingAt: number | null;
  latestError: { eventId: string; deviceId: string; message: string; updatedAt: number } | null;
} {
  const rows = getSqliteDatabase().prepare(
    'SELECT status, COUNT(*) AS count FROM notification_deliveries GROUP BY status',
  ).all() as Array<{ status: string; count: number }>;
  const counts = Object.fromEntries(rows.map((row) => [row.status, row.count])) as Record<string, number>;
  const now = Date.now();
  const due = getSqliteDatabase().prepare(
    `SELECT COUNT(*) AS count FROM notification_deliveries
     WHERE status IN ('pending', 'accepted') AND next_attempt_at <= ?`,
  ).get(now) as { count: number };
  const devices = getSqliteDatabase().prepare(
    `SELECT
       SUM(CASE WHEN enabled = 1 AND permissions = 'granted' AND lease_expires_at > ? THEN 1 ELSE 0 END) AS deliverable,
       SUM(CASE WHEN enabled = 1 AND lease_expires_at <= ? THEN 1 ELSE 0 END) AS expired,
       SUM(CASE WHEN enabled = 0 OR permissions <> 'granted' THEN 1 ELSE 0 END) AS disabled
     FROM notification_devices`,
  ).get(now, now) as { deliverable: number | null; expired: number | null; disabled: number | null };
  const oldest = getSqliteDatabase().prepare(
    `SELECT MIN(next_attempt_at) AS value FROM notification_deliveries
     WHERE status IN ('pending', 'accepted')`,
  ).get() as { value: number | null };
  const latestError = getSqliteDatabase().prepare(
    `SELECT event_id, device_id, last_error, updated_at
     FROM notification_deliveries WHERE last_error IS NOT NULL
     ORDER BY updated_at DESC LIMIT 1`,
  ).get() as {
    event_id: string;
    device_id: string;
    last_error: string;
    updated_at: number;
  } | undefined;
  return {
    pending: counts.pending ?? 0,
    accepted: counts.accepted ?? 0,
    delivered: counts.delivered ?? 0,
    dead: counts.dead ?? 0,
    due: due.count,
    devices: {
      deliverable: devices.deliverable ?? 0,
      expired: devices.expired ?? 0,
      disabled: devices.disabled ?? 0,
    },
    oldestPendingAt: oldest.value,
    latestError: latestError
      ? {
          eventId: latestError.event_id,
          deviceId: latestError.device_id,
          message: latestError.last_error,
          updatedAt: latestError.updated_at,
        }
      : null,
  };
}

export function expireUndeliverableNotificationDeliveries(now = Date.now()): number {
  return Number(runSqliteWriteTransaction((db) => db.prepare(
    `UPDATE notification_deliveries
     SET status = 'dead', last_error = 'Device registration is disabled or expired', updated_at = ?
     WHERE status IN ('pending', 'accepted')
       AND EXISTS (
         SELECT 1 FROM notification_devices n
         WHERE n.device_id = notification_deliveries.device_id
           AND (n.enabled = 0 OR n.permissions <> 'granted' OR n.lease_expires_at <= ?)
       )`,
  ).run(now, now).changes));
}

export function pruneNotificationEvents(before: number): number {
  return Number(runSqliteWriteTransaction((db) => db.prepare(
    `DELETE FROM notification_events
     WHERE created_at < ?
       AND NOT EXISTS (
         SELECT 1 FROM notification_deliveries d
         WHERE d.event_id = notification_events.event_id
           AND d.status IN ('pending', 'accepted')
       )`,
  ).run(before).changes));
}
