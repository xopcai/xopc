import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SceneMailObservationService } from '../mailObservations.js';
import { SceneRepository } from '../repository.js';
import { ScenePreferenceService } from '../preferences.js';
import { installSceneStorage } from '../../storage/sqlite/scenes-schema.js';
import { mailFollowUpTemplate } from '../templates.js';
import { SceneExecutionService } from '../execution.js';
import { SceneCapabilityRegistry } from '../registry.js';

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
  const scan = () => service.scan(new AbortController().signal);
  beforeEach(() => {
    read.mockReset().mockResolvedValue([evidence]);
    db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON');
    installSceneStorage(db);

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

  it('advances past an unresponsive thread and rejects its late evidence', async () => {
    vi.useFakeTimers();
    let finish!: (value: typeof evidence[]) => void;
    read.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const progress = vi.fn();
    const pending = service.scan(new AbortController().signal, '', progress);
    await vi.advanceTimersByTimeAsync(5000);
    expect(await pending).toMatchObject({ unavailable: 1 });
    expect(progress).toHaveBeenCalledWith(itemId);
    finish([evidence]); await Promise.resolve();
    expect(db.prepare('SELECT observed_fingerprint FROM scene_work_items WHERE id = ?').get(itemId)?.observed_fingerprint).toBeNull();
    vi.useRealTimers();
  });

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

  it('does not read mail during a global pause, but mute alone permits observations', async () => {
    const preferences = new ScenePreferenceService(db);
    preferences.update(principal, { expectedRevision: 0, checksPaused: true });
    expect(await scan()).toMatchObject({ changed: 0, unavailable: 0 }); expect(read).not.toHaveBeenCalled();
    preferences.update(principal, { expectedRevision: 1, checksPaused: false, notificationsMuted: true });
    await scan(); expect(read).toHaveBeenCalledOnce();
  });

  it('invalidates a mail observation even if a global pause is resumed before it returns', async () => {
    read.mockImplementationOnce(async () => {
      const preferences = new ScenePreferenceService(db);
      preferences.update(principal, { expectedRevision: 0, checksPaused: true });
      preferences.update(principal, { expectedRevision: 1, checksPaused: false });
      return [evidence];
    });
    expect(await scan()).toMatchObject({ changed: 0, unavailable: 1 });
    expect(db.prepare('SELECT observed_fingerprint FROM scene_work_items WHERE id = ?').get(itemId)?.observed_fingerprint).toBeNull();
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
    const runtime = new SceneExecutionService(repository, new SceneCapabilityRegistry([{ id: 'mail', read }]), {
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

  it('uses persisted ownership for every item across workspaces', async () => {
    const other = { ownerId: 'other', workspaceId: 'other-workspace' };
    const activation = repository.createActivation(other, { templateKey: mailFollowUpTemplate.key, templateVersion: mailFollowUpTemplate.version,
      goal: 'Another thread', scope: { kind: 'objects', ids: ['thread'] }, permissions });
    repository.transitionActivation(other, activation.id, 1, 'active');
    repository.createWorkItem(other, activation.id, { subjectId: 'thread', accountId: 'mail', dueAt: 9000 }, 1000);
    expect(await scan()).toMatchObject({ changed: 0, unavailable: 1 });
    expect(db.prepare('SELECT observed_fingerprint FROM scene_work_items WHERE activation_id = ?').get(activation.id)?.observed_fingerprint).toBeNull();
    expect(db.prepare('SELECT observed_fingerprint FROM scene_work_items WHERE activation_id = ?').get(activationId)?.observed_fingerprint).toBeTypeOf('string');
  });

  it('does not skip records when a scan needs more than one page', async () => {
    for (let i = 0; i < 101; i++) {
      const activation = repository.createActivation(principal, { templateKey: mailFollowUpTemplate.key, templateVersion: mailFollowUpTemplate.version,
        goal: `Thread ${i}`, scope: { kind: 'objects', ids: ['thread'] }, permissions });
      repository.transitionActivation(principal, activation.id, 1, 'active');
      repository.createWorkItem(principal, activation.id, { subjectId: 'thread', accountId: 'mail', dueAt: 9000 }, 1000);
    }
    const first = await scan();
    expect(first.nextCursor).toBeTypeOf('string');
    expect(read).toHaveBeenCalledTimes(100);
    const second = await service.scan(new AbortController().signal, first.nextCursor!);
    expect(second.nextCursor).toBeNull();
    expect(read).toHaveBeenCalledTimes(102);
    expect(db.prepare('SELECT count(*) AS n FROM scene_work_items WHERE observed_fingerprint IS NOT NULL').get()?.n).toBe(102);
  });

  it('does not read a source after stop while authorization was pending', async () => {
    const controller = new AbortController();
    service = new SceneMailObservationService(repository, { id: 'mail', read }, async () => {
      controller.abort(new Error('Stopped')); return permissions;
    }, () => 2000);
    await expect(service.scan(controller.signal)).rejects.toThrow('Stopped');
    expect(read).not.toHaveBeenCalled();
  });

  it('does not read mail on behalf of a template that does not request it', async () => {
    repository.installTemplate({ ...mailFollowUpTemplate, key: 'without-mail', contextProviders: [] });
    db.prepare("UPDATE scene_activations SET template_key = 'without-mail' WHERE id = ?").run(activationId);
    expect(await scan()).toMatchObject({ unavailable: 1 });
    expect(read).not.toHaveBeenCalled();
  });

  it.each(['activation', 'work_item'])('does not read after the %s was paused during authorization', async (target) => {
    service = new SceneMailObservationService(repository, { id: 'mail', read }, async () => {
      if (target === 'activation') repository.transitionActivation(principal, activationId, 2, 'paused', 2000);
      else repository.updateWorkItem(principal, itemId, { expectedRevision: 1, status: 'paused' }, 2000);
      return permissions;
    }, () => 2000);
    expect(await scan()).toMatchObject({ unavailable: 1 });
    expect(read).not.toHaveBeenCalled();
  });
});
