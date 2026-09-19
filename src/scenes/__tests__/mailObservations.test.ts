import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SceneMailObservationService } from '../mailObservations.js';
import { SceneRepository } from '../repository.js';
import { mailFollowUpTemplate } from '../templates.js';
import { SceneExecutionService } from '../execution.js';

describe('mail change observations', () => {
  let db: DatabaseSync;
  let repository: SceneRepository;
  let service: SceneMailObservationService;
  let activationId: string;
  let itemId: string;
  const principal = { ownerId: 'owner', workspaceId: 'workspace' };
  const permissions = { accountIds: ['mail'], contextProviders: ['mail'], effectHandlers: [] };
  const evidence = { ...principal, id: 'message', subjectId: 'thread', accountId: 'mail', revision: '1', freshUntil: 10000, content: 'Original message' };
  const read = vi.fn(async () => [evidence]);
  const scan = () => service.scan(principal, new AbortController().signal);
  beforeEach(() => {
    read.mockReset().mockResolvedValue([evidence]);
    db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON');
    db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
    repository = new SceneRepository(db);
    repository.installTemplate(mailFollowUpTemplate);
    const activation = repository.createActivation(principal, { templateKey: mailFollowUpTemplate.key, templateVersion: mailFollowUpTemplate.version,
      goal: 'Follow the thread', scope: { kind: 'objects', ids: ['thread'] }, permissions });
    activationId = activation.id;
    repository.transitionActivation(principal, activationId, 1, 'active');
    itemId = repository.createWorkItem(principal, activationId, { subjectId: 'thread', accountId: 'mail', dueAt: 9000 }, 1000).id;
    service = new SceneMailObservationService(repository, { id: 'mail', read }, async () => permissions, () => 2000);
  });
  afterEach(() => db.close());

  it('establishes a silent baseline and emits once per later change', async () => {
    expect((await scan()).changed).toBe(0);
    expect((await scan()).changed).toBe(0);
    read.mockResolvedValue([{ ...evidence, revision: '2', content: 'A reply' }]);
    expect((await scan()).changed).toBe(1);
    expect((await scan()).changed).toBe(0);
    expect(db.prepare('SELECT count(*) AS n FROM scene_trigger_intents').get()?.n).toBe(1);
    read.mockResolvedValue([evidence]);
    expect((await scan()).changed).toBe(1);
    expect(db.prepare('SELECT count(*) AS n FROM scene_trigger_intents').get()?.n).toBe(2);
  });

  it('does not turn source failure into an empty-thread event', async () => {
    await scan();
    read.mockRejectedValueOnce(new Error('sync unavailable'));
    expect(await scan()).toMatchObject({ changed: 0, unavailable: 1 });
    expect((await scan()).changed).toBe(0);
  });

  it('rejects wrong-account evidence and ignores paused items', async () => {
    read.mockResolvedValue([{ ...evidence, accountId: 'another' }]);
    expect((await scan()).unavailable).toBe(1);
    repository.updateWorkItem(principal, itemId, { expectedRevision: 1, status: 'paused' }, 2000);
    read.mockClear();
    expect((await scan()).changed).toBe(0);
    expect(read).not.toHaveBeenCalled();
  });

  it('rejects an observation captured before the item was edited', async () => {
    await scan();
    read.mockImplementationOnce(async () => {
      repository.updateWorkItem(principal, itemId, { expectedRevision: 1, dueAt: 10000 }, 2000);
      return [{ ...evidence, revision: '2' }];
    });
    expect((await scan()).changed).toBe(0);
    expect(db.prepare('SELECT count(*) AS n FROM scene_trigger_intents').get()?.n).toBe(0);
  });

  it('withdraws a previous result when its thread changes', async () => {
    await scan();
    repository.acceptManualCheck(principal, activationId, 'check', 'manual', 2000);
    repository.finishReadOnlyRun(repository.claimNext('worker', 2000)!, { kind: 'artifact', summary: 'Draft', evidenceIds: ['message'] }, 2001);
    expect(repository.listInbox(principal)).toHaveLength(1);
    read.mockResolvedValue([{ ...evidence, revision: '2' }]);
    expect((await scan()).changed).toBe(1);
    expect(repository.listInbox(principal)).toEqual([]);
  });

  it('uses an executed snapshot as baseline even before the first observation scan', async () => {
    repository.acceptManualCheck(principal, activationId, 'check', 'manual', 2000);
    const runtime = new SceneExecutionService(repository, [{ id: 'mail', read }], {
      execute: async () => ({ kind: 'artifact', summary: 'Draft', evidenceIds: ['message'] }),
    }, async () => permissions, () => 2000);
    expect(await runtime.runNext('worker')).toBe('completed');
    expect((await scan()).changed).toBe(0);
    read.mockResolvedValue([{ ...evidence, revision: '2' }]);
    expect((await scan()).changed).toBe(1);
    expect(repository.listInbox(principal)).toEqual([]);
  });

  it('does not advance the baseline if permission is revoked during a read', async () => {
    const authorize = vi.fn().mockResolvedValueOnce(permissions)
      .mockResolvedValue({ ...permissions, accountIds: [] });
    service = new SceneMailObservationService(repository, { id: 'mail', read }, authorize, () => 2000);
    expect(await scan()).toMatchObject({ changed: 0, unavailable: 1 });
    expect(db.prepare('SELECT observed_fingerprint FROM scene_work_items').get()?.observed_fingerprint).toBeNull();
  });

  it('rejects duplicate evidence identities without recording a baseline', async () => {
    read.mockResolvedValue([evidence, evidence]);
    expect(await scan()).toMatchObject({ changed: 0, unavailable: 1 });
    expect(db.prepare('SELECT observed_fingerprint FROM scene_work_items').get()?.observed_fingerprint).toBeNull();
  });
});
