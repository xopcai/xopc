import { DatabaseSync } from 'node:sqlite';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SceneInboxService } from '../inbox.js';
import { SceneRepository } from '../repository.js';
import { installSceneStorage } from '../../storage/sqlite/scenes-schema.js';
import { mailFollowUpTemplate } from '../templates.js';

describe('scene result lifecycle', () => {
  let db: DatabaseSync;
  let repository: SceneRepository;
  let inbox: SceneInboxService;
  let activationId: string;
  let id: string;
  const principal = { ownerId: 'owner', workspaceId: 'workspace' };
  const complete = (requestId: string, noChange = false) => {
    repository.acceptManualCheck(principal, activationId, 'check', requestId, 1000);
    const claim = repository.claimNext('worker', 1000)!;
    repository.finishReadOnlyRun(claim, noChange
      ? { kind: 'no_change', summary: '', evidenceIds: [] }
      : { kind: 'artifact', summary: 'Draft', evidenceIds: ['mail'] }, 1100);
  };
  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON');
    installSceneStorage(db);

    repository = new SceneRepository(db);
    inbox = new SceneInboxService(db, () => 1200);
    repository.installTemplate(mailFollowUpTemplate);
    const activation = repository.createActivation(principal, {
      templateKey: mailFollowUpTemplate.key, templateVersion: mailFollowUpTemplate.version,
      goal: 'Prepare a reply', scope: { kind: 'objects', ids: ['thread'] },
      permissions: { accountIds: ['mail'], contextProviders: ['mail'], effectHandlers: [] },
    });
    activationId = activation.id;
    repository.transitionActivation(principal, activationId, 1, 'active');
    complete('one');
    id = repository.listInbox(principal)[0].id;
  });
  afterEach(() => db.close());

  it('reading is reversible and does not imply value feedback', () => {
    inbox.setRead(principal, id, true);
    expect(repository.listInbox(principal)[0].status).toBe('read');
    expect(inbox.getFeedback(principal, id)).toBeNull();
    inbox.setRead(principal, id, false);
    expect(repository.listInbox(principal)[0].status).toBe('unread');
  });
  it('records explicit feedback with revision-based correction', () => {
    expect(inbox.feedback(principal, id, { expectedRevision: 0, rating: 'useful' })).toBe(1);
    expect(() => inbox.feedback(principal, id, { expectedRevision: 0, rating: 'useful' })).toThrow('changed');
    expect(inbox.feedback(principal, id, { expectedRevision: 1, rating: 'not_useful', note: 'Outdated' })).toBe(2);
    expect(inbox.getFeedback(principal, id)).toEqual({ rating: 'not_useful', note: 'Outdated', revision: 2 });
    expect(() => inbox.feedback(principal, id, { expectedRevision: 1, rating: 'useful' })).toThrow('changed');
  });
  it('does not allow revisions to create missing feedback or arbitrary ratings', () => {
    expect(() => inbox.feedback(principal, id, { expectedRevision: 2, rating: 'useful' })).toThrow('changed');
    expect(() => inbox.feedback(principal, id, { expectedRevision: 0, rating: 'sent' })).toThrow();
    expect(inbox.getFeedback(principal, id)).toBeNull();
  });
  it.each([{ ...principal, ownerId: 'other' }, { ...principal, workspaceId: 'other' }])('isolates results for %j', (other) => {
    expect(() => inbox.setRead(other, id, true)).toThrow('not found');
    expect(() => inbox.feedback(other, id, { expectedRevision: 0, rating: 'useful' })).toThrow('not found');
    expect(() => inbox.getFeedback(other, id)).toThrow('not found');
  });
  it('withdraws superseded drafts even when a later check has no useful change', () => {
    inbox.feedback(principal, id, { expectedRevision: 0, rating: 'useful' });
    complete('two', true);
    expect(repository.listInbox(principal)).toEqual([]);
    expect(() => inbox.setRead(principal, id, false)).toThrow('withdrawn');
    expect(() => inbox.feedback(principal, id, { expectedRevision: 1, rating: 'not_useful' })).toThrow('withdrawn');
    expect(db.prepare('SELECT count(*) AS n FROM scene_feedback').get()?.n).toBe(1);
    expect(db.prepare('SELECT count(*) AS n FROM scene_outcomes').get()?.n).toBe(2);
  });
  it('replaces a result rather than accumulating cards for the same subject', () => {
    complete('two');
    expect(repository.listInbox(principal)).toHaveLength(1);
    expect(repository.listInbox(principal)[0].id).not.toBe(id);
  });
  it.each(['needs_setup', 'archived'] as const)('withdraws results on %s', (status) => {
    repository.transitionActivation(principal, activationId, 2, status);
    expect(repository.listInbox(principal)).toEqual([]);
  });
});
