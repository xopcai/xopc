import type { DatabaseSync, SQLInputValue } from 'node:sqlite';

import { z } from 'zod';

import { allowedPushEndpoint, sceneContentHash } from './targetContract.js';
import { resolveSceneCutoverBindings, type SceneCutoverBindings } from './bindings.js';
import { resolveScenePresentationBindings } from './presentationBindings.js';

type Row = Record<string, SQLInputValue>;
const notificationTables = [
  'proactive_web_push_keys', 'proactive_web_push_subscriptions', 'proactive_web_push_deliveries',
  'proactive_channel_deliveries', 'proactive_delivery_outbox', 'proactive_notification_budget',
  'proactive_digests', 'proactive_digest_members', 'proactive_digest_queue',
  'proactive_delivery_decisions', 'proactive_push_probes',
] as const;

const sourceColumns: Record<typeof notificationTables[number], string> = {
  proactive_web_push_keys: 'id public_key private_key',
  proactive_web_push_subscriptions: 'id workspace_id endpoint subscription_json language created_at',
  proactive_web_push_deliveries: 'notification_id subscription_id inbox_item_id notification_revision status attempt next_attempt_at lease_until last_error',
  proactive_channel_deliveries: 'notification_id workspace_id target_json status attempt next_attempt_at lease_until provider_message_id last_error',
  proactive_delivery_outbox: 'delivery_id inbox_item_id status attempt next_attempt_at lease_expires_at error_message created_at delivered_at updated_at',
  proactive_notification_budget: 'dedupe_key workspace_id local_day created_at',
  proactive_digests: 'digest_id workspace_id occurrence_key created_at notification_id',
  proactive_digest_members: 'digest_id inbox_item_id notification_revision',
  proactive_digest_queue: 'inbox_item_id workspace_id notification_revision mode due_at consumed_at',
  proactive_delivery_decisions: 'notification_key workspace_id outcome created_at',
  proactive_push_probes: 'id workspace_id subscription_id status created_at opened_at error',
};

const subscriptionSchema = z.strictObject({
  endpoint: z.string().max(4096).refine(allowedPushEndpoint), expirationTime: z.number().int().nonnegative().nullable().optional(),
  keys: z.strictObject({ auth: z.string().regex(/^[A-Za-z0-9_-]{22}$/), p256dh: z.string().regex(/^[A-Za-z0-9_-]{87}$/) }),
});
const telegramSchema = z.strictObject({
  chatId: z.string().regex(/^-?[0-9]{1,20}$/), accountId: z.string().min(1).max(100).optional(),
  publicUrl: z.string().url().refine((value) => { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash; }),
});

