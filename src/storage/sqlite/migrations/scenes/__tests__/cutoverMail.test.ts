import { DatabaseSync } from 'node:sqlite';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { installSceneSchema } from '../schema.js';
import { convertSceneMailFollowUps } from '../mail.js';
import { SceneRepository } from '../../../../../scenes/repository.js';
import { mailFollowUpTemplate } from '../../../../../scenes/templates.js';

describe('offline mail delegation conversion', () => {
  let db: DatabaseSync;
  const owners = [{ workspaceId: 'workspace', ownerId: 'owner' }];
  const accounts = [{ followUpId: 'follow', accountId: 'account' }];
  const run = () => convertSceneMailFollowUps(db, { owners, accounts });
  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON');
    installSceneSchema(db);
    db.exec(`CREATE TABLE proactive_follow_ups (
      id TEXT PRIMARY KEY, subscription_id TEXT, workspace_id TEXT, source_item_id TEXT,
      instructions TEXT, due_at TEXT, revision INTEGER, status TEXT, thread_key TEXT, last_fingerprint TEXT,
      last_checked_at TEXT, conversation_id TEXT, created_at TEXT, updated_at TEXT);
      INSERT INTO proactive_follow_ups VALUES ('follow', 'subscription', 'workspace', 'message', 'Prepare a follow-up, do not send.',
        '2026-09-19T10:00:00Z', 7, 'watching', 'thread', 'original-fingerprint', '2026-09-18T10:00:00Z', NULL, '2026-09-17T10:00:00Z', '2026-09-18T10:00:00Z');
      CREATE TABLE connector_accounts (id TEXT PRIMARY KEY, principal_id TEXT, connector_id TEXT);
      INSERT INTO connector_accounts VALUES ('account', 'owner', 'gmail');
      CREATE TABLE connector_connections (id TEXT PRIMARY KEY, account_id TEXT, principal_id TEXT, connector_id TEXT);
      INSERT INTO connector_connections VALUES ('connection', 'account', 'owner', 'gmail');
      CREATE TABLE knowledge_source_items (item_id TEXT PRIMARY KEY, item_type TEXT, metadata_json TEXT);
      INSERT INTO knowledge_source_items VALUES ('message', 'email', '{"connectionId":"connection","workspaceId":"workspace"}');`);
  });
  afterEach(() => db.close());

  it('preserves identity, instructions, past deadlines and revisions without enabling execution', () => {
    expect(run()).toEqual([{ followUpId: 'follow', subscriptionId: 'subscription', activationId: 'follow', workItemId: 'follow' }]);
    const activation = new SceneRepository(db).getActivation({ ownerId: 'owner', workspaceId: 'workspace' }, 'follow');
    expect(activation).toMatchObject({ goal: 'Prepare a follow-up, do not send.', status: 'needs_setup',
      scope: { kind: 'objects', ids: ['message'] }, permissions: { accountIds: ['account'], contextProviders: ['mail'], effectHandlers: [] } });
    expect(db.prepare('SELECT * FROM scene_work_items').get()).toMatchObject({ id: 'follow', revision: 7,
      status: 'paused', due_at: Date.parse('2026-09-19T10:00:00Z'), last_triggered_revision: null, observed_fingerprint: null });
    expect(db.prepare('SELECT * FROM scene_mail_history').get()).toMatchObject({ work_item_id: 'follow', source_subscription_id: 'subscription',
      thread_key: 'thread', source_status: 'watching', last_fingerprint: 'original-fingerprint', conversation_id: null,
      last_checked_at: Date.parse('2026-09-18T10:00:00Z'), created_at: Date.parse('2026-09-17T10:00:00Z'), updated_at: Date.parse('2026-09-18T10:00:00Z') });
    expect(db.prepare('SELECT count(*) AS n FROM scene_events').get()?.n).toBe(0);
    expect(db.prepare('SELECT count(*) AS n FROM proactive_follow_ups').get()?.n).toBe(1);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });

  it.each(['paused', 'completed'])('preserves the terminal boundary of a %s work item', (status) => {
    db.prepare('UPDATE proactive_follow_ups SET status = ?').run(status);
    run();
    expect(db.prepare('SELECT status FROM scene_work_items').get()?.status).toBe(status);
    expect(db.prepare('SELECT status FROM scene_activations').get()?.status).toBe('needs_setup');
  });

  it('does not truncate the maximum supported private delegation instructions', () => {
    const instructions = 'x'.repeat(12_000);
    db.prepare('UPDATE proactive_follow_ups SET instructions = ?').run(instructions);
    run();
    expect(db.prepare('SELECT goal FROM scene_activations').get()?.goal).toBe(instructions);
  });

  it('requires explicit and unambiguous owner and account bindings', () => {
    expect(() => convertSceneMailFollowUps(db, { owners: [], accounts })).toThrow('explicit owner');
    expect(() => convertSceneMailFollowUps(db, { owners, accounts: [] })).toThrow('explicit owner');
    expect(() => convertSceneMailFollowUps(db, { owners: [...owners, ...owners], accounts })).toThrow('ownership');
    expect(() => convertSceneMailFollowUps(db, { owners, accounts: [...accounts, ...accounts] })).toThrow('Duplicate');
    expect(() => convertSceneMailFollowUps(db, { owners, accounts: [{ followUpId: 'missing', accountId: 'account' }] })).toThrow('unknown follow-up');
    expect(db.prepare('SELECT count(*) AS n FROM scene_activations').get()?.n).toBe(0);
  });

  it.each([
    "UPDATE connector_accounts SET principal_id = 'another-owner'",
    "UPDATE connector_connections SET connector_id = 'another-connector'",
    "UPDATE knowledge_source_items SET metadata_json = '{\"workspaceId\":\"another-workspace\",\"connectionId\":\"connection\"}'",
    'DELETE FROM knowledge_source_items',
  ])('rejects a mismatched or missing source: %s', (sql) => {
    db.exec(sql);
    expect(run).toThrow('does not match');
    expect(db.prepare('SELECT count(*) AS n FROM scene_activations').get()?.n).toBe(0);
    expect(db.prepare('SELECT count(*) AS n FROM proactive_follow_ups').get()?.n).toBe(1);
  });

  it('does not guess the account from a connection or email address', () => {
    expect(() => convertSceneMailFollowUps(db, { owners, accounts: [{ followUpId: 'follow', accountId: 'connection' }] })).toThrow('does not match');
  });

  it('rejects an invalid timestamp before creating target rows', () => {
    db.exec("UPDATE proactive_follow_ups SET due_at = 'tomorrow'");
    expect(run).toThrow('Invalid follow-up deadline');
    expect(db.prepare('SELECT count(*) AS n FROM scene_template_versions').get()?.n).toBe(0);
  });

  it('participates in the outer cutover transaction and refuses duplicate conversion', () => {
    db.exec('BEGIN');
    run();
    db.exec('ROLLBACK');
    expect(db.prepare('SELECT count(*) AS n FROM scene_activations').get()?.n).toBe(0);
    run();
    expect(run).toThrow();
    expect(db.prepare('SELECT count(*) AS n FROM scene_activations').get()?.n).toBe(1);
    expect(db.prepare('SELECT count(*) AS n FROM scene_work_items').get()?.n).toBe(1);
  });

  it('rolls back earlier records when a later target identity collides', () => {
    const repository = new SceneRepository(db);
    repository.installTemplate(mailFollowUpTemplate);
    const existing = repository.createActivation({ ownerId: 'owner', workspaceId: 'workspace' }, {
      templateKey: mailFollowUpTemplate.key, templateVersion: mailFollowUpTemplate.version, goal: 'Existing delegation',
      scope: { kind: 'objects', ids: ['message'] }, permissions: { accountIds: ['account'], contextProviders: ['mail'], effectHandlers: [] },
    });
    db.prepare("UPDATE scene_activations SET id = 'zzz' WHERE id = ?").run(existing.id);
    db.exec(`INSERT INTO proactive_follow_ups SELECT 'zzz', subscription_id, workspace_id, source_item_id, instructions,
      due_at, revision, status, 'second-thread', last_fingerprint, last_checked_at, conversation_id, created_at, updated_at FROM proactive_follow_ups`);
    expect(() => convertSceneMailFollowUps(db, { owners, accounts: [...accounts, { followUpId: 'zzz', accountId: 'account' }] })).toThrow();
    expect(db.prepare('SELECT id, goal FROM scene_activations').all()).toMatchObject([{ id: 'zzz', goal: 'Existing delegation' }]);
    expect(db.prepare('SELECT count(*) AS n FROM scene_work_items').get()?.n).toBe(0);
    expect(db.prepare('SELECT count(*) AS n FROM proactive_follow_ups').get()?.n).toBe(2);
  });
});
