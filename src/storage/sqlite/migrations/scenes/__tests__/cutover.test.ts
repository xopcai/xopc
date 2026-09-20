import { mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { spawnSync } from 'node:child_process';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { notificationTargetRoute } from '@xopcai/gateway-contract';

import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest, createDevice, upsertKnowledgeSourceItems } from '../../../index.js';
import { upsertConnectorInstallation, upsertConnectorConnection } from '../../../connector-repository.js';
import { registerNotificationDevice } from '../../../../../notifications/device-store.js';
import { listNotificationEvents } from '../../../../../notifications/store.js';
import { getSqliteDatabase } from '../../../transaction.js';
import { runSceneCutover } from '../cutover.js';
import { assertSceneCutoverReady } from '../journal.js';
import { inspectSceneCutover } from '../preflight.js';
import { restoreSceneCutoverSnapshot } from '../snapshot.js';
import { SceneRepository } from '../../../../../scenes/repository.js';

vi.mock('node:fs/promises', async (original) => {
  const actual = await original<typeof import('node:fs/promises')>();
  return { ...actual, rename: vi.fn(actual.rename) };
});

describe('complete offline scene conversion', () => {
  let directory: string;
  let db: DatabaseSync;
  let mailAccounts: Array<{ followUpId: string; accountId: string }>;
  const owner = { ownerId: 'owner', workspaceId: 'workspace' };
  const timestamp = '2026-09-20T10:00:00Z';
  const config = { gateway: { port: 18790, heartbeat: {
    enabled: true, intervalMs: 1800000, prompt: 'Private prompt', target: 'telegram', targetChatId: '123',
    activeHours: { start: '09:00', end: '21:00', timezone: 'Asia/Shanghai' }, includeSystemPromptSection: false,
  } }, providers: { example: { apiKey: 'private-credential' } } };
  const run = () => runSceneCutover({ db, configPath: join(directory, 'xopc.json'), backupRoot: directory,
    owners: [owner], mailAccounts, heartbeatWorkspaceId: owner.workspaceId,
    checklists: [{ workspaceId: owner.workspaceId, sourcePath: join(directory, 'HEARTBEAT.md') }] });
  beforeEach(async () => {
    vi.mocked(rename).mockReset();
    vi.mocked(rename).mockImplementation((await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')).rename);
    directory = await mkdtemp(join(tmpdir(), 'xopc-complete-cutover-'));
    mailAccounts = [];
    resetXopcDatabaseSingletonForTest(); openXopcDatabase({ path: join(directory, 'xopc.db') }); db = getSqliteDatabase();
    await writeFile(join(directory, 'xopc.json'), JSON.stringify(config));
    await writeFile(join(directory, 'HEARTBEAT.md'), '\ufeff# 私人巡查\r\n  保留所有空白和原文。\r\n');
  });
  afterEach(async () => {
    closeXopcDatabase(); resetXopcDatabaseSingletonForTest();
    await rm(directory, { recursive: true, force: true });
  });

  const seed = () => {
    db.prepare(`INSERT INTO proactive_scenario_subscriptions(subscription_id, scenario_key, workspace_id,
      scope_kind, scope_id, created_at, updated_at) VALUES ('subscription', (SELECT scenario_key FROM proactive_scenarios LIMIT 1),
      'workspace', 'workspace', 'workspace', ?, ?)`).run(timestamp, timestamp);
    db.prepare(`INSERT INTO proactive_prompt_revisions VALUES ('instruction', 'subscription', 1, 'published', 1, ?, 'hash', ?, ?)`)
      .run('Private instructions'.repeat(2000), timestamp, timestamp);
    db.exec("UPDATE proactive_scenario_subscriptions SET active_prompt_revision_id = 'instruction'");
    db.prepare('INSERT INTO proactive_subscription_settings VALUES (?, ?, ?)').run('subscription', '{"enabled":true}', 3);
    db.prepare('INSERT INTO proactive_schedule_state VALUES (?, ?, ?, ?)').run('subscription', timestamp, timestamp, 'old-fingerprint');
    db.prepare(`INSERT INTO proactive_events(event_id, type, schema_version, source_kind, source_id, subject_kind,
      subject_id, actor_kind, workspace_id, occurred_at, observed_at, correlation_id, dedupe_key, sensitivity, payload_json)
      VALUES ('event', 'source.changed', 1, 'connector', 'source', 'email', 'mail', 'system', 'workspace', ?, ?, 'correlation', 'dedupe', 'personal', '{}')`)
      .run(timestamp, timestamp);
    db.prepare(`INSERT INTO proactive_signal_batches(batch_id, subscription_id, scenario_key, scenario_version,
      aggregation_key, window_started_at, window_ends_at, ready_at, status, event_count, created_at, updated_at)
      SELECT 'batch', subscription_id, scenario_key, 1, 'group', ?, ?, ?, 'processed', 1, ?, ?
      FROM proactive_scenario_subscriptions`).run(timestamp, timestamp, timestamp, timestamp, timestamp);
    db.prepare('INSERT INTO proactive_batch_events VALUES (?, ?, ?)').run('batch', 'event', timestamp);
    db.prepare('INSERT INTO proactive_context_snapshots VALUES (?, ?, ?, ?, ?)').run('snapshot', 'batch', '{"private":"evidence"}', '["event"]', timestamp);
    db.prepare(`INSERT INTO proactive_runs(run_id, batch_id, subscription_id, scenario_key, scenario_version, prompt_revision_id,
      context_snapshot_id, status, attempt, started_at, completed_at, updated_at)
      SELECT 'run', 'batch', subscription_id, scenario_key, 1, 'instruction', 'snapshot', 'completed', 1, ?, ?, ?
      FROM proactive_scenario_subscriptions`).run(timestamp, timestamp, timestamp);
    db.prepare(`INSERT INTO proactive_insights(insight_id, run_id, subscription_id, scenario_key, title, summary,
      why_now, impact, recommendation, urgency, confidence, value_score, evidence_ids_json, created_at, artifact_json)
      SELECT 'outcome', 'run', subscription_id, scenario_key, 'Title', 'Private summary', 'Due', 'Impact', 'Review', 'low',
      0.8, 0.8, '["event"]', ?, '{"body":"Private draft"}' FROM proactive_scenario_subscriptions`).run(timestamp);
    db.prepare(`INSERT INTO proactive_inbox_items(inbox_item_id, insight_id, status, created_at, updated_at)
      VALUES ('card', 'outcome', 'read', ?, ?)`).run(timestamp, timestamp);
    db.prepare('INSERT INTO proactive_decisions VALUES (?, ?, ?, ?, ?)').run('decision', 'card', 'approve', 'User choice', timestamp);
    db.prepare('INSERT INTO proactive_feedback VALUES (?, ?, ?, ?, ?)').run('feedback', 'card', 'useful', 'Useful', timestamp);
    db.prepare('INSERT INTO proactive_instruction_feedback VALUES (?, ?, ?, ?, ?)').run('feedback-instruction', 'card', 'instruction', 'Keep short', timestamp);
    db.prepare('INSERT INTO proactive_card_actions VALUES (?, ?, ?, ?)').run('request', 'card', '{"action":"approve"}', '{"ok":true}');
    db.prepare('INSERT INTO proactive_card_review_state VALUES (?, ?)').run('card', timestamp);
    db.prepare(`INSERT INTO heartbeat_checks(id, workspace_id, started_at, completed_at, status, content, delivery_status, expires_at)
      VALUES ('check', 'workspace', ?, ?, 'prepared', 'Private check', 'cancelled', ?)`).run(timestamp, timestamp, timestamp);
  };

  const seedMail = () => {
    upsertConnectorInstallation({ id: 'mail-installation', connectorId: 'gmail', principalId: owner.ownerId,
      enabled: true, allowedAgentIds: [], maxScope: 'read', confirmationPolicy: 'writes', selectedAccountIds: null });
    const connection = upsertConnectorConnection({ id: 'mail', installationId: 'mail-installation', connectorId: 'gmail',
      provider: 'composio', principalId: owner.ownerId, providerConnectionId: 'fixture-mail', identity: {}, status: 'active', isDefault: true, metadata: {} });
    const source = upsertKnowledgeSourceItems([{ sourceInstanceId: 'mail-source', collectionScope: 'inbox', externalId: 'first',
      itemType: 'email', occurredAt: timestamp, contentHash: 'revision-1',
      normalizedText: JSON.stringify({ threadId: 'thread-1', content: 'Please confirm a date.', labels: ['INBOX'] }),
      metadata: { workspaceId: owner.workspaceId, connectionId: connection.id }, sensitivity: 'personal', retentionClass: 'bounded',
      synthesisPipeline: 'connected_knowledge', synthesisStatus: 'pending' }]).items[0];
    db.prepare(`INSERT INTO proactive_follow_ups(id, subscription_id, workspace_id, source_item_id, thread_key, instructions,
      due_at, created_at, updated_at) VALUES ('follow', 'subscription', 'workspace', ?, 'thread-1', 'Prepare a draft', ?, ?, ?)`)
      .run(source.id, timestamp, timestamp, timestamp);
    mailAccounts = [{ followUpId: 'follow', accountId: connection.accountId! }];
  };

  const seedNotifications = () => {
    const millis = Date.parse(timestamp);
    for (const [id, target, payload] of [
      ['notification', { kind: 'insight', inboxItemId: 'card' }, { inboxItemId: 'card', insightId: 'outcome', notificationRevision: 1, deliveryChannel: 'browser', deliveryMode: 'auto' }],
      ['digest-notification', { kind: 'proactive_digest', digestId: 'digest' }, { digestId: 'digest' }],
    ] as const) db.prepare(`INSERT INTO notification_events(event_id, dedupe_key, event_type, target_json, priority, title_en, title_zh, payload_json, created_at)
      VALUES (?, ?, 'proactive.insight', ?, 'normal', 'Update', '更新', ?, ?)`).run(id, id, JSON.stringify(target), JSON.stringify(payload), millis);
    db.exec("INSERT INTO proactive_web_push_keys VALUES (1, 'original-public-key', 'original-private-key')");
    const subscription = { endpoint: 'https://fcm.googleapis.com/fcm/send/fixture', expirationTime: null,
      keys: { auth: 'a'.repeat(22), p256dh: 'p'.repeat(87) } };
    db.prepare('INSERT INTO proactive_web_push_subscriptions VALUES (?, ?, ?, ?, ?, ?)')
      .run('browser', 'workspace', subscription.endpoint, JSON.stringify(subscription), 'zh', timestamp);
    db.prepare(`INSERT INTO proactive_web_push_deliveries(notification_id, subscription_id, inbox_item_id, notification_revision,
      status, attempt, next_attempt_at) VALUES ('notification', 'browser', 'card', 1, 'sent', 2, ?)`).run(millis);
    db.prepare(`INSERT INTO proactive_channel_deliveries(notification_id, workspace_id, target_json, status, attempt, next_attempt_at,
      provider_message_id) VALUES ('notification', 'workspace', '{"chatId":"123","publicUrl":"https://console.example.com"}', 'sent', 1, ?, 'receipt-42')`).run(millis);
    db.prepare(`INSERT INTO proactive_delivery_outbox(delivery_id, inbox_item_id, status, next_attempt_at, created_at, delivered_at, updated_at)
      VALUES ('outbox', 'card', 'delivered', ?, ?, ?, ?)`).run(timestamp, timestamp, timestamp, timestamp);
    db.prepare('INSERT INTO proactive_notification_budget VALUES (?, ?, ?, ?)').run('budget-key', 'workspace', '2026-09-20', timestamp);
    db.prepare('INSERT INTO proactive_digests VALUES (?, ?, ?, ?, ?)').run('digest', 'workspace', 'daily:2026-09-20', timestamp, 'digest-notification');
    db.exec("INSERT INTO proactive_digest_members VALUES ('digest', 'card', 1)");
    db.prepare('INSERT INTO proactive_digest_queue VALUES (?, ?, ?, ?, ?, ?)').run('card', 'workspace', 1, 'daily', timestamp, null);
    db.prepare('INSERT INTO proactive_delivery_decisions VALUES (?, ?, ?, ?)').run('decision-key', 'workspace', 'immediate', timestamp);
    db.prepare('INSERT INTO proactive_push_probes VALUES (?, ?, ?, ?, ?, ?, ?)').run('probe', 'workspace', 'browser', 'opened', millis, millis + 5, null);
    db.exec("INSERT INTO proactive_preferences VALUES ('workspace', '{\"notificationsMuted\":true}', 1)");
    db.prepare('INSERT INTO proactive_presence VALUES (?, ?, ?, ?, ?, ?)').run('workspace', 'client', 'web', millis + 10000, 'card', 1);
    db.prepare('INSERT INTO notification_acknowledgements VALUES (?, ?, ?, ?)').run('notification', 'client', 'web', millis);
    createDevice({ id: 'device', displayName: 'Fixture', platform: 'ios', publicKeyJwk: { kty: 'EC' }, scopes: ['notifications.self'] });
    registerNotificationDevice({ deviceId: 'device', platform: 'ios', pushToken: 'ExponentPushToken[fixture]', permissions: 'granted', locale: 'zh' });
    db.prepare(`INSERT INTO notification_deliveries(event_id, device_id, status, next_attempt_at, provider_ticket_id, updated_at)
      VALUES ('notification', 'device', 'accepted', ?, 'mobile-receipt', ?)`).run(millis, millis);
  };

  it('converts the production schema, preserves private instructions and reconciles every table before removing it', async () => {
    seed(); seedMail(); seedNotifications();
    const inventory = inspectSceneCutover(db);
    expect(inventory.tables.every((table) => table.rows > 0)).toBe(true);
    const result = await run();
    expect(inspectSceneCutover(db).tables).toEqual([]);
    expect(() => assertSceneCutoverReady(db)).not.toThrow();
    expect(db.prepare('SELECT count(*) AS n FROM scene_cutover_counts').get()?.n).toBe(inventory.tables.length);
    for (const table of inventory.tables) expect(db.prepare('SELECT * FROM scene_cutover_counts WHERE source_table = ?').get(table.name))
      .toEqual({ source_table: table.name, source_rows: table.rows, converted_rows: table.rows });
    expect(db.prepare('SELECT content FROM scene_checklist_imports').get()?.content).toBe(await readFile(join(directory, 'HEARTBEAT.md'), 'utf8'));
    expect(db.prepare('SELECT * FROM scene_checklist_imports').get()).toMatchObject({ prompt: 'Private prompt', enabled: 1,
      interval_ms: 1800000, target: 'telegram', target_chat_id: '123', active_timezone: 'Asia/Shanghai' });
    expect(db.prepare('SELECT content FROM scene_instruction_revisions').get()?.content).toBe('Private instructions'.repeat(2000));
    expect(db.prepare('SELECT * FROM scene_runs').all()).toHaveLength(2);
    expect(new SceneRepository(db).claimNext('worker', Date.now())).toBeNull();
    expect(db.prepare("SELECT 1 FROM scene_activations WHERE status <> 'needs_setup'").get()).toBeUndefined();
    expect(db.prepare('SELECT * FROM scene_schedule_cursors').all()).toEqual([]);
    expect(db.prepare('SELECT status FROM notification_result_outbox').all()).toEqual([{ status: 'settled' }]);
    expect(db.prepare('SELECT * FROM notification_dispatches').all()).toHaveLength(2);
    expect(db.prepare('SELECT status, provider_ticket_id FROM notification_deliveries').get()).toEqual({ status: 'accepted', provider_ticket_id: 'mobile-receipt' });
    expect(db.prepare('SELECT count(*) AS n FROM notification_acknowledgements').get()?.n).toBe(1);
    expect(db.prepare('SELECT * FROM scene_work_items').get()).toMatchObject({ id: 'follow', status: 'paused' });
    const events = listNotificationEvents({ since: 0 }).items;
    expect(events.map((event) => event.type).sort()).toEqual(['scene.digest', 'scene.result']);
    expect(events.every((event) => notificationTargetRoute(event.target, 'web').startsWith('/scenes/'))).toBe(true);
    expect(JSON.parse(await readFile(join(directory, 'xopc.json'), 'utf8'))).toEqual({ ...config, gateway: { port: 18790 } });
    expect(JSON.stringify(result)).not.toContain('Private');
    await run();
    expect(db.prepare('SELECT count(*) AS n FROM scene_runs').get()?.n).toBe(2);
    const restored = join(directory, 'restored');
    await restoreSceneCutoverSnapshot(result.snapshotPath, restored);
    const backup = new DatabaseSync(join(restored, 'xopc.db'), { readOnly: true });
    try { expect(inspectSceneCutover(backup)).toEqual(inventory); } finally { backup.close(); }
    expect(await readFile(join(restored, 'checklist-0.md'), 'utf8')).toBe(await readFile(join(directory, 'HEARTBEAT.md'), 'utf8'));
  });

  it('supports a fresh production database and preserves an absent checklist without scheduling anything', async () => {
    await rm(join(directory, 'HEARTBEAT.md'));
    await run();
    expect(db.prepare('SELECT content, content_hash FROM scene_checklist_imports').get()).toEqual({ content: null, content_hash: null });
    expect(new SceneRepository(db).claimNext('worker', Date.now())).toBeNull();
  });

  it('rolls back a late conversion failure and keeps source data and configuration unchanged', async () => {
    seed();
    db.exec("INSERT INTO proactive_preferences VALUES ('workspace', '{\"unknownPreference\":true}', 1)");
    const before = inspectSceneCutover(db);
    await expect(run()).rejects.toThrow();
    expect(inspectSceneCutover(db)).toEqual(before);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name GLOB 'scene_*'").all()).toEqual([]);
    expect(JSON.parse(await readFile(join(directory, 'xopc.json'), 'utf8'))).toEqual(config);
  });

  it('recovers after the DB commit without recreating imported records or reading a changed private file', async () => {
    seed(); vi.mocked(rename).mockRejectedValueOnce(new Error('Injected rename failure'));
    await expect(run()).rejects.toThrow('Injected rename failure');
    const rows = db.prepare('SELECT * FROM scene_activations ORDER BY id').all();
    expect(() => assertSceneCutoverReady(db)).toThrow('recovery');
    closeXopcDatabase(); openXopcDatabase({ path: join(directory, 'xopc.db') }); db = getSqliteDatabase();
    await writeFile(join(directory, 'HEARTBEAT.md'), 'Later user edit');
    await run();
    expect(() => assertSceneCutoverReady(db)).not.toThrow();
    expect(db.prepare('SELECT * FROM scene_activations ORDER BY id').all()).toEqual(rows);
    expect(db.prepare('SELECT content FROM scene_checklist_imports').get()?.content).not.toBe('Later user edit');
  });

  it('rolls back a killed conversion process and safely retries the complete import', async () => {
    seed(); const before = inspectSceneCutover(db);
    closeXopcDatabase();
    const child = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module'], {
      encoding: 'utf8', env: { ...process.env, XOPC_LOG_LEVEL: 'fatal' }, timeout: 20_000,
      input: `import { DatabaseSync } from 'node:sqlite';
        import { commitSceneCutover } from ${JSON.stringify(new URL('../journal.ts', import.meta.url).href)};
        import { convertSceneDatabase } from ${JSON.stringify(new URL('../database.ts', import.meta.url).href)};
        const db = new DatabaseSync(${JSON.stringify(join(directory, 'xopc.db'))});
        await commitSceneCutover({ db, configPath: ${JSON.stringify(join(directory, 'xopc.json'))},
          backupRoot: ${JSON.stringify(directory)}, bindings: [${JSON.stringify(owner)}],
          convert: (db, config, owners) => {
            convertSceneDatabase(db, { config, owners, mailAccounts: [], heartbeatWorkspaceId: 'workspace', checklists: [] });
            process.kill(process.pid, 'SIGKILL');
          }
        });`,
    });
    openXopcDatabase({ path: join(directory, 'xopc.db') }); db = getSqliteDatabase();
    expect(child.signal, child.stderr).toBe('SIGKILL');
    expect(inspectSceneCutover(db)).toEqual(before);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name GLOB 'scene_*'").all()).toEqual([]);
    expect(JSON.parse(await readFile(join(directory, 'xopc.json'), 'utf8'))).toEqual(config);
    await run(); expect(() => assertSceneCutoverReady(db)).not.toThrow();
    expect(db.prepare('SELECT count(*) AS n FROM scene_runs').get()?.n).toBe(2);
  });

  it('refuses unknown heartbeat fields instead of discarding them during config replacement', async () => {
    await writeFile(join(directory, 'xopc.json'), JSON.stringify({ gateway: { heartbeat: { ...config.gateway.heartbeat, customTool: true } } }));
    await expect(run()).rejects.toThrow();
    expect(inspectSceneCutover(db).tables.length).toBeGreaterThan(30);
  });

  it.each([
    "ALTER TABLE proactive_web_push_keys ADD COLUMN future_secret TEXT; UPDATE proactive_web_push_keys SET future_secret = 'private'",
    "UPDATE notification_events SET payload_json = '{\"inboxItemId\":\"other\"}' WHERE event_id = 'notification'",
    "UPDATE notification_events SET target_json = '{\"kind\":\"insight\",\"inboxItemId\":\"missing\"}' WHERE event_id = 'notification'",
    "UPDATE proactive_signal_batches SET scenario_version = 900; UPDATE proactive_runs SET scenario_version = 900",
    "CREATE TABLE external_history(id TEXT REFERENCES proactive_inbox_items(inbox_item_id)); INSERT INTO external_history VALUES ('card')",
    'CREATE VIEW external_history AS SELECT * FROM proactive_inbox_items',
  ])('rejects unmapped data and links before deleting any source table: %s', async (sql) => {
    seed(); seedNotifications(); db.exec(sql);
    const before = inspectSceneCutover(db);
    const events = db.prepare('SELECT * FROM notification_events ORDER BY event_id').all();
    await expect(run()).rejects.toThrow();
    expect(inspectSceneCutover(db)).toEqual(before);
    expect(db.prepare('SELECT * FROM notification_events ORDER BY event_id').all()).toEqual(events);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name GLOB 'scene_*'").all()).toEqual([]);
    expect(JSON.parse(await readFile(join(directory, 'xopc.json'), 'utf8'))).toEqual(config);
  });
});
