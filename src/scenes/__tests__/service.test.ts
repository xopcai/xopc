import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SceneRepository } from '../repository.js';
import { SceneApplicationService } from '../service.js';
import { mailFollowUpTemplate } from '../templates.js';

describe('scene application service', () => {
  let db: DatabaseSync;
  let repository: SceneRepository;
  let service: SceneApplicationService;
  let now: number;
  const principal = { ownerId: 'local-owner', workspaceId: 'workspace' };
  const permissions = { accountIds: ['personal'], contextProviders: ['mail'], effectHandlers: [] };
  const input = { templateKey: 'mail-follow-up', templateVersion: '1.0.0', goal: 'Follow up', scope: { kind: 'objects', ids: ['message:1'] }, permissions };
  const authorize = vi.fn(async () => permissions);

  beforeEach(() => {
    now = 1000;
    authorize.mockReset().mockResolvedValue(permissions);
    db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON');
    db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
    repository = new SceneRepository(db);
    repository.installTemplate(mailFollowUpTemplate);
    service = new SceneApplicationService(repository, [{ id: 'mail', read: async () => [] }], authorize, () => now);
  });
  afterEach(() => db.close());

  it('preflights without creating an activation', async () => {
    expect(await service.preflight(principal, input)).toEqual({ ready: true, missing: [] });
    expect(repository.listActivations(principal)).toEqual([]);
  });
  it('does not silently discard excess requested permissions', async () => {
    const result = await service.preflight(principal, { ...input, permissions: { ...permissions, effectHandlers: ['send'] } });
    expect(result.ready).toBe(false);
    expect(result.missing).toContain('read_only_execution');
  });
  it('rejects ambiguous mail scope before creating anything', async () => {
    await expect(service.start(principal, { ...input, scope: { kind: 'personal' } }, 'request')).rejects.toThrow('setup');
    expect(repository.listActivations(principal)).toEqual([]);
  });
  it('creates one activation for repeated requests and rejects changed content', async () => {
    const first = await service.start(principal, input, 'request');
    const second = await service.start(principal, input, 'request');
    expect(first.status).toBe('active');
    expect(second.id).toBe(first.id);
    await expect(service.start(principal, { ...input, goal: 'Changed' }, 'request')).rejects.toThrow('reused');
    expect(repository.listActivations(principal)).toHaveLength(1);
  });
  it('does not resume a paused scene when an old start request is retried', async () => {
    const first = await service.start(principal, input, 'request');
    repository.transitionActivation(principal, first.id, first.revision, 'paused');
    expect((await service.start(principal, input, 'request')).status).toBe('paused');
  });
  it('uses a stable occurrence for repeated manual checks with a real event timestamp', async () => {
    const activation = await service.start(principal, input, 'request');
    const first = service.check(principal, activation.id, 'check');
    now = 2000;
    expect(service.check(principal, activation.id, 'check')).toBe(first);
    expect(db.prepare('SELECT occurred_at FROM scene_events').get()?.occurred_at).toBe(1000);
    expect(db.prepare('SELECT count(*) AS n FROM scene_trigger_intents').get()?.n).toBe(1);
  });
  it('rechecks current grants before resuming without changing a denied scene', async () => {
    const activation = await service.start(principal, input, 'request');
    const paused = await service.transition(principal, activation.id, { expectedRevision: activation.revision, status: 'paused' });
    authorize.mockResolvedValue({ ...permissions, accountIds: [] });
    await expect(service.transition(principal, activation.id, { expectedRevision: paused.revision, status: 'active' })).rejects.toThrow('setup');
    expect(repository.getActivation(principal, activation.id)).toEqual(paused);
  });
  it('fences a resume when activation changes while authorization is in flight', async () => {
    const activation = await service.start(principal, input, 'request');
    const paused = await service.transition(principal, activation.id, { expectedRevision: activation.revision, status: 'paused' });
    authorize.mockImplementationOnce(async () => {
      repository.transitionActivation(principal, activation.id, paused.revision, 'archived');
      return permissions;
    });
    await expect(service.transition(principal, activation.id, { expectedRevision: paused.revision, status: 'active' })).rejects.toThrow('changed');
    expect(repository.getActivation(principal, activation.id).status).toBe('archived');
  });
  it('configuration revokes execution immediately and requires explicit setup again', async () => {
    const activation = await service.start(principal, input, 'request');
    const item = repository.createWorkItem(principal, activation.id, { subjectId: 'message:1', accountId: 'personal', dueAt: 2000 }, now);
    service.check(principal, activation.id, 'check');
    const claim = repository.claimNext('worker', now)!;
    const configured = service.configure(principal, activation.id, {
      expectedRevision: activation.revision, goal: 'Different thread', scope: { kind: 'objects', ids: ['message:2'] }, permissions,
    });
    expect(configured.status).toBe('needs_setup');
    expect(configured.revision).toBe(activation.revision + 1);
    expect(repository.getRunInput(claim, now)).toBeNull();
    expect(repository.listWatchingWorkItems(principal)).toEqual([]);
    await service.transition(principal, activation.id, { expectedRevision: configured.revision, status: 'active' });
    expect(() => service.updateWorkItem(principal, item.id, { expectedRevision: item.revision + 1, status: 'watching' })).toThrow('scope');
  });
  it('allows revocation without requiring the revoked permission to remain available', async () => {
    const activation = await service.start(principal, input, 'request');
    authorize.mockResolvedValue({ accountIds: [], contextProviders: [], effectHandlers: [] });
    const configured = service.configure(principal, activation.id, { expectedRevision: activation.revision,
      goal: input.goal, scope: input.scope, permissions: { accountIds: [], contextProviders: [], effectHandlers: [] } });
    expect(configured.status).toBe('needs_setup');
    await expect(service.transition(principal, activation.id, { expectedRevision: configured.revision, status: 'active' })).rejects.toThrow('setup');
  });
  it('does not let configuration changes replace a pinned template', async () => {
    const activation = await service.start(principal, input, 'request');
    expect(() => service.configure(principal, activation.id, { expectedRevision: activation.revision, ...input })).toThrow();
    expect(repository.getActivation(principal, activation.id)).toEqual(activation);
  });
});
