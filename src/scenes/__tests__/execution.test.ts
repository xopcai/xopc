import { DatabaseSync } from 'node:sqlite';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SceneExecutionService, type SceneContextProvider, type SceneEvidence } from '../execution.js';
import { SceneRepository } from '../repository.js';
import { installSceneStorage } from '../../storage/sqlite/scenes-schema.js';
import { mailFollowUpTemplate } from '../templates.js';
import { SceneSourceNotReady } from '../readiness.js';

describe('scene read-only execution', () => {
  let db: DatabaseSync;
  let repository: SceneRepository;
  let activationId: string;
  const principal = { ownerId: 'user', workspaceId: 'workspace' };
  const permissions = { accountIds: ['personal'], contextProviders: ['mail'], effectHandlers: [] };
  const evidence: SceneEvidence = { ...principal, id: 'message:1', subjectId: 'thread:1', accountId: 'personal', revision: '1', freshUntil: 100_000, content: 'Please confirm the meeting time.' };
  const result = { kind: 'artifact', summary: 'A follow-up draft', evidenceIds: ['message:1'] };
  const read = vi.fn(async (_input: Parameters<SceneContextProvider['read']>[0]) => [evidence]);
  const authorize = vi.fn(async () => permissions);
  const execute = vi.fn(async () => result);
  const service = () => new SceneExecutionService(repository, [{ id: 'mail', read }], { execute }, authorize, () => 1001);

  it('rejects an outcome kind outside the template with an actionable reason', async () => {
    execute.mockResolvedValueOnce({ ...result, kind: 'observation' });
    await service().runNext('worker');
    expect(db.prepare('SELECT status, reason FROM scene_runs').get()).toMatchObject({ status: 'failed', reason: 'invalid_model_result' });
    expect(db.prepare('SELECT count(*) AS n FROM scene_outcomes').get()?.n).toBe(0);
  });

  beforeEach(() => {
    read.mockReset().mockResolvedValue([evidence]);
    authorize.mockReset().mockResolvedValue(permissions);
    execute.mockReset().mockResolvedValue(result);
    db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON');
    installSceneStorage(db);

    repository = new SceneRepository(db);
    repository.installTemplate(mailFollowUpTemplate);
    const activation = repository.createActivation(principal, {
      templateKey: mailFollowUpTemplate.key, templateVersion: mailFollowUpTemplate.version, goal: 'Get a reply',
      scope: { kind: 'objects', ids: ['thread:1'] }, permissions,
    });
    activationId = activation.id;
    repository.transitionActivation(principal, activationId, 1, 'active');
    repository.acceptTrigger(principal, activationId, { triggerKey: 'check', occurrenceKey: 'check:1', dueAt: 1000,
      event: { source: 'manual', sourceEventId: 'one', subjectId: 'thread:1', eventType: 'manual.check', occurredAt: 1000 } }, 1000);
  });
  afterEach(() => db.close());

  it('delivers one grounded result after rechecking authorization and evidence', async () => {
    expect(await service().runNext('worker')).toBe('completed');
    expect(read).toHaveBeenCalledTimes(2);
    expect(authorize).toHaveBeenCalledTimes(2);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(db.prepare('SELECT kind FROM scene_outcomes').get()?.kind).toBe('artifact');
    expect(db.prepare('SELECT count(*) AS n FROM scene_context_snapshots').get()?.n).toBe(1);
    expect(await service().runNext('worker')).toBe('idle');
  });

  it.each([
    { accountId: 'work' }, { ownerId: 'another' }, { workspaceId: 'another' },
    { subjectId: 'thread:2' }, { freshUntil: 1000 }, { revision: '' },
  ])('rejects out-of-scope or stale evidence before model invocation: %j', async (change) => {
    read.mockResolvedValue([{ ...evidence, ...change }]);
    expect(await service().runNext('worker')).toBe('failed');
    expect(execute).not.toHaveBeenCalled();
  });

  it('does not invoke the model for empty context', async () => {
    read.mockResolvedValue([]);
    expect(await service().runNext('worker')).toBe('completed');
    expect(execute).not.toHaveBeenCalled();
    expect(db.prepare('SELECT kind FROM scene_outcomes').get()?.kind).toBe('no_change');
  });

  it('rejects permission revocation during model execution', async () => {
    execute.mockImplementationOnce(async () => { authorize.mockResolvedValue({ ...permissions, accountIds: [] }); return result; });
    expect(await service().runNext('worker')).toBe('failed');
    expect(db.prepare('SELECT count(*) AS n FROM scene_outcomes').get()?.n).toBe(0);
  });

  it('rejects evidence changed during model execution', async () => {
    execute.mockImplementationOnce(async () => { read.mockResolvedValue([{ ...evidence, revision: '2', content: 'Already replied.' }]); return result; });
    expect(await service().runNext('worker')).toBe('failed');
  });

  it('rejects unknown citations', async () => {
    execute.mockResolvedValueOnce({ ...result, evidenceIds: ['invented'] });
    expect(await service().runNext('worker')).toBe('failed');
    expect(db.prepare('SELECT count(*) AS n FROM scene_outcomes').get()?.n).toBe(0);
  });

  it('rejects synthetic action receipts', async () => {
    execute.mockResolvedValueOnce({ ...result, kind: 'receipt' });
    expect(await service().runNext('worker')).toBe('failed');
    expect(db.prepare('SELECT count(*) AS n FROM scene_outcomes').get()?.n).toBe(0);
  });

  it('rejects mail evidence without an account identity', async () => {
    read.mockResolvedValue([{ ...evidence, accountId: undefined }]);
    expect(await service().runNext('worker')).toBe('failed');
    expect(execute).not.toHaveBeenCalled();
  });

  it('narrows a multi-account activation to the triggering account', async () => {
    const multiAccount = { ...permissions, accountIds: ['personal', 'work'] };
    authorize.mockResolvedValue(multiAccount);
    db.prepare('UPDATE scene_activations SET permissions_json = ?').run(JSON.stringify(multiAccount));
    db.prepare("UPDATE scene_events SET account_id = 'personal'").run();
    read.mockResolvedValue([{ ...evidence, accountId: 'work' }]);
    expect(await service().runNext('worker')).toBe('failed');
    expect(execute).not.toHaveBeenCalled();
    expect(read.mock.calls[0]?.[0].permissions.accountIds).toEqual(['personal']);
  });

  it('blocks a paused activation even when a model still returns', async () => {
    execute.mockImplementationOnce(async () => { repository.transitionActivation(principal, activationId, 2, 'paused'); return result; });
    expect(await service().runNext('worker')).toBe('failed');
    expect(db.prepare('SELECT count(*) AS n FROM scene_outcomes').get()?.n).toBe(0);
  });

  it('bounds non-cooperative execution and rejects its late result', async () => {
    let resolve!: (value: typeof result) => void;
    execute.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const controller = new AbortController();
    const pending = service().runNext('worker', controller.signal);
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
    controller.abort();
    expect(await pending).toBe('failed');
    resolve(result);
    await Promise.resolve(); await Promise.resolve();
    expect(db.prepare('SELECT count(*) AS n FROM scene_outcomes').get()?.n).toBe(0);
  });

  it('defers stale synchronization without calling the model, then recovers', async () => {
    read.mockRejectedValueOnce(new SceneSourceNotReady());
    let now = 1001;
    const runtime = new SceneExecutionService(repository, [{ id: 'mail', read }], { execute }, authorize, () => now);
    expect(await runtime.runNext('worker')).toBe('deferred');
    expect(execute).not.toHaveBeenCalled();
    expect(db.prepare('SELECT count(*) AS n FROM scene_model_reservations').get()?.n).toBe(0);
    expect(await runtime.runNext('worker')).toBe('idle');
    now += 60_000;
    expect(await runtime.runNext('worker')).toBe('completed');
    expect(execute).toHaveBeenCalledOnce();
    expect(db.prepare('SELECT attempt FROM scene_runs').get()?.attempt).toBe(1);
  });

  it('defers an exhausted budget before model invocation', async () => {
    const reservation = vi.spyOn(repository, 'reserveModelCall').mockReturnValueOnce(false);
    expect(await service().runNext('worker')).toBe('deferred');
    expect(execute).not.toHaveBeenCalled();
    expect(db.prepare('SELECT status, reason, retry_at FROM scene_runs').get())
      .toMatchObject({ status: 'retry_wait', reason: 'daily_budget', retry_at: 86_400_000 });
    reservation.mockRestore();
  });
});
