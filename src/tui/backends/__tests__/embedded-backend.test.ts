import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const sessionConfigPatch = vi.fn(async () => ({ ok: true }));
  const agentStart = vi.fn(async () => undefined);
  const agentStop = vi.fn(async () => undefined);
  const sessionIndexInitialize = vi.fn(async () => undefined);
  const sessionIndexGetStore = vi.fn(() => ({}));
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

vi.mock('../../../config/schema.js', () => ({
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
});