function text(row: Row, key: string): string {
  if (typeof row[key] !== 'string' || !row[key]) throw new Error(`Invalid notification field: ${key}`);
  return row[key];
}
function number(row: Row, key: string): number {
  if (typeof row[key] !== 'number' || !Number.isSafeInteger(row[key]) || row[key] < 0) throw new Error(`Invalid notification field: ${key}`);
  return row[key];
}
function date(row: Row, key: string): number {
  const timestamp = z.string().datetime({ offset: true }).safeParse(text(row, key));
  if (!timestamp.success) throw new Error(`Invalid notification timestamp: ${key}`);
  const value = Date.parse(timestamp.data);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Invalid notification timestamp: ${key}`);
  return value;
}
const nullableDate = (row: Row, key: string) => row[key] === null ? null : date(row, key);

/** Normalizes notification assets and settled history. No transports or old runtime imports. */
export function convertSceneNotifications(db: DatabaseSync, input: {
  owners: SceneCutoverBindings;
  presentations: unknown;
}): Record<typeof notificationTables[number], number> {
  const owners = new Map(resolveSceneCutoverBindings(db, input.owners).map((row) => [row.workspaceId, row.ownerId]));
  const presentations = resolveScenePresentationBindings(db, owners, input.presentations);
  const principal = (row: Row) => {
    const workspaceId = text(row, 'workspace_id');
    const ownerId = owners.get(workspaceId);
    if (!ownerId) throw new Error('Notification conversion requires workspace ownership');
    return { owner_id: ownerId, workspace_id: workspaceId };
  };
  const subject = (row: Row) => {
    const mapped = presentations.get(text(row, 'inbox_item_id'));
    if (!mapped) throw new Error('Notification conversion requires a presentation mapping');
    if (row.workspace_id !== undefined && row.workspace_id !== mapped.workspaceId) throw new Error('Notification subject workspace mismatch');
    return mapped;
  };
  const rows = (table: typeof notificationTables[number]): Row[] => {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all().map((row) => String(row.name)).sort();
    if (columns.join(' ') !== sourceColumns[table].split(' ').sort().join(' ')) throw new Error(`Unreviewed notification schema: ${table}`);
    const result = db.prepare(`SELECT * FROM ${table} LIMIT 100001`).all() as Row[];
    if (result.length > 100_000) throw new Error(`Notification conversion exceeds reviewed limit: ${table}`);
    return result;
  };
  const counts = Object.fromEntries(notificationTables.map((table) => [table, 0])) as Record<typeof notificationTables[number], number>;
  const insert = (table: string, value: Row) => {
    const keys = Object.keys(value);
    db.prepare(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...keys.map((key) => value[key]));
  };
  const copy = (source: typeof notificationTables[number], convert: (row: Row) => void) => {
    for (const row of rows(source)) { convert(row); counts[source]++; }
  };
  const settled = (row: Row, statuses: readonly string[]) => {
    const status = text(row, 'status');
    if (!statuses.includes(status)) throw new Error('Notification delivery requires offline reconciliation');
    if (row.lease_until != null || row.lease_expires_at != null) throw new Error('Notification delivery still has an active lease');
    return status;
  };
  const notificationSubject = (notificationId: string, ownerId: string, workspaceId: string) => {
    const event = db.prepare('SELECT event_type, target_json FROM notification_events WHERE event_id = ?').get(notificationId);
    if (!event || event.event_type !== 'proactive.insight') throw new Error('Unmapped notification event');
    const target = z.discriminatedUnion('kind', [
      z.strictObject({ kind: z.literal('insight'), inboxItemId: z.string().min(1) }),
      z.strictObject({ kind: z.literal('proactive_digest'), digestId: z.string().min(1) }),
    ]).parse(JSON.parse(String(event.target_json)));
    if (target.kind === 'insight') {
      const mapped = presentations.get(target.inboxItemId);
      if (!mapped || mapped.ownerId !== ownerId || mapped.workspaceId !== workspaceId) throw new Error('Notification event crosses ownership or references missing history');
      return mapped.id;
    }
    const digest = db.prepare('SELECT workspace_id FROM proactive_digests WHERE digest_id = ?').get(target.digestId);
    if (!digest || digest.workspace_id !== workspaceId || owners.get(workspaceId) !== ownerId) throw new Error('Notification digest crosses ownership');
    return null;
  };

  db.exec('SAVEPOINT scene_notification_conversion');
  try {
    copy('proactive_web_push_keys', (row) => {
      if (number(row, 'id') !== 1) throw new Error('Invalid browser signing key identity');
      insert('notification_browser_keys', { id: 1, public_key: text(row, 'public_key'), private_key: text(row, 'private_key') });
    });
    copy('proactive_web_push_subscriptions', (row) => {
      const subscription = subscriptionSchema.parse(JSON.parse(text(row, 'subscription_json')));
      if (subscription.endpoint !== text(row, 'endpoint')) throw new Error('Browser subscription endpoint mismatch');
      insert('notification_browser_subscriptions', { id: text(row, 'id'), ...principal(row), endpoint: subscription.endpoint,
        auth_key: subscription.keys.auth, public_key: subscription.keys.p256dh, expires_at: subscription.expirationTime ?? null,
        language: z.enum(['en', 'zh']).parse(row.language), created_at: date(row, 'created_at') });
    });
    copy('proactive_web_push_deliveries', (row) => {
      const status = settled(row, ['sent', 'failed']);
      const subscription = db.prepare('SELECT owner_id, workspace_id FROM notification_browser_subscriptions WHERE id = ?').get(text(row, 'subscription_id'));
      if (!subscription) throw new Error('Browser delivery subscription is missing');
      const mapped = row.inbox_item_id ? subject(row) : undefined;
      if (mapped && (mapped.ownerId !== subscription.owner_id || mapped.workspaceId !== subscription.workspace_id)) throw new Error('Browser delivery crosses ownership');
      const eventSubject = notificationSubject(text(row, 'notification_id'), String(subscription.owner_id), String(subscription.workspace_id));
      if ((mapped?.id ?? null) !== eventSubject) throw new Error('Browser delivery subject differs from its notification');
      insert('notification_dispatches', { id: sceneContentHash(['browser', row.notification_id, row.subscription_id]),
        notification_id: text(row, 'notification_id'), owner_id: String(subscription.owner_id), workspace_id: String(subscription.workspace_id),
        channel: 'browser', destination_id: text(row, 'subscription_id'), destination_json: null, subject_id: mapped?.id ?? null,
        subject_revision: number(row, 'notification_revision'), status: status === 'sent' ? 'accepted' : 'failed',
        attempt: number(row, 'attempt'), next_attempt_at: number(row, 'next_attempt_at'), lease_until: null, provider_message_id: null, last_error: row.last_error });
    });
    copy('proactive_channel_deliveries', (row) => {
      const status = settled(row, ['sent', 'failed', 'cancelled']);
      const target = telegramSchema.parse(JSON.parse(text(row, 'target_json')));
      const scope = principal(row);
      const eventSubject = notificationSubject(text(row, 'notification_id'), scope.owner_id, scope.workspace_id);
      if (status === 'sent' && (typeof row.provider_message_id !== 'string' || !row.provider_message_id)) throw new Error('Channel delivery has no receipt; reconcile before conversion');
      insert('notification_dispatches', { id: sceneContentHash(['telegram', row.notification_id]), notification_id: text(row, 'notification_id'),
        ...scope, channel: 'telegram', destination_id: sceneContentHash([target.accountId ?? null, target.chatId]),
        destination_json: JSON.stringify({ accountId: target.accountId ?? null, chatId: target.chatId, publicUrl: target.publicUrl }),
        subject_id: eventSubject, subject_revision: 1, status: status === 'sent' ? 'accepted' : status,
        attempt: number(row, 'attempt'), next_attempt_at: number(row, 'next_attempt_at'), lease_until: null,
        provider_message_id: row.provider_message_id, last_error: row.last_error });
    });
    copy('proactive_delivery_outbox', (row) => {
      const status = settled(row, ['delivered', 'failed']);
      const mapped = subject(row);
      insert('notification_result_outbox', { id: text(row, 'delivery_id'), owner_id: mapped.ownerId, workspace_id: mapped.workspaceId,
        subject_id: mapped.id, status: status === 'delivered' ? 'settled' : 'failed', attempt: number(row, 'attempt'),
        next_attempt_at: date(row, 'next_attempt_at'), lease_until: null, last_error: row.error_message,
        created_at: date(row, 'created_at'), settled_at: nullableDate(row, 'delivered_at'), updated_at: date(row, 'updated_at') });
    });
    copy('proactive_notification_budget', (row) => insert('notification_attention_budget', {
      dedupe_key: text(row, 'dedupe_key'), ...principal(row), local_day: text(row, 'local_day'), created_at: date(row, 'created_at'),
    }));
    copy('proactive_digests', (row) => {
      const scope = principal(row);
      if (row.notification_id !== null) {
        const id = text(row, 'notification_id');
        notificationSubject(id, scope.owner_id, scope.workspace_id);
        const event = db.prepare('SELECT target_json FROM notification_events WHERE event_id = ?').get(id)!;
        const target = JSON.parse(String(event.target_json));
        if (target.kind !== 'proactive_digest' || target.digestId !== row.digest_id) throw new Error('Digest notification identity mismatch');
      }
      insert('notification_digests', { id: text(row, 'digest_id'), ...scope,
        occurrence_key: text(row, 'occurrence_key'), created_at: date(row, 'created_at'), notification_id: row.notification_id });
    });
    copy('proactive_digest_members', (row) => {
      const mapped = subject(row);
      const digest = db.prepare('SELECT owner_id, workspace_id FROM notification_digests WHERE id = ?').get(text(row, 'digest_id'));
      if (!digest || digest.owner_id !== mapped.ownerId || digest.workspace_id !== mapped.workspaceId) throw new Error('Digest member crosses ownership');
      insert('notification_digest_members', { digest_id: text(row, 'digest_id'), subject_id: mapped.id, subject_revision: number(row, 'notification_revision') });
    });
    copy('proactive_digest_queue', (row) => {
      const mapped = subject(row);
      insert('notification_digest_queue', { subject_id: mapped.id, ...principal(row), subject_revision: number(row, 'notification_revision'),
        mode: z.enum(['daily', 'quiet']).parse(row.mode), due_at: date(row, 'due_at'), consumed_at: nullableDate(row, 'consumed_at'),
        status: row.consumed_at === null ? 'held' : 'consumed' });
    });
    copy('proactive_delivery_decisions', (row) => insert('notification_dispatch_decisions', {
      dedupe_key: text(row, 'notification_key'), ...principal(row), disposition: z.enum(['immediate', 'digest', 'suppressed']).parse(row.outcome), created_at: date(row, 'created_at'),
    }));
    copy('proactive_push_probes', (row) => {
      const scope = principal(row);
      const browser = db.prepare('SELECT owner_id, workspace_id FROM notification_browser_subscriptions WHERE id = ?').get(text(row, 'subscription_id'));
      if (browser && (browser.owner_id !== scope.owner_id || browser.workspace_id !== scope.workspace_id)) throw new Error('Browser probe crosses ownership');
      insert('notification_browser_probes', {
        id: text(row, 'id'), ...scope, subscription_id: text(row, 'subscription_id'), status: settled(row, ['accepted', 'opened', 'failed']),
        created_at: number(row, 'created_at'), opened_at: row.opened_at === null ? null : number(row, 'opened_at'), error: row.error,
      });
    });
    if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Notification conversion broke foreign keys');
    db.exec('RELEASE scene_notification_conversion');
    return counts;
  } catch (error) {
    db.exec('ROLLBACK TO scene_notification_conversion');
    db.exec('RELEASE scene_notification_conversion');
    throw error;
  }
}
