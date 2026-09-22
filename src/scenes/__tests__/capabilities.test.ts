import { DatabaseSync } from 'node:sqlite';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CapabilityDispatcher, type CapabilityContext } from '../../capabilities/runtime/dispatcher.js';
import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../storage/sqlite/index.js';
import { getSqliteDatabase } from '../../storage/sqlite/transaction.js';
import { registerSceneWriteCapabilities } from '../capabilities/write.js';
import type { SceneHttpServices } from '../httpServices.js';
import { SceneRepository } from '../repository.js';
import { SceneApplicationService } from '../service.js';
import { ScenePreferenceService } from '../preferences.js';
import { familyPlanTemplate } from '../templates.js';

describe('atomic scene capabilities', () => {
  const principal = { ownerId: 'owner', workspaceId: 'workspace' };
  const context: CapabilityContext = { principalId: 'owner', surface: 'http', scopes: ['gateway.admin'], authorize: () => true };
  let repository: SceneRepository;
  let application: SceneApplicationService;
  let dispatcher: CapabilityDispatcher;
  let id: string;
  beforeEach(() => {
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: ':memory:' });
    repository = new SceneRepository(getSqliteDatabase());
    repository.installTemplate(familyPlanTemplate);
    const activation = repository.createActivation(principal, { templateKey: familyPlanTemplate.key, templateVersion: familyPlanTemplate.version,
      goal: 'Plan the week', scope: { kind: 'personal' }, permissions: { accountIds: [], contextProviders: ['user_notes'], effectHandlers: [] } });
    id = activation.id;
    repository.transitionActivation(principal, id, activation.revision, 'active');
    application = new SceneApplicationService(repository, [{ id: 'user_notes', read: async () => [] }], async () => activation.permissions);
    dispatcher = new CapabilityDispatcher();
    registerSceneWriteCapabilities(dispatcher, () => ({ principal, services: {
      application, preferences: new ScenePreferenceService(getSqliteDatabase()),
    } as SceneHttpServices }));
  });
  afterEach(() => {
    vi.restoreAllMocks();
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
  });
  const call = (operation: string, input: unknown, key: string, caller = context) => dispatcher.call(operation, input, caller,
    { ...dispatcher.describe(operation, caller), idempotencyKey: key });

  it('starts once and replays the accepted state without resuming a subsequently paused scene', async () => {
    const { templateKey, templateVersion, goal, scope, permissions } = repository.getActivation(principal, id);
    const input = { templateKey, templateVersion, goal, scope, permissions };
    const first = await call('xopc.scenes.start', input, 'start') as { activation: { id: string; revision: number } };
    const preflight = vi.spyOn(application, 'preflight');
    await call('xopc.scenes.transition', { id: first.activation.id, expectedRevision: first.activation.revision, status: 'paused' }, 'pause');
    expect(await call('xopc.scenes.start', input, 'start', { ...context, surface: 'agent' })).toEqual(first);
    expect(preflight).not.toHaveBeenCalled();
    expect(repository.listActivations(principal)).toHaveLength(2);
    expect(repository.getActivation(principal, first.activation.id).status).toBe('paused');
  });

  it('rolls back scene creation when the final output is invalid', async () => {
    const { templateKey, templateVersion, goal, scope, permissions } = repository.getActivation(principal, id);
    const input = { templateKey, templateVersion, goal, scope, permissions };
    const original = application.startAfterPreflight.bind(application);
    vi.spyOn(application, 'startAfterPreflight').mockImplementationOnce((...args) => ({ ...original(...args), revision: -1 }));
    await expect(call('xopc.scenes.start', input, 'start')).rejects.toMatchObject({ code: 'INTERNAL' });
    expect(repository.listActivations(principal)).toHaveLength(1);
    expect(await call('xopc.scenes.start', input, 'start')).toMatchObject({ activation: { status: 'active' } });
  });

  it('rejects a transition changed while readiness was being checked', async () => {
    const revision = repository.getActivation(principal, id).revision;
    const paused = repository.transitionActivation(principal, id, revision, 'paused');
    const original = application.prepareTransition.bind(application);
    vi.spyOn(application, 'prepareTransition').mockImplementationOnce(async (...args) => {
      await original(...args);
      repository.transitionActivation(principal, id, paused.revision, 'archived');
    });
    await expect(call('xopc.scenes.transition', { id, expectedRevision: paused.revision, status: 'active' }, 'resume'))
      .rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    expect(repository.getActivation(principal, id).status).toBe('archived');
  });

  it('replays a notes receipt across surfaces without overwriting a later edit', async () => {
    const input = { id, expectedRevision: 0, content: 'First' };
    expect(await call('xopc.scenes.notes', input, 'notes')).toEqual({ revision: 1 });
    application.writeNotes(principal, id, { expectedRevision: 1, content: 'Later' });
    expect(await call('xopc.scenes.notes', input, 'notes', { ...context, surface: 'agent' })).toEqual({ revision: 1 });
    expect(repository.readNotes(principal, id)).toMatchObject({ content: 'Later', revision: 2 });
    await expect(call('xopc.scenes.notes', { ...input, content: 'Different' }, 'notes')).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    await expect(call('xopc.scenes.notes', input, 'notes', { ...context, authorize: () => false })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('rolls back notes and permits the same request after output validation fails', async () => {
    const original = application.writeNotes.bind(application);
    const fault = vi.spyOn(application, 'writeNotes').mockImplementationOnce((...args) => { original(...args); return -1; });
    const input = { id, expectedRevision: 0, content: 'Recovered' };
    await expect(call('xopc.scenes.notes', input, 'recover')).rejects.toMatchObject({ code: 'INTERNAL' });
    expect(repository.readNotes(principal, id)?.revision ?? 0).toBe(0);
    fault.mockRestore();
    expect(await call('xopc.scenes.notes', input, 'recover')).toEqual({ revision: 1 });
  });

  it('queues one check and rechecks authorization on replay', async () => {
    const first = await call('xopc.scenes.check', { id }, 'check');
    expect(await call('xopc.scenes.check', { id }, 'check', { ...context, surface: 'agent' })).toEqual(first);
    expect(getSqliteDatabase().prepare('SELECT * FROM scene_trigger_intents').all()).toHaveLength(1);
    await expect(call('xopc.scenes.check', { id }, 'check', { ...context, authorize: () => false })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('does not replay a receipt after the trusted workspace changes', async () => {
    const input = { id, expectedRevision: 0, content: 'Private' };
    await call('xopc.scenes.notes', input, 'scope');
    const other = new CapabilityDispatcher();
    registerSceneWriteCapabilities(other, () => ({ principal: { ...principal, workspaceId: 'other' }, services: { application } as SceneHttpServices }));
    const operation = 'xopc.scenes.notes';
    await expect(other.call(operation, input, context, { ...other.describe(operation, context), idempotencyKey: 'scope' }))
      .rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
  });

  it('preserves unspecified preferences and replays without resetting newer choices', async () => {
    const preferences = new ScenePreferenceService(getSqliteDatabase());
    preferences.update(principal, { expectedRevision: 0, level: 'quiet', timezone: 'UTC', digestEnabled: true });
    const input = { expectedRevision: 1, notificationsMuted: true };
    const first = await call('xopc.scenes.set_preferences', input, 'preferences');
    expect(first).toMatchObject({ level: 'quiet', timezone: 'UTC', digestEnabled: true, notificationsMuted: true, revision: 2 });
    preferences.update(principal, { expectedRevision: 2, notificationsMuted: false });
    expect(await call('xopc.scenes.set_preferences', input, 'preferences')).toEqual(first);
    expect(preferences.get(principal)).toMatchObject({ notificationsMuted: false, revision: 3 });
  });

  it('does not commit a queued check when its receipt cannot be validated', async () => {
    const original = application.check.bind(application);
    vi.spyOn(application, 'check').mockImplementationOnce((...args) => { original(...args); return 42 as never; });
    await expect(call('xopc.scenes.check', { id }, 'check')).rejects.toMatchObject({ code: 'INTERNAL' });
    expect(getSqliteDatabase().prepare('SELECT * FROM scene_trigger_intents').all()).toHaveLength(0);
    expect(getSqliteDatabase().prepare('SELECT * FROM scene_events').all()).toHaveLength(0);
  });

  it('rejects a service bound to a different database before writing', async () => {
    const other = new DatabaseSync(':memory:');
    try {
      const separate = new CapabilityDispatcher();
      registerSceneWriteCapabilities(separate, () => ({ principal, services: {
        application: new SceneApplicationService(new SceneRepository(other), [], async () => ({ accountIds: [], contextProviders: [], effectHandlers: [] })),
      } as SceneHttpServices }));
      const operation = 'xopc.scenes.notes';
      await expect(separate.call(operation, { id, expectedRevision: 0, content: 'Denied' }, context,
        { ...separate.describe(operation, context), idempotencyKey: 'separate' })).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    } finally { other.close(); }
  });
});
