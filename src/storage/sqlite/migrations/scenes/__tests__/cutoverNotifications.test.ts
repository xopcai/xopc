import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { installSceneCutoverSchema } from '../schema.js';
import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../../index.js';
import { getSqliteDatabase } from '../../../transaction.js';
import { convertSceneNotifications } from '../notifications.js';
import { SceneRepository } from '../../../../../scenes/repository.js';
import { familyPlanTemplate } from '../../../../../scenes/templates.js';
import { convertSceneFeedback } from '../feedback.js';
import { SceneInboxService } from '../../../../../scenes/inbox.js';
import { SceneMetrics } from '../../../../../scenes/metrics.js';

describe('notification ledger conversion against the production schema', () => {
  let directory: string;
  let db: DatabaseSync;
  let presentationId: string;
  const principal = { ownerId: 'owner', workspaceId: 'workspace' };
  const timestamp = '2026-09-20T10:00:00.123Z';
  const millis = Date.parse(timestamp);
  const subscription = { endpoint: 'https://fcm.googleapis.com/fcm/send/test', expirationTime: null,
    keys: { auth: 'a'.repeat(22), p256dh: 'p'.repeat(87) } };
  const run = () => convertSceneNotifications(db, { owners: [principal], presentations: [{ inboxItemId: 'card', presentationId }] });

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'xopc-notification-conversion-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(directory, 'xopc.db') });
    db = getSqliteDatabase();
    installSceneCutoverSchema(db);
    const repository = new SceneRepository(db);
    repository.installTemplate(familyPlanTemplate);
    const activation = repository.createActivation(principal, { templateKey: familyPlanTemplate.key, templateVersion: familyPlanTemplate.version,
      goal: 'Family arrangements', scope: { kind: 'personal' }, permissions: { accountIds: [], contextProviders: ['user_notes'], effectHandlers: [] } });
    repository.transitionActivation(principal, activation.id, 1, 'active');
    repository.acceptManualCheck(principal, activation.id, 'check', 'test', millis);
    const claim = repository.claimNext('test', millis)!;
    db.prepare("UPDATE scene_runs SET status = 'succeeded', lease_until = NULL, lease_owner = NULL WHERE id = ?").run(claim.id);
    db.prepare("UPDATE scene_trigger_intents SET status = 'resolved' WHERE id = ?").run(claim.intentId);
    db.prepare("INSERT INTO scene_outcomes VALUES ('imported-outcome', ?, 'artifact', ?, ?)")
      .run(claim.id, JSON.stringify({ kind: 'artifact', summary: 'Plan', evidenceIds: ['note'] }), millis);
    db.prepare("INSERT INTO scene_presentations(id, outcome_id, destination, status, created_at) VALUES ('imported-card', 'imported-outcome', 'inbox', 'unread', ?)").run(millis);
    presentationId = repository.listInbox(principal)[0].id;

    db.prepare(`INSERT INTO proactive_scenarios
      (scenario_key, version, title, description, base_prompt, base_template_version, event_types_json,
      aggregation, debounce_seconds, max_window_seconds, created_at, updated_at)
      VALUES ('conversion', 1, 'Mail', 'Read mail', 'Read only', 1, '[]', 'workspace', 0, 1, ?, ?)`)
      .run(timestamp, timestamp);
    db.prepare(`INSERT INTO proactive_scenario_subscriptions
      (subscription_id, scenario_key, workspace_id, scope_kind, scope_id, created_at, updated_at)
      VALUES ('sub', 'conversion', 'workspace', 'workspace', 'workspace', ?, ?)`).run(timestamp, timestamp);
    db.prepare(`INSERT INTO proactive_signal_batches
      (batch_id, subscription_id, scenario_key, scenario_version, aggregation_key, window_started_at, window_ends_at, ready_at, status, created_at, updated_at)
      VALUES ('batch', 'sub', 'conversion', 1, 'workspace', ?, ?, ?, 'processed', ?, ?)`).run(timestamp, timestamp, timestamp, timestamp, timestamp);
    db.prepare(`INSERT INTO proactive_runs
      (run_id, batch_id, subscription_id, scenario_key, scenario_version, status, started_at, updated_at)
      VALUES ('old-run', 'batch', 'sub', 'conversion', 1, 'completed', ?, ?)`).run(timestamp, timestamp);
    db.prepare(`INSERT INTO proactive_insights
      (insight_id, run_id, subscription_id, scenario_key, title, summary, why_now, impact, recommendation, urgency, confidence, value_score, evidence_ids_json, created_at)
      VALUES ('insight', 'old-run', 'sub', 'conversion', 'Title', 'Summary', 'Reason', 'Impact', 'Suggestion', 'low', 1, 1, '[]', ?)`).run(timestamp);
    db.prepare(`INSERT INTO proactive_inbox_items(inbox_item_id, insight_id, status, created_at, updated_at)
      VALUES ('card', 'insight', 'read', ?, ?)`).run(timestamp, timestamp);
    db.prepare(`INSERT INTO notification_events(event_id, dedupe_key, event_type, target_json, priority, title_en, title_zh, created_at)
      VALUES ('notification', 'stable-dedupe', 'proactive.insight', '{"kind":"insight","inboxItemId":"card"}', 'normal', 'Update', '更新', ?)`).run(millis);
    db.prepare(`INSERT INTO notification_events(event_id, dedupe_key, event_type, target_json, priority, title_en, title_zh, created_at)
      VALUES ('digest-notification', 'digest-dedupe', 'proactive.insight', '{"kind":"proactive_digest","digestId":"digest"}', 'normal', 'Digest', '摘要', ?)`).run(millis);
    db.exec("INSERT INTO proactive_web_push_keys VALUES (1, 'original-public-key', 'original-private-key')");
    db.prepare('INSERT INTO proactive_web_push_subscriptions VALUES (?, ?, ?, ?, ?, ?)')
      .run('browser', 'workspace', subscription.endpoint, JSON.stringify(subscription), 'zh', timestamp);
    db.prepare(`INSERT INTO proactive_web_push_deliveries
      (notification_id, subscription_id, inbox_item_id, notification_revision, status, attempt, next_attempt_at)
      VALUES ('notification', 'browser', 'card', 3, 'sent', 2, ?)`).run(millis);
    db.prepare(`INSERT INTO proactive_channel_deliveries
      (notification_id, workspace_id, target_json, status, attempt, next_attempt_at, provider_message_id)
      VALUES ('notification', 'workspace', '{"chatId":"123","accountId":"bot","publicUrl":"https://console.example.com"}', 'sent', 1, ?, 'receipt-42')`).run(millis);
    db.prepare(`INSERT INTO proactive_delivery_outbox
      (delivery_id, inbox_item_id, status, next_attempt_at, created_at, delivered_at, updated_at, error_message)
      VALUES ('outbox', 'card', 'delivered', ?, ?, ?, ?, 'Suppressed by policy')`).run(timestamp, timestamp, timestamp, timestamp);
    db.prepare('INSERT INTO proactive_notification_budget VALUES (?, ?, ?, ?)').run('original-budget-key', 'workspace', '2026-09-20', timestamp);
    db.prepare('INSERT INTO proactive_digests VALUES (?, ?, ?, ?, ?)').run('digest', 'workspace', 'daily:2026-09-20', timestamp, 'digest-notification');
    db.exec("INSERT INTO proactive_digest_members VALUES ('digest', 'card', 3)");
    db.prepare('INSERT INTO proactive_digest_queue VALUES (?, ?, ?, ?, ?, ?)').run('card', 'workspace', 3, 'daily', timestamp, null);
    db.prepare('INSERT INTO proactive_delivery_decisions VALUES (?, ?, ?, ?)').run('original-decision-key', 'workspace', 'immediate', timestamp);
    db.prepare('INSERT INTO proactive_push_probes VALUES (?, ?, ?, ?, ?, ?, ?)').run('probe', 'workspace', 'browser', 'opened', millis, millis + 5, null);
  });
  afterEach(() => {
    closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); rmSync(directory, { recursive: true, force: true });
  });

  it('preserves assets, receipts, timestamps, budgets and digest membership without sending', () => {
    const counts = run();
    expect(Object.keys(counts)).toHaveLength(11);
    expect(Object.values(counts).every((count) => count === 1)).toBe(true);
    expect(JSON.stringify(counts)).not.toContain('original-private-key');
    expect(db.prepare('SELECT * FROM notification_browser_keys').get()).toMatchObject({ public_key: 'original-public-key', private_key: 'original-private-key' });
    expect(db.prepare('SELECT * FROM notification_browser_subscriptions').get()).toMatchObject({ owner_id: 'owner', workspace_id: 'workspace',
      endpoint: subscription.endpoint, auth_key: subscription.keys.auth, public_key: subscription.keys.p256dh, expires_at: null, created_at: millis });
    const dispatches = db.prepare('SELECT * FROM notification_dispatches ORDER BY channel').all();
    expect(dispatches).toHaveLength(2);
    expect(dispatches[0]).toMatchObject({ channel: 'browser', status: 'accepted', subject_id: presentationId, subject_revision: 3, attempt: 2 });
    expect(dispatches[1]).toMatchObject({ channel: 'telegram', status: 'accepted', provider_message_id: 'receipt-42' });
    expect(db.prepare('SELECT * FROM notification_result_outbox').get()).toMatchObject({ status: 'settled', last_error: 'Suppressed by policy', settled_at: millis });
    expect(db.prepare('SELECT * FROM notification_digest_queue').get()).toMatchObject({ subject_id: presentationId, status: 'held', consumed_at: null });
    expect(db.prepare('SELECT * FROM notification_digest_members').get()).toMatchObject({ digest_id: 'digest', subject_id: presentationId, subject_revision: 3 });
    expect(db.prepare('SELECT * FROM notification_attention_budget').get()).toMatchObject({ dedupe_key: 'original-budget-key', local_day: '2026-09-20', created_at: millis });
    expect(db.prepare('SELECT * FROM notification_browser_probes').get()).toMatchObject({ status: 'opened', opened_at: millis + 5 });
    expect(db.prepare("SELECT dedupe_key FROM notification_events WHERE event_id = 'notification'").get()?.dedupe_key).toBe('stable-dedupe');
    expect(db.prepare('SELECT count(*) AS n FROM proactive_web_push_deliveries').get()?.n).toBe(1);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });

  it.each([
    "UPDATE proactive_web_push_deliveries SET status = 'pending'",
    "UPDATE proactive_channel_deliveries SET status = 'unknown'",
    "UPDATE proactive_channel_deliveries SET provider_message_id = NULL",
    "UPDATE proactive_delivery_outbox SET status = 'retryable'",
    "UPDATE proactive_web_push_deliveries SET lease_until = 1",
    "UPDATE proactive_push_probes SET status = 'sending'",
  ])('rolls back the whole conversion when a delivery needs reconciliation: %s', (sql) => {
    db.exec(sql);
    expect(run).toThrow();
    expect(db.prepare('SELECT * FROM notification_browser_keys').all()).toEqual([]);
    expect(db.prepare('SELECT private_key FROM proactive_web_push_keys').get()?.private_key).toBe('original-private-key');
  });

  it('rejects missing, duplicate and cross-owner presentation mappings', () => {
    expect(() => convertSceneNotifications(db, { owners: [], presentations: [] })).toThrow('ownership');
    expect(() => convertSceneNotifications(db, { owners: [principal], presentations: [] })).toThrow('presentation mapping');
    expect(() => convertSceneNotifications(db, { owners: [principal], presentations: [
      { inboxItemId: 'card', presentationId }, { inboxItemId: 'card', presentationId },
    ] })).toThrow('Duplicate');
    db.exec("UPDATE scene_activations SET owner_id = 'other-owner'");
    expect(run).toThrow('crosses ownership');
  });

  it('rejects browser endpoints that changed inside stored subscription data', () => {
    db.prepare('UPDATE proactive_web_push_subscriptions SET subscription_json = ?')
      .run(JSON.stringify({ ...subscription, endpoint: 'https://localhost/private' }));
    expect(run).toThrow();
    expect(db.prepare('SELECT * FROM notification_browser_subscriptions').all()).toEqual([]);
  });

  it('preserves consumed digests and probes whose browser was later removed', () => {
    db.prepare('UPDATE proactive_digest_queue SET consumed_at = ?').run(timestamp);
    db.exec("UPDATE proactive_push_probes SET subscription_id = 'removed-browser'");
    run();
    expect(db.prepare('SELECT status, consumed_at FROM notification_digest_queue').get()).toMatchObject({ status: 'consumed', consumed_at: millis });
    expect(db.prepare('SELECT subscription_id FROM notification_browser_probes').get()?.subscription_id).toBe('removed-browser');
  });

  it.each(['2026-02-30T10:00:00Z', '2026-09-20', '09/20/2026'])('rejects ambiguous or normalized notification timestamps: %s', (timestamp) => {
    db.prepare('UPDATE proactive_delivery_outbox SET created_at = ?').run(timestamp);
    expect(run).toThrow('Invalid notification timestamp');
    expect(db.prepare('SELECT * FROM notification_dispatches').all()).toEqual([]);
  });

  it('participates in the outer cutover transaction and refuses an accidental second conversion', () => {
    db.exec('BEGIN'); run(); db.exec('ROLLBACK');
    expect(db.prepare('SELECT * FROM notification_dispatches').all()).toEqual([]);
    run();
    expect(run).toThrow('UNIQUE constraint');
    expect(db.prepare('SELECT count(*) AS n FROM notification_dispatches').get()?.n).toBe(2);
  });

  it.each([
    "UPDATE proactive_web_push_deliveries SET inbox_item_id = ''",
    "UPDATE notification_events SET target_json = '{\"kind\":\"insight\",\"inboxItemId\":\"missing-card\"}' WHERE event_id = 'notification'",
    "UPDATE proactive_digests SET notification_id = 'notification'",
  ])('refuses a delivery whose notification graph does not match: %s', (sql) => {
    db.exec(sql);
    expect(run).toThrow();
    expect(db.prepare('SELECT * FROM notification_dispatches').all()).toEqual([]);
  });

  it('preserves every old feedback revision without counting imports as new usefulness', () => {
    db.prepare('INSERT INTO proactive_feedback VALUES (?, ?, ?, ?, ?)').run('feedback-first', 'card', 'useful', 'First judgment', timestamp);
    db.prepare('INSERT INTO proactive_feedback VALUES (?, ?, ?, ?, ?)').run('feedback-second', 'card', 'not_useful', 'Changed my mind', timestamp);
    const input = { owners: [principal], presentations: [{ inboxItemId: 'card', presentationId }] };
    expect(convertSceneFeedback(db, input)).toBe(2);
    expect(db.prepare('SELECT id, rating, revision, origin FROM scene_feedback_history ORDER BY revision').all())
      .toMatchObject([{ id: 'feedback-first', rating: 'useful', revision: 1, origin: 'import' },
        { id: 'feedback-second', rating: 'not_useful', revision: 2, origin: 'import' }]);
    const inbox = new SceneInboxService(db, () => millis + 1);
    expect(inbox.getFeedback(principal, presentationId)).toMatchObject({ rating: 'not_useful', revision: 2, note: 'Changed my mind' });
    const metrics = new SceneMetrics(db, () => millis + 2);
    expect(metrics.forUser(principal).ratedOutcomes).toBe(0);
    inbox.feedback(principal, presentationId, { expectedRevision: 2, rating: 'useful' });
    expect(metrics.forUser(principal).ratedOutcomes).toBe(1);
    expect(db.prepare('SELECT count(*) AS n FROM scene_feedback_history').get()?.n).toBe(3);
    expect(() => convertSceneFeedback(db, input)).toThrow();
    expect(db.prepare('SELECT count(*) AS n FROM scene_feedback_history').get()?.n).toBe(3);
  });

  it('orders historical feedback by actual time rather than timestamp text', () => {
    db.prepare('INSERT INTO proactive_feedback VALUES (?, ?, ?, ?, ?)').run('later', 'card', 'not_useful', '', '2026-09-20T09:00:00Z');
    db.prepare('INSERT INTO proactive_feedback VALUES (?, ?, ?, ?, ?)').run('earlier', 'card', 'useful', '', '2026-09-20T10:00:00+02:00');
    convertSceneFeedback(db, { owners: [principal], presentations: [{ inboxItemId: 'card', presentationId }] });
    expect(db.prepare('SELECT id FROM scene_feedback_history ORDER BY revision').all()).toMatchObject([{ id: 'earlier' }, { id: 'later' }]);
  });

  it('allows a rating correction without truncating a long imported note', () => {
    const note = 'Historical private note. '.repeat(200);
    db.prepare('INSERT INTO proactive_feedback VALUES (?, ?, ?, ?, ?)').run('long-note', 'card', 'not_useful', note, timestamp);
    convertSceneFeedback(db, { owners: [principal], presentations: [{ inboxItemId: 'card', presentationId }] });
    const inbox = new SceneInboxService(db, () => millis + 1);
    inbox.feedback(principal, presentationId, { expectedRevision: 1, rating: 'useful' });
    expect(inbox.getFeedback(principal, presentationId)?.note).toBe(note);
    expect(db.prepare('SELECT note FROM scene_feedback_history WHERE revision = 2').get()?.note).toBe(note);
    inbox.feedback(principal, presentationId, { expectedRevision: 2, rating: 'useful', note: '' });
    expect(inbox.getFeedback(principal, presentationId)?.note).toBe('');
  });

  it('does not replace current user feedback with imported history', () => {
    db.prepare('INSERT INTO proactive_feedback VALUES (?, ?, ?, ?, ?)').run('historical', 'card', 'not_useful', '', timestamp);
    new SceneInboxService(db, () => millis + 1).feedback(principal, presentationId, { expectedRevision: 0, rating: 'useful' });
    expect(() => convertSceneFeedback(db, { owners: [principal], presentations: [{ inboxItemId: 'card', presentationId }] })).toThrow();
    expect(db.prepare('SELECT count(*) AS n FROM scene_feedback_history').get()?.n).toBe(1);
    expect(db.prepare('SELECT rating FROM scene_feedback').get()?.rating).toBe('useful');
  });
});
