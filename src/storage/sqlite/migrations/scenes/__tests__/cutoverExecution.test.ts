import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { installSceneSchema } from '../schema.js';
import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../../index.js';
import { getSqliteDatabase } from '../../../transaction.js';
import { convertSceneExecutionHistory } from '../execution.js';
import { SceneRepository } from '../../../../../scenes/repository.js';
import { familyPlanTemplate } from '../../../../../scenes/templates.js';
import { SceneMetrics } from '../../../../../scenes/metrics.js';
import { convertSceneOutcomeHistory } from '../outcomes.js';
import { convertSceneFeedback } from '../feedback.js';
import { convertSceneNotifications } from '../notifications.js';
import { SceneInboxService } from '../../../../../scenes/inbox.js';
import { convertSceneActivationHistory } from '../activations.js';
import { assertSceneHistoryIntegrity } from '../integrity.js';
import { convertSceneDefinitions } from '../definitions.js';

describe('execution history conversion on the production database schema', () => {
  let directory: string;
  let db: DatabaseSync;
  let activationId: string;
  const principal = { ownerId: 'owner', workspaceId: 'workspace' };
  const timestamp = '2026-09-20T10:00:00Z';
  const now = Date.parse(timestamp);
  const convert = () => convertSceneExecutionHistory(db, { owners: [principal], batches: [{ batchId: 'batch', activationId }] });
  const seedOutcome = () => {
    db.prepare(`INSERT INTO proactive_insights(insight_id, run_id, subscription_id, scenario_key, title, summary, why_now,
      impact, recommendation, urgency, confidence, value_score, evidence_ids_json, created_at, work_done, artifact_json,
      decision_json, proposed_action_json, action_status, action_result_json, disposition, disposition_at, action_updated_at)
      VALUES ('outcome', 'run', 'subscription', 'original-template', 'Title', 'Summary', 'Why now', 'Impact', 'Recommendation',
      'low', 0.8, 0.9, '["event"]', ?, 'Prepared a draft', '{"body":"Private draft"}', '{"question":"Proceed?"}',
      '{"type":"create_project_task","title":"Review"}', 'completed', '{"taskId":"original-task"}', 'show_in_work', ?, ?)`).run(timestamp, timestamp, timestamp);
    db.prepare(`INSERT INTO proactive_inbox_items(inbox_item_id, insight_id, status, created_at, updated_at, revision, notification_revision, correlation_key)
      VALUES ('card', 'outcome', 'read', ?, ?, 4, 3, 'thread:original')`).run(timestamp, timestamp);
    db.prepare('UPDATE proactive_inbox_items SET actionable_until = ?, revision = 5 WHERE inbox_item_id = ?').run('2099-01-01T00:00:00Z', 'card');
    db.prepare('INSERT INTO proactive_decisions VALUES (?, ?, ?, ?, ?)').run('decision', 'card', 'approve', 'Original choice', timestamp);
    db.prepare('INSERT INTO proactive_instruction_feedback VALUES (?, ?, ?, ?, ?)').run('instruction-feedback', 'card', 'instruction', 'Please be concise', timestamp);
    db.exec(`INSERT INTO proactive_card_actions VALUES ('original-request', 'card', '{"action":"approve"}', '{"taskId":"original-task"}')`);
    db.prepare('INSERT INTO proactive_card_review_state VALUES (?, ?)').run('card', timestamp);
    db.prepare('INSERT INTO proactive_feedback VALUES (?, ?, ?, ?, ?)').run('feedback', 'card', 'useful', 'Helpful', timestamp);
  };
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'xopc-execution-conversion-'));
    resetXopcDatabaseSingletonForTest(); openXopcDatabase({ path: join(directory, 'xopc.db') });
    db = getSqliteDatabase(); installSceneSchema(db);
    const repository = new SceneRepository(db); repository.installTemplate(familyPlanTemplate);
    activationId = repository.createActivation(principal, { templateKey: familyPlanTemplate.key, templateVersion: familyPlanTemplate.version,
      goal: 'Help with arrangements', scope: { kind: 'personal' }, permissions: { accountIds: [], contextProviders: [], effectHandlers: [] } }).id;
    db.prepare(`INSERT INTO proactive_scenarios(scenario_key, version, title, description, base_prompt, base_template_version,
      event_types_json, aggregation, debounce_seconds, max_window_seconds, created_at, updated_at)
      VALUES ('original-template', 1, 'Title', 'Description', 'Private instruction', 1, '[]', 'workspace', 0, 60, ?, ?)`).run(timestamp, timestamp);
    db.prepare(`INSERT INTO proactive_scenario_subscriptions(subscription_id, scenario_key, workspace_id, scope_kind, scope_id, created_at, updated_at)
      VALUES ('subscription', 'original-template', 'workspace', 'workspace', 'workspace', ?, ?)`).run(timestamp, timestamp);
    db.prepare(`INSERT INTO proactive_prompt_revisions(revision_id, subscription_id, revision, status, base_template_version,
      user_instructions, content_hash, created_at, published_at) VALUES ('instruction', 'subscription', 1, 'published', 1, 'Private', 'hash', ?, ?)`).run(timestamp, timestamp);
    db.prepare(`INSERT INTO proactive_events(event_id, type, schema_version, source_kind, source_id, device_id, subject_kind, subject_id,
      actor_kind, actor_id, workspace_id, project_id, agent_id, occurred_at, observed_at, correlation_id, causation_id, dedupe_key, sensitivity, payload_json, routed_at)
      VALUES ('event', 'source.changed', 1, 'connector', 'source', 'device', 'email', 'mail', 'integration', 'actor',
      'workspace', NULL, 'agent', ?, ?, 'correlation', 'cause', 'original-dedupe', 'personal', '{"revision":2}', ?)`).run(timestamp, timestamp, timestamp);
    db.prepare(`INSERT INTO proactive_signal_batches(batch_id, subscription_id, scenario_key, scenario_version, aggregation_key,
      window_started_at, window_ends_at, ready_at, status, event_count, created_at, updated_at)
      VALUES ('batch', 'subscription', 'original-template', 1, 'aggregation', ?, ?, ?, 'processed', 1, ?, ?)`).run(timestamp, timestamp, timestamp, timestamp, timestamp);
    db.prepare('INSERT INTO proactive_batch_events VALUES (?, ?, ?)').run('batch', 'event', timestamp);
    db.prepare('INSERT INTO proactive_context_snapshots VALUES (?, ?, ?, ?, ?)')
      .run('snapshot', 'batch', JSON.stringify({ context: 'private context', revision: 2 }), '["event"]', timestamp);
    db.prepare(`INSERT INTO proactive_runs(run_id, batch_id, subscription_id, scenario_key, scenario_version, prompt_revision_id,
      context_snapshot_id, status, attempt, model_ref, raw_output, error_message, started_at, completed_at, updated_at,
      outcome_reason, policy_revision, subscription_revision, policy_snapshot_json, input_tokens, output_tokens, estimated_cost_usd)
      VALUES ('run', 'batch', 'subscription', 'original-template', 1, 'instruction', 'snapshot', 'completed', 3,
      'provider/model', 'original output', NULL, ?, ?, ?, 'valuable', 2, 4, '{"readOnly":true}', 12, 8, 0.02)`).run(timestamp, timestamp, timestamp);
  });
  afterEach(() => { closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); rmSync(directory, { recursive: true, force: true }); });

  it('preserves the complete execution graph without activating work or counting imports', () => {
    expect(convert()).toEqual({ events: 1, batches: 1, memberships: 1, snapshots: 1, runs: 1 });
    expect(db.prepare('SELECT * FROM scene_events').get()).toMatchObject({ id: 'event', owner_id: 'owner', source_event_id: 'original-dedupe', account_id: null, occurred_at: now });
    expect(db.prepare('SELECT * FROM scene_event_details').get()).toMatchObject({ event_id: 'event', actor_id: 'actor', causation_id: 'cause', sensitivity: 'personal', payload_json: '{"revision":2}' });
    expect(db.prepare('SELECT * FROM scene_trigger_intents').get()).toMatchObject({ id: 'batch', event_id: 'event', status: 'resolved' });
    expect(db.prepare('SELECT * FROM scene_intent_events').get()).toMatchObject({ event_id: 'event', intent_id: 'batch', added_at: now });
    expect(db.prepare('SELECT * FROM scene_runs').get()).toMatchObject({ id: 'run', origin: 'import', attempt: 3, status: 'succeeded', lease_until: null });
    expect(db.prepare('SELECT * FROM scene_run_details').get()).toMatchObject({ instruction_revision_id: 'instruction', evidence_snapshot_id: 'snapshot', model_ref: 'provider/model', input_tokens: 12, output_tokens: 8, estimated_cost_usd: 0.02, source_status: 'completed' });
    expect(JSON.parse(String(db.prepare('SELECT content_json FROM scene_evidence_snapshots').get()?.content_json))).toEqual({ context: 'private context', revision: 2 });
    expect(new SceneRepository(db).claimNext('test', now + 1000)).toBeNull();
    expect(new SceneMetrics(db, () => now + 1000).forUser(principal).checks).toBe(0);
    expect(db.prepare('SELECT count(*) AS n FROM proactive_runs').get()?.n).toBe(1);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });

  it('preserves private current definitions and immutable versions outside the public catalog', () => {
    const before = new SceneRepository(db).listTemplates();
    const definitions = Number(db.prepare('SELECT count(*) AS n FROM proactive_scenarios').get()?.n);
    const versions = Number(db.prepare('SELECT count(*) AS n FROM proactive_scenario_versions').get()?.n);
    expect(convertSceneDefinitions(db)).toEqual({ definitions, versions });
    expect(db.prepare("SELECT record_kind, instruction, version FROM scene_definition_history WHERE definition_key = 'original-template' ORDER BY record_kind").all()).toMatchObject([
      { record_kind: 'current', instruction: 'Private instruction', version: 1 },
      { record_kind: 'version', instruction: 'Private instruction', version: 1 },
    ]);
    expect(new SceneRepository(db).listTemplates()).toEqual(before);
    expect(db.prepare('SELECT count(*) AS n FROM proactive_scenarios').get()?.n).toBe(definitions);
    expect(() => convertSceneDefinitions(db)).toThrow();
  });

  it('keeps earlier private revisions when the current definition changes', () => {
    db.exec("UPDATE proactive_scenarios SET version = 2, base_prompt = 'Changed private draft' WHERE scenario_key = 'original-template'");
    const original = String(db.prepare("SELECT base_prompt FROM proactive_scenario_versions WHERE scenario_key = 'original-template' AND version = 1").get()?.base_prompt);
    db.exec('BEGIN'); convertSceneDefinitions(db); db.exec('ROLLBACK');
    expect(db.prepare('SELECT * FROM scene_definition_history').all()).toEqual([]);
    convertSceneDefinitions(db);
    expect(db.prepare("SELECT instruction FROM scene_definition_history WHERE definition_key = 'original-template' AND record_kind = 'current'").get()?.instruction).toBe('Changed private draft');
    expect(db.prepare("SELECT instruction FROM scene_definition_history WHERE definition_key = 'original-template' AND record_kind = 'version' AND version = 1").get()?.instruction).toBe(original);
  });

  it('refuses missing definition history without deleting the current definition', () => {
    db.exec("DROP TRIGGER proactive_scenario_versions_immutable_delete; DELETE FROM proactive_scenario_versions WHERE scenario_key = 'original-template'");
    expect(() => convertSceneDefinitions(db)).toThrow('version is missing');
    expect(db.prepare('SELECT * FROM scene_definition_history').all()).toEqual([]);
    expect(db.prepare("SELECT count(*) AS n FROM proactive_scenarios WHERE scenario_key = 'original-template'").get()?.n).toBe(1);
  });

  it('keeps zero-event batches and unattached snapshots without fabricating source events', () => {
    db.exec("DELETE FROM proactive_batch_events; UPDATE proactive_signal_batches SET event_count = 0");
    db.prepare('INSERT INTO proactive_context_snapshots VALUES (?, ?, ?, ?, ?)').run('unattached', 'batch', '{}', '[]', timestamp);
    expect(convert()).toMatchObject({ events: 1, snapshots: 2, memberships: 0 });
    expect(db.prepare('SELECT event_id FROM scene_trigger_intents').get()?.event_id).toBeNull();
  });

  it('retains retry history but cancels future execution instead of replaying it', () => {
    db.prepare("UPDATE proactive_runs SET status = 'retryable', error_message = 'Timeout', next_attempt_at = ?").run(timestamp);
    db.exec("UPDATE proactive_signal_batches SET status = 'failed_retryable'");
    convert();
    expect(db.prepare('SELECT status, reason, retry_at FROM scene_runs').get()).toMatchObject({ status: 'cancelled', reason: 'import_requires_review', retry_at: null });
    expect(db.prepare('SELECT error_message, source_retry_at FROM scene_run_details').get()).toMatchObject({ error_message: 'Timeout', source_retry_at: now });
    expect(db.prepare('SELECT status FROM scene_trigger_intents').get()?.status).toBe('cancelled');
  });

  it.each([
    "UPDATE proactive_runs SET status = 'running'",
    "UPDATE proactive_runs SET lease_owner = 'worker'",
    "UPDATE proactive_signal_batches SET status = 'processing'",
    "UPDATE proactive_signal_batches SET event_count = 2",
    "UPDATE proactive_runs SET scenario_version = 2",
    "UPDATE scene_activations SET owner_id = 'other'",
    "UPDATE scene_activations SET status = 'active'",
    "UPDATE proactive_events SET payload_json = 'invalid'",
    "UPDATE proactive_context_snapshots SET evidence_ids_json = '[1]'",
    "UPDATE proactive_runs SET started_at = '2026-02-30T00:00:00Z'",
  ])('rejects inconsistent history and rolls back every new record: %s', (sql) => {
    db.exec(sql); expect(convert).toThrow();
    expect(db.prepare('SELECT count(*) AS n FROM scene_events').get()?.n).toBe(0);
    expect(db.prepare('SELECT count(*) AS n FROM scene_runs').get()?.n).toBe(0);
  });

  it('requires complete, unambiguous bindings', () => {
    expect(() => convertSceneExecutionHistory(db, { owners: [principal], batches: [] })).toThrow('Every historical batch');
    expect(() => convertSceneExecutionHistory(db, { owners: [principal], batches: [{ batchId: 'batch', activationId }, { batchId: 'batch', activationId }] })).toThrow('Duplicate');
    expect(() => convertSceneExecutionHistory(db, { owners: [], batches: [{ batchId: 'batch', activationId }] })).toThrow('ownership');
  });

  it('rolls back with the outer transaction and refuses a second conversion', () => {
    db.exec('BEGIN'); convert(); db.exec('ROLLBACK');
    expect(db.prepare('SELECT count(*) AS n FROM scene_runs').get()?.n).toBe(0);
    convert(); expect(convert).toThrow();
    expect(db.prepare('SELECT count(*) AS n FROM scene_runs').get()?.n).toBe(1);
  });

  it('preserves private instruction revisions and settings without sharing or enabling them', () => {
    const privateText = 'Private household instruction. '.repeat(2000);
    db.prepare('UPDATE proactive_prompt_revisions SET user_instructions = ?').run(privateText);
    db.exec("UPDATE proactive_scenario_subscriptions SET active_prompt_revision_id = 'instruction', enabled = 1");
    db.prepare('INSERT INTO proactive_prompt_revisions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run('draft', 'subscription', 2, 'draft', 1, 'Unpublished private draft', 'original-hash', timestamp, null);
    db.prepare(`INSERT INTO proactive_subscription_settings VALUES ('subscription', ?, 3)
      ON CONFLICT(subscription_id) DO UPDATE SET settings_json = excluded.settings_json, revision = excluded.revision`)
      .run('{"notificationMode":"quiet","privateConstraint":"Keep evenings free"}');
    db.prepare('INSERT INTO proactive_schedule_state VALUES (?, ?, ?, ?)').run('subscription', timestamp, timestamp, 'old-fingerprint');
    const permissions = db.prepare('SELECT permissions_json FROM scene_activations').get()?.permissions_json;
    expect(convertSceneActivationHistory(db, { owners: [principal], activations: [{ subscriptionId: 'subscription', activationId }] }))
      .toEqual({ subscriptions: 1, revisions: 2, settings: 1, schedules: 1 });
    expect(db.prepare("SELECT content FROM scene_instruction_revisions WHERE id = 'instruction'").get()?.content).toBe(privateText);
    expect(db.prepare('SELECT * FROM scene_activation_details').get()).toMatchObject({ active_instruction_id: 'instruction', previously_enabled: 1,
      settings_revision: 3, previous_due_at: now, previous_checked_at: now, previous_fingerprint: 'old-fingerprint' });
    expect(db.prepare('SELECT status, permissions_json FROM scene_activations').get()).toMatchObject({ status: 'needs_setup', permissions_json: permissions });
    expect(db.prepare('SELECT count(*) AS n FROM scene_schedule_cursors').get()?.n).toBe(0);
    expect(JSON.stringify(new SceneRepository(db).listTemplates())).not.toContain('Private');
    expect(db.prepare('SELECT count(*) AS n FROM proactive_prompt_revisions').get()?.n).toBe(2);
  });

  it.each([
    "UPDATE scene_activations SET owner_id = 'other'",
    "UPDATE scene_activations SET status = 'active'",
    "UPDATE proactive_scenario_subscriptions SET active_prompt_revision_id = 'missing'",
    "UPDATE proactive_scenario_subscriptions SET active_prompt_revision_id = 'instruction'; UPDATE proactive_prompt_revisions SET status = 'draft'",
  ])('rejects ambiguous private history without partial writes: %s', (sql) => {
    db.exec(sql);
    expect(() => convertSceneActivationHistory(db, { owners: [principal], activations: [{ subscriptionId: 'subscription', activationId }] })).toThrow();
    expect(db.prepare('SELECT count(*) AS n FROM scene_instruction_revisions').get()?.n).toBe(0);
  });

  it('requires complete activation bindings and participates in the outer transaction', () => {
    expect(() => convertSceneActivationHistory(db, { owners: [principal], activations: [] })).toThrow('Every subscription');
    const input = { owners: [principal], activations: [{ subscriptionId: 'subscription', activationId }] };
    db.exec('BEGIN'); convertSceneActivationHistory(db, input); db.exec('ROLLBACK');
    expect(db.prepare('SELECT count(*) AS n FROM scene_instruction_revisions').get()?.n).toBe(0);
    convertSceneActivationHistory(db, input);
    expect(() => convertSceneActivationHistory(db, input)).toThrow();
    expect(db.prepare('SELECT count(*) AS n FROM scene_instruction_revisions').get()?.n).toBe(1);
  });

  it('requires imported run instructions to be preserved before the cutover can be ready', () => {
    seedOutcome(); convert(); convertSceneOutcomeHistory(db, { owners: [principal] });
    expect(() => assertSceneHistoryIntegrity(db)).toThrow('intent_subscription');
    convertSceneActivationHistory(db, { owners: [principal], activations: [{ subscriptionId: 'subscription', activationId }] });
    expect(() => assertSceneHistoryIntegrity(db)).toThrow('definition_version');
    convertSceneDefinitions(db);
    expect(() => assertSceneHistoryIntegrity(db)).not.toThrow();
    db.exec("UPDATE scene_instruction_feedback SET instruction_revision_id = 'missing'");
    expect(() => assertSceneHistoryIntegrity(db)).toThrow('instruction_feedback');
  });

  it.each([
    ["UPDATE scene_activation_details SET active_instruction_id = 'instruction'; UPDATE scene_instruction_revisions SET status = 'draft'", 'active_instruction'],
    ["UPDATE scene_run_details SET instruction_revision_id = 'missing'", 'run_instruction'],
    ["UPDATE scene_activation_details SET source_subscription_id = 'other'", 'intent_subscription'],
    ["UPDATE scene_events SET owner_id = 'other'", 'intent_event_scope'],
  ])('blocks inconsistent converted history: %s', (sql, reason) => {
    convert(); convertSceneActivationHistory(db, { owners: [principal], activations: [{ subscriptionId: 'subscription', activationId }] });
    db.exec(sql); expect(() => assertSceneHistoryIntegrity(db)).toThrow(reason);
  });

  it('converts results, decisions, feedback and notification mappings end to end', () => {
    seedOutcome(); convert();
    const converted = convertSceneOutcomeHistory(db, { owners: [principal] });
    expect(converted.presentations).toEqual([{ inboxItemId: 'card', presentationId: 'card' }]);
    expect(converted.counts).toMatchObject({ outcomes: 1, presentations: 1, decisions: 1, instructions: 1, requests: 1, reviews: 1, changes: 1 });
    const content = JSON.parse(String(db.prepare('SELECT content_json FROM scene_outcomes').get()?.content_json));
    expect(content).toMatchObject({ kind: 'artifact', summary: 'Summary', evidenceIds: ['event'], workDone: 'Prepared a draft',
      artifact: { body: 'Private draft' }, actionHistory: { recordedStatus: 'completed', recordedResult: { taskId: 'original-task' } } });
    expect(db.prepare('SELECT * FROM scene_presentations').get()).toMatchObject({ id: 'card', status: 'read', revision: 5, notification_revision: 3, correlation_key: 'thread:original', actionable_until: Date.parse('2099-01-01T00:00:00Z') });
    expect(db.prepare('SELECT * FROM scene_decisions').get()).toMatchObject({ choice: 'approve', origin: 'import' });
    expect(db.prepare('SELECT * FROM scene_instruction_feedback').get()).toMatchObject({ instruction_revision_id: 'instruction', instruction: 'Please be concise' });
    expect(db.prepare('SELECT * FROM scene_presentation_requests').get()).toMatchObject({ idempotency_key: 'original-request', response_json: '{"taskId":"original-task"}' });
    expect(db.prepare('SELECT * FROM scene_presentation_reviews').get()).toMatchObject({ checked_at: now });
    expect(convertSceneFeedback(db, { owners: [principal], presentations: converted.presentations })).toBe(1);
    expect(Object.values(convertSceneNotifications(db, { owners: [principal], presentations: converted.presentations })).every((count) => count === 0)).toBe(true);
    expect(new SceneRepository(db).listInbox(principal)).toHaveLength(1);
    expect(new SceneMetrics(db, () => now + 1000).forUser(principal)).toMatchObject({ checks: 0, usefulOutcomes: 0 });
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });

  it.each([
    "UPDATE proactive_inbox_items SET status = 'resolved', resolution = 'done'",
    "UPDATE proactive_inbox_items SET status = 'snoozed', snoozed_until = '2099-01-01T00:00:00Z'",
    "UPDATE proactive_inbox_items SET expires_at = '2000-01-01T00:00:00Z'",
    "UPDATE proactive_inbox_items SET withdrawn_at = '2000-01-01T00:00:00Z'",
  ])('preserves inactive result state without resurfacing or reopening it: %s', (sql) => {
    seedOutcome(); db.exec(sql); convert(); convertSceneOutcomeHistory(db, { owners: [principal] });
    expect(new SceneRepository(db).listInbox(principal)).toHaveLength(0);
    expect(() => new SceneInboxService(db).setRead(principal, 'card', false)).toThrow();
    expect(db.prepare('SELECT count(*) AS n FROM scene_outcomes').get()?.n).toBe(1);
  });

  it('retains change history of deleted cards without fabricating missing outcomes', () => {
    seedOutcome();
    db.exec("INSERT INTO proactive_card_changes(workspace_id, inbox_item_id, deleted) VALUES ('workspace', 'deleted-card', 0), ('workspace', 'deleted-card', 1)");
    convert(); convertSceneOutcomeHistory(db, { owners: [principal] });
    expect(db.prepare("SELECT deleted FROM scene_presentation_changes WHERE presentation_id = 'deleted-card' ORDER BY sequence").all()).toMatchObject([{ deleted: 0 }, { deleted: 1 }]);
    expect(db.prepare("SELECT id FROM scene_presentations WHERE id = 'deleted-card'").get()).toBeUndefined();
  });

  it('rolls back execution, outcomes and feedback together when notification reconciliation fails', () => {
    seedOutcome();
    db.prepare(`INSERT INTO proactive_delivery_outbox(delivery_id, inbox_item_id, status, next_attempt_at, created_at, updated_at)
      VALUES ('outbox', 'card', 'pending', ?, ?, ?)`).run(timestamp, timestamp, timestamp);
    db.exec('BEGIN');
    try {
      convert();
      const { presentations } = convertSceneOutcomeHistory(db, { owners: [principal] });
      convertSceneFeedback(db, { owners: [principal], presentations });
      expect(() => convertSceneNotifications(db, { owners: [principal], presentations })).toThrow('reconciliation');
    } finally { db.exec('ROLLBACK'); }
    for (const table of ['scene_events', 'scene_runs', 'scene_outcomes', 'scene_feedback_history']) {
      expect(db.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n).toBe(0);
    }
    expect(db.prepare('SELECT count(*) AS n FROM proactive_runs').get()?.n).toBe(1);
    expect(db.prepare('SELECT count(*) AS n FROM proactive_feedback').get()?.n).toBe(1);
  });

  it.each([
    "UPDATE proactive_insights SET action_status = 'pending'",
    "UPDATE proactive_insights SET action_status = 'executing'",
    "UPDATE proactive_insights SET scenario_key = 'other-template'",
    "UPDATE proactive_insights SET artifact_json = 'invalid'",
    "UPDATE proactive_card_changes SET workspace_id = 'other-workspace'",
    "INSERT INTO proactive_card_changes(workspace_id, inbox_item_id, deleted) VALUES ('workspace', 'missing', 0)",
  ])('rejects inconsistent result history with no partial import: %s', (sql) => {
    seedOutcome(); convert(); db.exec(sql);
    expect(() => convertSceneOutcomeHistory(db, { owners: [principal, { ownerId: 'other', workspaceId: 'other-workspace' }] })).toThrow();
    expect(db.prepare('SELECT count(*) AS n FROM scene_outcomes').get()?.n).toBe(0);
    expect(db.prepare('SELECT count(*) AS n FROM scene_presentations').get()?.n).toBe(0);
  });
});
