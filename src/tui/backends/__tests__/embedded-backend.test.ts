import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { EmbeddedDraftStore } from '../embedded-drafts.js';
import { openXopcDatabase, closeXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../../storage/sqlite/connection.js';
import { getSessionMetadata } from '../../../storage/sqlite/session-repository.js';
import { claimNextSessionInput, getSessionInputById } from '../../../storage/sqlite/session-input-repository.js';
import { acceptSessionCommand, getSessionInputReceipt } from '../../../storage/sqlite/session-creation-repository.js';

const mocks = vi.hoisted(() => {
  const sessionConfigPatch = vi.fn(async () => ({ ok: true }));
  const agentStart = vi.fn(async () => undefined);
  const agentStop = vi.fn(async () => undefined);
  const sessionIndexInitialize = vi.fn(async () => undefined);
  const sessionIndexGetStore = vi.fn(() => ({}));
  const cloudModelRefresh = vi.fn(async () => ({
    state: 'not-authorized' as const,
    source: 'none' as const,
    modelCount: 0,
  }));
  const agentService = vi.fn(function MockAgentService() {
    return {
      sessionConfig: { patch: sessionConfigPatch },
      start: agentStart,
      stop: agentStop,
    };
  });

  return {
    agentService,
    agentStart,
    agentStop,
    sessionConfigPatch,
    sessionIndexInitialize,
    sessionIndexGetStore,
    cloudModelRefresh,
  };
});

vi.mock('../../../agent/service.js', () => ({
  AgentService: mocks.agentService,
}));

vi.mock('../../../config/index.js', () => ({
  getWorkspacePath: () => '/tmp/xopc-workspace',
  loadConfig: () => ({}),
  saveConfig: vi.fn(async () => undefined),
}));

vi.mock('../../../config/schema.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../config/schema.js')>(),
  getAgentDefaultModelRef: () => 'openai/test',
}));
vi.mock('../../../config/agent-profile.js', () => ({
  resolveEffectiveAgentProfile: (agentId: string) => ({ agentId, primaryModelRef: 'openai/test', resolvedWorkspacePath: '/tmp/workspace' }),
}));

vi.mock('../../../infra/bus/index.js', () => {
  class MessageBusShutdownError extends Error {}
  return {
    MessageBusShutdownError,
    MessageBus: class {
      shutdown = vi.fn();
      consumeOutbound = vi.fn(async () => {
        throw new MessageBusShutdownError();
      });
    },
  };
});

vi.mock('../../../session/index.js', () => ({
  SessionIndex: class {
    initialize = mocks.sessionIndexInitialize;
    getStore = mocks.sessionIndexGetStore;
  },
}));

vi.mock('../../../storage/sqlite/index.js', () => ({
  openXopcDatabase: vi.fn(),
}));

vi.mock('../../../providers/xopc-cloud-catalog-coordinator.js', () => ({
  getXopcCloudCatalogCoordinator: () => ({
    ensure: mocks.cloudModelRefresh,
  }),
}));

import { EmbeddedBackend } from '../embedded-backend.js';

