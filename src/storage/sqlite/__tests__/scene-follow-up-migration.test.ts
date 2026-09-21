import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

import { expect, it } from 'vitest';

import { sceneTemplateSchema } from '../../../scenes/contracts.js';
import { SceneRepository } from '../../../scenes/repository.js';
import { taskFollowUpInputSchema, taskFollowUpTemplate } from '../../../scenes/taskFollowUp/contracts.js';
import { applyPendingMigrations } from '../migrations/runner.js';
import { ensureSchemaMetaTable, setSchemaVersion } from '../schema-version.js';
import { readSqliteAsset } from '../sql-assets.js';

it('preserves v190 tasks, source snapshots, resource identities and authority while pausing the legacy scene', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('PRAGMA foreign_keys = ON'); ensureSchemaMetaTable(db);
    db.exec(readSqliteAsset('schema.sql')); setSchemaVersion(db, 165);
    applyPendingMigrations(db, { targetVersion: 190 });
    const scenes = new SceneRepository(db);
    const old = sceneTemplateSchema.parse({ ...taskFollowUpTemplate, key: 'slack-development',
      contextProviders: ['slack_thread'], allowedEffectHandlers: ['development.workspace'] });
    scenes.installTemplate(old);
    const principal = { ownerId: 'owner', workspaceId: 'workspace' };
    const activation = scenes.createActivation(principal, { templateKey: old.key, templateVersion: old.version, goal: 'Keep this work',
      scope: { kind: 'personal' }, permissions: { accountIds: ['account'], contextProviders: ['slack_thread'], effectHandlers: ['development.workspace'] } });
    scenes.transitionActivation(principal, activation.id, activation.revision, 'active');
    const taskId = randomUUID();
    db.prepare(`INSERT INTO tasks(task_id,title,phase,priority,source,created_at,updated_at) VALUES (?,'Keep task','review','normal','api',1,1)`).run(taskId);
    const input = { thread: { accountId: 'account', teamId: 'T123', channelId: 'C123', threadTs: '1234567890.123456' },
      projectId: 'project', goal: 'Keep this work', mode: 'code', verificationCommand: 'node --test', sourceUrl: 'https://example.slack.com/archives/C123/p1234567890123456' };
    db.prepare(`INSERT INTO scene_development_bindings(activation_id,task_id,source_key,input_json,resource_operation_id,observed_revision,applied_revision,created_at)
      VALUES (?,?,?, ?,?,1,1,1)`).run(activation.id, taskId, 'old-source', JSON.stringify(input), 'retained-resource');
    db.prepare('INSERT INTO scene_development_revisions VALUES (?,1,?, ?,1)').run(activation.id, 'old-hash', 'Keep original evidence');
    applyPendingMigrations(db);
    const binding = db.prepare('SELECT * FROM scene_task_bindings').get()!;
    const parsed = taskFollowUpInputSchema.parse(JSON.parse(String(binding.input_json)));
    expect(parsed.source).toEqual({ provider: 'slack_thread', reference: input.thread });
    expect(parsed.capabilities).toEqual(['workspace.read', 'workspace.write', 'verification.run']);
    expect(parsed.verificationCommand).toBe('node --test');
    expect(parsed.sourceUrl).toBe(input.sourceUrl);
    expect(binding.task_id).toBe(taskId);
    expect(binding.resource_operation_id).toBe('retained-resource');
    expect(binding.processed_revision).toBe(1);
    expect(db.prepare('SELECT content FROM scene_task_revisions').get()?.content).toBe('Keep original evidence');
    const migrated = scenes.getActivation(principal, activation.id);
    expect(migrated.status).toBe('paused');
    expect(migrated.permissions.effectHandlers).toEqual(['workspace.write', 'verification.run']);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { db.close(); }
});
