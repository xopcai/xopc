import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const sessionConfigPatch = vi.fn(async () => ({ ok: true }));
  const agentStart = vi.fn(async () => undefined);
  const agentStop = vi.fn(async () => undefined);
  const sessionIndexInitialize = vi.fn(async () => undefined);
  const sessionIndexGetStore = vi.fn(() => ({}));
  const cloudModelRefresh = vi.fn(async () => ({
    status: 'skipped' as const,
    reason: 'not_configured' as const,
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

vi.mock('../../../providers/xopc-cloud-model-source.js', () => ({
  XopcCloudModelSource: class {
    refresh = mocks.cloudModelRefresh;
  },
}));

import { EmbeddedBackend } from '../embedded-backend.js';

describe('EmbeddedBackend', () => {
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
        status: 'updated',
        modelCount: 1,
        models: ['deepseek-v4-flash'],
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