describe('EmbeddedBackend', () => {
  it('recovers an orphan claim without replay and retries the original durable input explicitly', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'xopc-embedded-recovery-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(directory, 'test.db') });
    try {
      const backend = new EmbeddedBackend({ config: {} as never });
      const store = new EmbeddedDraftStore(directory);
      (backend as unknown as { drafts: EmbeddedDraftStore }).drafts = store;
      const execute = vi.fn(async function* () {});
      (backend as unknown as { ensureAgent: unknown }).ensureAgent = async () => ({ turnDispatcher: { processDirectStreaming: execute } });
      const id = await backend.createConversation('writer');
      const draft = store.read(id)!;
      draft.command = { kind: 'start', clientMessageId: '22222222-2222-4222-8222-222222222222',
        creation: draft.creation, input: { content: 'hello' }, origin: { type: 'system', source: 'cli' } };
      draft.ownerPid = process.pid;
      store.save(id, draft);
      const receipt = acceptSessionCommand({ conversationId: id, principalId: 'local:tui', sourceChannel: 'tui', command: draft.command,
        preparedInput: { content: 'hello', requestedDelivery: 'next', effectiveDelivery: 'next', status: 'queued', origin: draft.command.origin } });
      claimNextSessionInput(id, 'old-run', receipt.inputId!);
      expect((await backend.getChatInputState(id)).inputs[0].status).toBe('running');
      const probe = vi.spyOn(process, 'kill').mockImplementation(() => { throw Object.assign(new Error('gone'), { code: 'ESRCH' }); });
      let recoveryRevision = 0;
      try {
        const state = await backend.getChatInputState(id);
        recoveryRevision = state.revision;
        expect(state.inputs[0].status).toBe('interrupted');
        expect(state.activeRunId).toBeUndefined();
        expect(execute).not.toHaveBeenCalled();
      } finally { probe.mockRestore(); }
      await backend.sendChat({ conversationId: id, message: 'hello' });
      await vi.waitFor(() => expect(getSessionInputById(id, receipt.inputId!)?.status).toBe('completed'));
      expect(getSessionInputReceipt(id, draft.command.clientMessageId, 'local:tui')?.inputId).toBe(receipt.inputId);
      expect(store.read(id)).toBeUndefined();
      const completed = await backend.getChatInputState(id);
      expect(completed.inputs).toEqual([]);
      expect(completed.revision).toBeGreaterThan(recoveryRevision);
    } finally { closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); rmSync(directory, { recursive: true, force: true }); }
  });
  it('freezes the first input before agent initialization and atomically accepts it on retry', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'xopc-embedded-input-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(directory, 'test.db') });
    try {
      const backend = new EmbeddedBackend({ config: {} as never });
      const store = new EmbeddedDraftStore(directory);
      (backend as unknown as { drafts: EmbeddedDraftStore }).drafts = store;
      const ensureAgent = vi.fn().mockRejectedValueOnce(new Error('agent unavailable')).mockResolvedValue({
        turnDispatcher: { processDirectStreaming: async function* () { yield { type: 'message_start', message: { role: 'user', content: 'hello' } }; } },
      });
      (backend as unknown as { ensureAgent: typeof ensureAgent }).ensureAgent = ensureAgent;
      const id = await backend.createConversation('writer');
      expect(getSessionMetadata(id)).toBeNull();
      await expect(backend.sendChat({ conversationId: id, message: 'hello' })).rejects.toThrow('agent unavailable');
      const clientMessageId = store.read(id)?.command?.clientMessageId;
      expect(clientMessageId).toBeTruthy();
      expect(getSessionMetadata(id)).toBeNull();
      await expect(backend.sendChat({ conversationId: id, message: 'changed' })).rejects.toThrow('awaiting confirmation');
      const result = await backend.sendChat({ conversationId: id, message: 'hello' });
      expect(getSessionMetadata(id)).toMatchObject({ sourceChannel: 'tui', agentId: 'writer' });
      const receipt = getSessionInputReceipt(id, clientMessageId!, 'local:tui')!;
      await vi.waitFor(() => expect(getSessionInputById(id, receipt.inputId!)).toMatchObject({ clientMessageId, runId: result.runId, status: 'completed' }));
      expect(store.read(id)).toBeUndefined();
    } finally { closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); rmSync(directory, { recursive: true, force: true }); }
  });

  it('creates, restores, edits and discards a local draft without starting the agent', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'xopc-embedded-draft-'));
    try {
      const backend = new EmbeddedBackend({ config: {} as never });
      (backend as unknown as { drafts: EmbeddedDraftStore }).drafts = new EmbeddedDraftStore(directory);
      const id = await backend.createConversation('writer');
      await backend.patchSession(id, { model: 'openai/selected', workingDirectory: '/tmp/chosen' });
      expect(await backend.getSessionInfo(id)).toMatchObject({ agentId: 'writer', model: 'selected', effectiveWorkspacePath: '/tmp/chosen' });
      expect(await backend.loadHistory({ conversationId: id })).toEqual({ messages: [] });
      expect(new EmbeddedDraftStore(directory).read(id)?.creation.model).toBe('openai/selected');
      expect(mocks.agentService).not.toHaveBeenCalled();
      expect(await backend.deleteSession(id)).toEqual({ ok: true });
      expect(() => readFileSync(join(directory, `${id}.json`))).toThrow();
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('applies session patches even when the agent has not been eagerly created yet', async () => {
    vi.useFakeTimers();
    const backend = new EmbeddedBackend({ config: {} as never });

    backend.start();
    await backend.patchSession('agent:coder:tui-test', {
      workingDirectory: '/tmp/project',
    });

    expect(mocks.agentService).toHaveBeenCalledTimes(1);
    expect(mocks.sessionConfigPatch).toHaveBeenCalledWith(
      'agent:coder:tui-test',
      expect.objectContaining({ workingDirectory: '/tmp/project' }),
    );

    backend.stop();
  });

  it('starts lazily when an agent operation happens before explicit start', async () => {
    const backend = new EmbeddedBackend({ config: {} as never });
    const connected = vi.fn();
    backend.onConnected = connected;

    await backend.patchSession('agent:coder:tui-start-race', {
      workingDirectory: '/tmp/project',
    });

    expect(connected).toHaveBeenCalledTimes(1);
    expect(mocks.sessionIndexInitialize).toHaveBeenCalledTimes(1);
    expect(mocks.agentService).toHaveBeenCalledTimes(1);
    expect(mocks.sessionConfigPatch).toHaveBeenCalledWith(
      'agent:coder:tui-start-race',
      expect.objectContaining({ workingDirectory: '/tmp/project' }),
    );

    backend.stop();
  });

  it('refreshes XOPC Cloud models before creating the embedded agent', async () => {
    mocks.cloudModelRefresh.mockImplementationOnce(async () => {
      expect(mocks.agentService).not.toHaveBeenCalled();
      return {
        state: 'ready',
        source: 'network',
        modelCount: 1,
      };
    });
    const backend = new EmbeddedBackend({ config: {} as never });

    await backend.patchSession('agent:coder:tui-cloud-model', {
      model: 'xopc-cloud/deepseek-v4-flash',
    });

    expect(mocks.cloudModelRefresh).toHaveBeenCalledTimes(1);
    expect(mocks.agentService).toHaveBeenCalledTimes(1);
    backend.stop();
  });

  it('continues with built-in models when XOPC Cloud refresh fails', async () => {
    mocks.cloudModelRefresh.mockRejectedValueOnce(new Error('router unavailable'));
    const backend = new EmbeddedBackend({ config: {} as never });

    await backend.patchSession('agent:coder:tui-cloud-fallback', {
      model: 'openai/test',
    });

    expect(mocks.agentService).toHaveBeenCalledTimes(1);
    backend.stop();
  });

  it('can refresh cloud models after OAuth login', async () => {
    const backend = new EmbeddedBackend({ config: {} as never });

    await backend.refreshModels();

    expect(mocks.cloudModelRefresh).toHaveBeenCalledTimes(1);
    expect(mocks.agentService).not.toHaveBeenCalled();
    backend.stop();
  });
});
