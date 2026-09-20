import { DatabaseSync } from 'node:sqlite';

import { expect, it } from 'vitest';

import { installSceneStorage } from '../../storage/sqlite/scenes-schema.js';
import { maintainSceneStorage } from '../maintenance.js';
import { SceneRepository } from '../repository.js';
import { familyPlanTemplate } from '../templates.js';

it('bounds old operational payloads without deleting results or allowing old requests to replay', () => {
  const db = new DatabaseSync(':memory:');
  try {
    installSceneStorage(db); db.exec('PRAGMA foreign_keys = ON');
    const repository = new SceneRepository(db);
    const owner = { ownerId: 'owner', workspaceId: 'workspace' };
    repository.installTemplate(familyPlanTemplate);
    const activation = repository.createActivation(owner, { templateKey: familyPlanTemplate.key, templateVersion: familyPlanTemplate.version,
      goal: 'Plan Sunday', scope: { kind: 'personal' }, permissions: { contextProviders: ['user_notes'], accountIds: [], effectHandlers: [] } });
    repository.transitionActivation(owner, activation.id, 1, 'active', 1);
    const intent = repository.acceptManualCheck(owner, activation.id, 'check', 'request', 2);
    const claim = repository.claimNext('worker', 3)!;
    repository.saveSnapshot(claim, 'a'.repeat(64), ['note'], 3);
    repository.finishReadOnlyRun(claim, { kind: 'artifact', summary: 'Rest on Sunday', evidenceIds: ['note'] }, 4);
    db.prepare('INSERT INTO scene_mail_sources VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('unused', owner.ownerId, owner.workspaceId, 'account', 'thread', 'Old subject', 'Sender', 1);
    const now = 100 * 86400000;
    maintainSceneStorage(db, now); maintainSceneStorage(db, now);
    expect(db.prepare('SELECT count(*) AS n FROM scene_context_snapshots').get()?.n).toBe(0);
    expect(db.prepare('SELECT count(*) AS n FROM scene_mail_sources').get()?.n).toBe(0);
    expect(repository.listInbox(owner)[0].content.summary).toBe('Rest on Sunday');
    expect(repository.acceptManualCheck(owner, activation.id, 'check', 'request', now)).toBe(intent);
    expect(repository.claimNext('worker', now)).toBeNull();
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { db.close(); }
});
