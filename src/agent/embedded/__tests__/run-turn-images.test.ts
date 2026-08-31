import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentMessage } from '@earendil-works/pi-agent-core';

const mocks = vi.hoisted(() => ({
  prompt: vi.fn(),
  waitForIdle: vi.fn(),
  baseStreamFn: vi.fn(),
  retryTurn: vi.fn(),
  assistantError: vi.fn(),
  compact: vi.fn(),
  loadMessages: vi.fn(),
  acquireRunLease: vi.fn(),
  debug: vi.fn(),
  session: undefined as any,
  leaseController: undefined as AbortController | undefined,
}));

vi.mock('../../../utils/logger.js', () => ({
  createLogger: () => ({
    debug: mocks.debug,
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('../session-runner.js', () => ({
  evictEmbeddedSessionRunner: vi.fn(),
  acquireEmbeddedSessionRunner: vi.fn().mockImplementation(async () => {
    const session = {
      prompt: mocks.prompt,
      agent: {
        streamFunction: mocks.baseStreamFn,
        waitForIdle: mocks.waitForIdle,
        continue: vi.fn(),
        state: { messages: [] },
      },
      abort: vi.fn(),
    };
    mocks.session = session;
    return {
      session,
      piSm: {
        flushPendingToolResults: vi.fn(),
      },
      reused: false,
      release: vi.fn(),
    };
  }),
}));

vi.mock('../transcript-runtime.js', () => ({
  createSqliteTranscriptRuntime: vi.fn().mockResolvedValue({
    runtimeId: 'agent:main:test',
    sessionId: 'session-1',
    persistent: true,
    openSessionManager: vi.fn(),
    loadMessages: mocks.loadMessages,
    compact: mocks.compact,
  }),
}));

vi.mock('../runs.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../runs.js')>()),
  acquireEmbeddedRunLease: (...args: unknown[]) => mocks.acquireRunLease(...args),
}));

vi.mock('../subscribe-session.js', () => ({
  subscribeEmbeddedSessionEvents: vi.fn().mockReturnValue(() => {}),
  lastAssistantPlainText: vi.fn().mockReturnValue('done'),
}));

vi.mock('../../orchestration/run-agent-turn-with-timeout.js', () => ({
  runAgentTurnWithTimeout: vi.fn().mockImplementation(async (_agent, fn) => fn()),
  resolveAgentTurnTimeoutMs: vi.fn().mockReturnValue(60_000),
  isAgentTurnUnsettledError: vi.fn().mockReturnValue(false),
}));

vi.mock('../../orchestration/llm-turn-retry.js', () => ({
  getAssistantTurnErrorMessage: (...args: unknown[]) => mocks.assistantError(...args),
  isAssistantTurnAborted: vi.fn().mockReturnValue(false),
  isAssistantTurnFailed: vi.fn().mockReturnValue(false),
  maybeRetryTurnAfterTransientLlmFailure: (...args: unknown[]) => mocks.retryTurn(...args),
  stripTrailingErrorAssistantMessages: vi.fn((messages) => messages),
}));

vi.mock('../../orchestration/loop-guard.js', () => ({
  detectToolLoops: vi.fn().mockReturnValue({ hiddenTools: new Set(), injection: null }),
}));

vi.mock('../xopc-stream-bridge.js', () => ({
  wrapStreamFnForXopcExtensions: vi.fn((streamFn) => streamFn),
}));

import { runXopcEmbeddedTurn } from '../run-turn.js';
import { EmbeddedRunConflictError } from '../runs.js';

describe('runXopcEmbeddedTurn image input', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.leaseController = new AbortController();
    mocks.acquireRunLease.mockReturnValue({
      signal: mocks.leaseController.signal,
      attach: vi.fn(),
      release: vi.fn(),
    });
    mocks.waitForIdle.mockResolvedValue(undefined);
    mocks.retryTurn.mockResolvedValue(undefined);
    mocks.assistantError.mockReturnValue(undefined);
    mocks.compact.mockResolvedValue({
      compacted: true,
      tokensBefore: 100,
      tokensAfter: 50,
      summary: 'Compacted context.',
    });
    mocks.loadMessages.mockResolvedValue([]);
    delete process.env.XOPC_LOG_LLM_PAYLOAD;
  });

  afterEach(() => {
    delete process.env.XOPC_LOG_LLM_PAYLOAD;
  });

  it('passes hydrated params.images to session.prompt (not inline content blocks)', async () => {
    const userMessage = {
      role: 'user',
      content: 'What is in this image?',
      timestamp: 1,
    } as AgentMessage;

    await runXopcEmbeddedTurn({
      sessionKey: 'agent:main:test',
      runId: 'run-1',
      userMessage,
      model: { id: 'gpt-4o', provider: 'openai' } as any,
      modelRef: 'openai/gpt-4o',
      tools: [],
      systemPrompt: 'system',
      workspaceDir: '/tmp/workspace',
      sessionStore: {} as any,
      timeoutMs: 60_000,
      images: [{ type: 'image', data: 'aW1hZ2U=', mimeType: 'image/png' }],
    });

    expect(mocks.prompt).toHaveBeenCalledWith('What is in this image?', {
      images: [{ type: 'image', data: 'aW1hZ2U=', mimeType: 'image/png' }],
    });
  });

  it('installs and resets the authoritative turn policy on the embedded agent', async () => {
    const turnPolicy = {
      reset: vi.fn(),
      beforeToolCall: vi.fn(),
      afterToolCall: vi.fn(),
      shouldStopAfterTurn: vi.fn(),
    };

    await runXopcEmbeddedTurn({
      sessionKey: 'agent:main:test',
      runId: 'run-policy',
      userMessage: { role: 'user', content: 'hello', timestamp: 1 } as AgentMessage,
      model: { id: 'gpt-4o', provider: 'openai' } as any,
      modelRef: 'openai/gpt-4o',
      tools: [],
      systemPrompt: 'system',
      workspaceDir: '/tmp/workspace',
      sessionStore: {} as any,
      timeoutMs: 60_000,
      turnPolicy,
    });

    expect(turnPolicy.reset).toHaveBeenCalledOnce();
    expect(mocks.session.agent.beforeToolCall).toBe(turnPolicy.beforeToolCall);
    expect(mocks.session.agent.afterToolCall).toBe(turnPolicy.afterToolCall);
    expect(mocks.session.agent.shouldStopAfterTurn).toBe(turnPolicy.shouldStopAfterTurn);
  });

  it('reports external cancellation as a failed run outcome', async () => {
    const controller = new AbortController();
    mocks.waitForIdle.mockImplementationOnce(async () => {
      controller.abort();
    });

    const result = await runXopcEmbeddedTurn({
      sessionKey: 'agent:main:test',
      runId: 'run-aborted',
      userMessage: { role: 'user', content: 'hello', timestamp: 1 } as AgentMessage,
      model: { id: 'gpt-4o', provider: 'openai' } as any,
      modelRef: 'openai/gpt-4o',
      tools: [],
      systemPrompt: 'system',
      workspaceDir: '/tmp/workspace',
      sessionStore: {} as any,
      timeoutMs: 60_000,
      abortSignal: controller.signal,
    });

    expect(result).toEqual({ ok: false, errorMessage: 'aborted' });
  });

  it('propagates run-lease cancellation through model recovery', async () => {
    mocks.waitForIdle.mockImplementationOnce(async () => {
      mocks.leaseController?.abort();
    });

    const result = await runXopcEmbeddedTurn({
      sessionKey: 'agent:main:test',
      runId: 'run-lease-aborted',
      userMessage: { role: 'user', content: 'hello', timestamp: 1 } as AgentMessage,
      model: { id: 'gpt-4o', provider: 'openai' } as any,
      modelRef: 'openai/gpt-4o',
      tools: [],
      systemPrompt: 'system',
      workspaceDir: '/tmp/workspace',
      sessionStore: {} as any,
      timeoutMs: 60_000,
    });

    expect(result).toEqual({ ok: false, errorMessage: 'aborted' });
    expect(mocks.retryTurn).toHaveBeenCalledOnce();
    const retryOptions = mocks.retryTurn.mock.calls[0]?.[1] as { signal?: AbortSignal };
    expect(retryOptions.signal).toBeInstanceOf(AbortSignal);
    expect(retryOptions.signal?.aborted).toBe(true);
  });

  it('passes the run-lease signal to context overflow compaction', async () => {
    mocks.assistantError.mockReturnValueOnce('maximum context length exceeded');

    await runXopcEmbeddedTurn({
      sessionKey: 'agent:main:test',
      runId: 'run-overflow',
      userMessage: { role: 'user', content: 'hello', timestamp: 1 } as AgentMessage,
      model: { id: 'gpt-4o', provider: 'openai' } as any,
      modelRef: 'openai/gpt-4o',
      tools: [],
      systemPrompt: 'system',
      workspaceDir: '/tmp/workspace',
      sessionStore: {} as any,
      timeoutMs: 60_000,
    });

    expect(mocks.compact).toHaveBeenCalledWith(
      [],
      { id: 'gpt-4o', provider: 'openai' },
      expect.any(String),
      true,
      { signal: mocks.leaseController?.signal },
    );
  });

  it('marks run ownership conflicts as non-retryable harness failures', async () => {
    mocks.acquireRunLease.mockImplementationOnce(() => {
      throw new EmbeddedRunConflictError('agent:main:test', 'run-active');
    });

    const result = await runXopcEmbeddedTurn({
      sessionKey: 'agent:main:test',
      runId: 'run-conflict',
      userMessage: { role: 'user', content: 'hello', timestamp: 1 } as AgentMessage,
      model: { id: 'gpt-4o', provider: 'openai' } as any,
      modelRef: 'openai/gpt-4o',
      tools: [],
      systemPrompt: 'system',
      workspaceDir: '/tmp/workspace',
      sessionStore: {} as any,
      timeoutMs: 60_000,
    });

    expect(result).toEqual({
      ok: false,
      retryable: false,
      errorMessage: "Session 'agent:main:test' already has active embedded run 'run-active'",
    });
  });

  it('ignores legacy inline image blocks on userMessage.content', async () => {
    const userMessage = {
      role: 'user',
      content: [{ type: 'image', data: 'ZnJvbS11c2Vy', mimeType: 'image/jpeg' }],
      timestamp: 1,
    } as AgentMessage;

    await runXopcEmbeddedTurn({
      sessionKey: 'agent:main:test',
      runId: 'run-2',
      userMessage,
      model: { id: 'gpt-4o', provider: 'openai' } as any,
      modelRef: 'openai/gpt-4o',
      tools: [],
      systemPrompt: 'system',
      workspaceDir: '/tmp/workspace',
      sessionStore: {} as any,
      timeoutMs: 60_000,
      images: [{ type: 'image', data: 'ZnJvbS1wYXJhbXM=', mimeType: 'image/png' }],
    });

    expect(mocks.prompt).toHaveBeenCalledWith('', {
      images: [{ type: 'image', data: 'ZnJvbS1wYXJhbXM=', mimeType: 'image/png' }],
    });
  });

  it('logs the complete effective context only when payload logging is enabled', async () => {
    await runXopcEmbeddedTurn({
      sessionKey: 'agent:main:test',
      runId: 'run-3',
      userMessage: { role: 'user', content: 'hello', timestamp: 1 } as AgentMessage,
      model: { id: 'gpt-4o', provider: 'openai' } as any,
      modelRef: 'openai/gpt-4o',
      tools: [],
      systemPrompt: 'system',
      workspaceDir: '/tmp/workspace',
      sessionStore: {} as any,
      timeoutMs: 60_000,
    });

    const effectiveContext = {
      systemPrompt: 'complete system prompt',
      messages: [{ role: 'user', content: 'complete user message', timestamp: 1 }],
      tools: [{ name: 'example_tool', description: 'Example tool' }],
    };

    mocks.session.agent.streamFunction(
      { id: 'gpt-4o', provider: 'openai' },
      effectiveContext,
      {},
    );
    expect(mocks.debug).toHaveBeenLastCalledWith(
      expect.not.objectContaining({ effectiveContext: expect.anything() }),
      'Sending messages to AI',
    );

    process.env.XOPC_LOG_LLM_PAYLOAD = 'true';
    mocks.session.agent.streamFunction(
      { id: 'gpt-4o', provider: 'openai' },
      effectiveContext,
      {},
    );

    expect(mocks.debug).toHaveBeenCalledWith(
      expect.objectContaining({ effectiveContext }),
      'Sending messages to AI',
    );
  });
});
