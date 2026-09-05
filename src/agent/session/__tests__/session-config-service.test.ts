import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConfigSchema } from '../../../config/schema.js';
import { ProjectService } from '../../../projects/project-service.js';
import {
  closeXopcDatabase,
  ensureSessionRecord,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
} from '../../../storage/sqlite/index.js';
import { SessionConfigStore } from '../../../session/config-store.js';
import { SessionConfigService } from '../session-config-service.js';

const SESSION_KEY = 'agent:main:webchat:default:direct:project-session-config';

const minimalConfig = ConfigSchema.parse({
  agents: {
    default: 'main',
    list: [
      {
        id: 'main',
        profile: { name: 'Main' },
        workspace: '~/default-ws',
      },
    ],
  },
});

describe('SessionConfigService project workspace', () => {
  let stateDir: string;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-session-config-project-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('rejects manual working directory changes for project sessions with a workspace root', async () => {
    ensureSessionRecord(SESSION_KEY, process.cwd());
    const projects = new ProjectService();
    mkdirSync(join(stateDir, 'project-root'), { recursive: true });
    const project = projects.create({
      name: 'Workspace Locked Project',
      workspaceRoot: join(stateDir, 'project-root'),
    });
    projects.attachSession(SESSION_KEY, project.id);

    const sessionConfigStore = new SessionConfigStore(stateDir, process.cwd());
    const updateSpy = vi.spyOn(sessionConfigStore, 'update');
    const service = new SessionConfigService({
      sessionStore: {
        load: vi.fn(async () => []),
      } as never,
      sessionConfigStore,
      modelManager: {
        switchModelForSession: vi.fn(async () => true),
        clearSessionModelOverride: vi.fn(),
        applyModelForSession: vi.fn(),
      } as never,
      agentManager: {
        setModelForSession: vi.fn(),
        getAgent: vi.fn(() => null),
        setThinkingLevel: vi.fn(),
        setSessionWorkspaceOverride: vi.fn(),
        removeAgent: vi.fn(),
      } as never,
      getConfig: () => minimalConfig,
    });

    const result = await service.patch(SESSION_KEY, {
      workingDirectory: join(stateDir, 'other-root'),
    });

    expect(result).toEqual({
      ok: false,
      error: 'Project sessions use the project workspace and cannot change working directory',
    });
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('stores and clears the activity detail session override', async () => {
    ensureSessionRecord(SESSION_KEY, process.cwd());
    const sessionConfigStore = new SessionConfigStore(stateDir, process.cwd());
    const service = new SessionConfigService({
      sessionStore: { load: vi.fn(async () => []) } as never,
      sessionConfigStore,
      modelManager: {} as never,
      agentManager: {} as never,
      getConfig: () => minimalConfig,
    });

    expect(await service.patch(SESSION_KEY, { activityDetailLevel: 'stream' })).toEqual({ ok: true });
    expect((await sessionConfigStore.get(SESSION_KEY))?.reasoningLevel).toBe('stream');

    expect(await service.patch(SESSION_KEY, { activityDetailLevel: null })).toEqual({ ok: true });
    expect((await sessionConfigStore.get(SESSION_KEY))?.reasoningLevel).toBeUndefined();
  });

  it('prefers the new activity detail field over the legacy field', async () => {
    ensureSessionRecord(SESSION_KEY, process.cwd());
    const sessionConfigStore = new SessionConfigStore(stateDir, process.cwd());
    const service = new SessionConfigService({
      sessionStore: { load: vi.fn(async () => []) } as never,
      sessionConfigStore,
      modelManager: {} as never,
      agentManager: {} as never,
      getConfig: () => minimalConfig,
    });

    const result = await service.patch(SESSION_KEY, {
      activityDetailLevel: 'off',
      reasoningLevel: 'stream',
    });

    expect(result).toEqual({ ok: true });
    expect((await sessionConfigStore.get(SESSION_KEY))?.reasoningLevel).toBe('off');
  });

  it('persists temporary user-context mode and rejects unknown modes', async () => {
    ensureSessionRecord(SESSION_KEY, process.cwd());
    const sessionConfigStore = new SessionConfigStore(stateDir, process.cwd());
    const service = new SessionConfigService({
      sessionStore: { load: vi.fn(async () => []) } as never,
      sessionConfigStore,
      modelManager: {} as never,
      agentManager: {} as never,
      getConfig: () => minimalConfig,
    });

    expect(await service.patch(SESSION_KEY, { userContextMode: 'temporary' })).toEqual({ ok: true });
    expect((await sessionConfigStore.get(SESSION_KEY))?.userContextMode).toBe('temporary');
    expect(await service.patch(SESSION_KEY, { userContextMode: 'invalid' as never }))
      .toEqual({ ok: false, error: 'Invalid user context mode' });
  });
  function modelFixture() {
    const sessionConfigStore = new SessionConfigStore(stateDir, process.cwd());
    const runtime = { getAgent: vi.fn(() => ({})), setModelForSession: vi.fn(), setThinkingLevel: vi.fn(), removeAgent: vi.fn() };
    const modelManager = {
      findByRef: vi.fn((ref: string) => ref === 'test/missing' ? undefined : ({
        provider: 'test', id: ref.split('/')[1], reasoning: true,
        thinkingLevelMap: { off: null, minimal: null, xhigh: null, max: 'max' },
      })),
      restoreSessionModel: vi.fn(),
      getModelForSession: () => 'test/first',
    };
    const service = new SessionConfigService({ sessionStore: {} as never, sessionConfigStore,
      modelManager: modelManager as never, agentManager: runtime as never, getConfig: () => minimalConfig });
    return { service, sessionConfigStore, runtime, modelManager };
  }

  it('commits model and level together and rejects stale writers without runtime changes', async () => {
    const { service, sessionConfigStore, runtime } = modelFixture();
    expect(await service.patch(SESSION_KEY, { model: 'test/first', thinkingLevel: 'high', fixedModel: true, configVersion: 0 })).toEqual({ ok: true });
    const saved = await sessionConfigStore.get(SESSION_KEY);
    expect(saved).toMatchObject({ modelOverride: 'test/first', thinkingLevel: 'high', fixedModel: true });
    runtime.setModelForSession.mockClear();
    expect(await service.patch(SESSION_KEY, { model: 'test/second', thinkingLevel: 'off', configVersion: saved!.updatedAt })).toMatchObject({ ok: false, code: 'INVALID_THINKING' });
    expect(await sessionConfigStore.get(SESSION_KEY)).toEqual(saved);
    expect(await service.patch(SESSION_KEY, { model: 'test/second', thinkingLevel: 'low', configVersion: 0 })).toMatchObject({ ok: false, code: 'CONFIG_CHANGED' });
    expect(runtime.setModelForSession).not.toHaveBeenCalled();
    expect(await service.patch(SESSION_KEY, { model: 'test/second', thinkingLevel: 'max', configVersion: saved!.updatedAt })).toEqual({ ok: true });
    expect((await sessionConfigStore.get(SESSION_KEY))!.updatedAt).toBeGreaterThan(saved!.updatedAt!);
  });

  it('keeps persisted configuration authoritative if runtime synchronization fails', async () => {
    const { service, sessionConfigStore, runtime } = modelFixture();
    runtime.setModelForSession.mockImplementation(() => { throw new Error('Runtime unavailable'); });
    expect(await service.patch(SESSION_KEY, { model: 'test/first', thinkingLevel: 'high', fixedModel: true })).toEqual({ ok: true });
    expect(await sessionConfigStore.get(SESSION_KEY)).toMatchObject({ modelOverride: 'test/first', thinkingLevel: 'high' });
    expect(runtime.removeAgent).toHaveBeenCalledWith(SESSION_KEY);
  });

  it('restores unavailable models visibly and normalizes stale effort preferences for new chats', async () => {
    const { service, sessionConfigStore, modelManager } = modelFixture();
    await service.initializeModelSelection(SESSION_KEY, 'test/missing', 'high');
    expect(await sessionConfigStore.get(SESSION_KEY)).toMatchObject({ modelOverride: 'test/missing', fixedModel: true });
    expect(modelManager.restoreSessionModel).toHaveBeenCalledWith(SESSION_KEY, 'test/missing', true);
    await service.initializeModelSelection(SESSION_KEY, 'test/first', 'adaptive');
    expect(await sessionConfigStore.get(SESSION_KEY)).toMatchObject({ modelOverride: 'test/first', thinkingLevel: 'medium' });
  });

  it('saves model selection for a lazy session without mutating an absent Agent', async () => {
    const { service, sessionConfigStore, runtime } = modelFixture();
    runtime.getAgent.mockReturnValue(undefined as never);
    expect(await service.patch(SESSION_KEY, { model: 'test/first', thinkingLevel: 'high' })).toEqual({ ok: true });
    expect(await sessionConfigStore.get(SESSION_KEY)).toMatchObject({ modelOverride: 'test/first', thinkingLevel: 'high' });
    expect(runtime.setModelForSession).not.toHaveBeenCalled();
    expect(runtime.setThinkingLevel).not.toHaveBeenCalled();
  });

});
