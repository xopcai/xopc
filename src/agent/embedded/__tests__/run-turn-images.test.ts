import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentMessage } from '@earendil-works/pi-agent-core';

const mocks = vi.hoisted(() => ({
  connectionSuspended: vi.fn(),
  connectionResume: vi.fn(),
  customMessage: vi.fn(),
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

vi.mock('../../../storage/sqlite/connection-wait-repository.js', () => ({
  isConnectionSuspended: (...args: unknown[]) => mocks.connectionSuspended(...args),
  getConnectionResumeInput: (...args: unknown[]) => mocks.connectionResume(...args),
}));

vi.mock('../../../storage/sqlite/session-repository.js', () => ({ getSessionMetadata: () => ({ agentId: 'main' }) }));
vi.mock('../../../storage/sqlite/clarification-wait-repository.js', () => ({
  isClarificationSuspended: () => false, getClarificationResumeInput: () => undefined,
}));

vi.mock('../../../utils/logger.js', () => ({
  createLogger: () => ({
    debug: mocks.debug,
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('../session-runner.js', () => ({
  evictEmbeddedSessionRunner: vi.fn(),
  acquireEmbeddedSessionRunner: vi.fn().mockImplementation(async () => {
    const session = {
      prompt: mocks.prompt,
      sendCustomMessage: mocks.customMessage,
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
        appendCustomEntry: vi.fn(),
      },
      reused: false,
      release: vi.fn(),
    };
  }),
}));

vi.mock('../transcript-runtime.js', () => ({
  createSqliteTranscriptRuntime: vi.fn().mockResolvedValue({
    runtimeId: "259a62b5-df35-4b40-88ae-275ddf5f1ba0",
    transcriptId: 'session-1',
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
    mocks.connectionSuspended.mockReturnValue(false);
    mocks.connectionResume.mockReturnValue(undefined);
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

  it('resumes with hidden model context without appending a user prompt', async () => {
    mocks.connectionResume.mockReturnValue({ content: 'Resume the original Gmail request.' });
    const result = await runXopcEmbeddedTurn({
      conversationId: "259a62b5-df35-4b40-88ae-275ddf5f1ba0", runId: 'run-resume',
      userMessage: { role: 'user', content: 'Resume the original Gmail request.', timestamp: 1 } as AgentMessage,
      model: { id: 'gpt-4o', provider: 'openai' } as any,
      modelRef: 'openai/gpt-4o', tools: [], systemPrompt: 'system',
      workspaceDir: '/tmp/workspace', sessionStore: {} as any, timeoutMs: 60_000,
    });
    expect(result.ok).toBe(true);
    expect(mocks.prompt).not.toHaveBeenCalled();
    expect(mocks.customMessage).toHaveBeenCalledWith({
      customType: 'connection_resume', content: 'Resume the original Gmail request.', display: false,
    }, { triggerTurn: true });
  });

  it('passes hydrated params.images to session.prompt (not inline content blocks)', async () => {
    const userMessage = {
      role: 'user',
      content: 'What is in this image?',
      timestamp: 1,
    } as AgentMessage;

    await runXopcEmbeddedTurn({
      conversationId: "259a62b5-df35-4b40-88ae-275ddf5f1ba0",
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
      conversationId: "259a62b5-df35-4b40-88ae-275ddf5f1ba0",
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
    const context = {
      toolCall: { id: 'check', name: 'exec_command' }, args: { cmd: 'pnpm test' },
      isError: false, result: { content: [], details: { command: 'pnpm test', exitCode: 1 } },
    };
    await mocks.session.agent.beforeToolCall(context);
    const normalized = await mocks.session.agent.afterToolCall(context);
    expect(turnPolicy.beforeToolCall).toHaveBeenCalledWith(context, undefined);
    expect(normalized.isError).toBe(true);
    expect(turnPolicy.afterToolCall).toHaveBeenCalledWith(expect.objectContaining({ isError: true }));
    turnPolicy.shouldStopAfterTurn.mockReturnValueOnce(true);
    expect(mocks.session.agent.shouldStopAfterTurn({})).toBe(true);
    expect(mocks.session.agent.shouldStopAfterTurn({})).toBe(true);
  });

  it('reports external cancellation as a failed run outcome', async () => {
    const controller = new AbortController();
    mocks.waitForIdle.mockImplementationOnce(async () => {
      controller.abort();
    });

    const result = await runXopcEmbeddedTurn({
      conversationId: "259a62b5-df35-4b40-88ae-275ddf5f1ba0",
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
      conversationId: "259a62b5-df35-4b40-88ae-275ddf5f1ba0",
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

  it.each([
    'maximum context length exceeded',
    'Codex error: Your input exceeds the context window of this model. Please adjust your input and try again.',
  ])('compacts and resumes with the run-lease signal after overflow: %s', async (errorMessage) => {
    mocks.assistantError.mockReturnValueOnce(errorMessage);
    const compactedMessages: AgentMessage[] = [
      { role: 'user', content: 'Preserved pending request', timestamp: 1 },
    ];
    mocks.loadMessages.mockResolvedValue(compactedMessages);

    const result = await runXopcEmbeddedTurn({
      conversationId: "259a62b5-df35-4b40-88ae-275ddf5f1ba0",
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
      compactedMessages,
      { id: 'gpt-4o', provider: 'openai' },
      expect.any(String),
      true,
      { signal: mocks.leaseController?.signal, fallbackModels: [] },
    );
    expect(mocks.compact).toHaveBeenCalledOnce();
    expect(mocks.loadMessages).toHaveBeenCalledTimes(3);
    expect(mocks.session.agent.state.messages).toEqual(compactedMessages);
    expect(mocks.session.agent.continue).toHaveBeenCalledOnce();
    expect(mocks.waitForIdle).toHaveBeenCalledTimes(2);
    expect(result.ok).toBe(true);
  });

  it('recovers a provider overflow with no normal range without resubmitting the prompt', async () => {
    mocks.assistantError.mockReturnValueOnce('413 Request body is too large');
    mocks.loadMessages.mockResolvedValue([{ role: 'user', content: 'Pending review', timestamp: 1 }]);
    mocks.compact.mockResolvedValueOnce({ compacted: false });
    const result = await runXopcEmbeddedTurn({
      conversationId: '259a62b5-df35-4b40-88ae-275ddf5f1ba0', runId: 'run-full-recovery',
      userMessage: { role: 'user', content: 'Pending review', timestamp: 1 },
      model: { id: 'test', provider: 'test', contextWindow: 128_000 } as any,
      modelRef: 'test/test', tools: [], systemPrompt: 'system',
      workspaceDir: '/tmp/workspace', sessionStore: {} as any, timeoutMs: 60_000,
    });
    expect(result.ok).toBe(true);
    expect(mocks.compact).toHaveBeenCalledTimes(2);
    expect(mocks.compact.mock.calls[1]?.[4]).toMatchObject({ summarizeAll: true, preserveLastUser: true });
    expect(mocks.prompt).toHaveBeenCalledOnce();
    expect(mocks.session.agent.continue).toHaveBeenCalledOnce();
  });

  it('checks the actual model budget before calling the provider stream', async () => {
    await runXopcEmbeddedTurn({
      conversationId: "259a62b5-df35-4b40-88ae-275ddf5f1ba0", runId: 'run-budget',
      userMessage: { role: 'user', content: 'hello', timestamp: 1 },
      model: { id: 'test', provider: 'test', contextWindow: 128_000 } as any,
      modelRef: 'test/test', tools: [], systemPrompt: 'system',
      workspaceDir: '/tmp/workspace', sessionStore: {} as any, timeoutMs: 60_000,
    });
    mocks.baseStreamFn.mockClear();
    expect(() => mocks.session.agent.streamFunction(
      { id: 'smaller-fallback', provider: 'test', contextWindow: 8_000 },
      { systemPrompt: 'system', messages: [{ role: 'user', content: 'x'.repeat(100_000) }], tools: [] },
      {},
    )).toThrow('Context budget exceeded before provider request');
    expect(mocks.baseStreamFn).not.toHaveBeenCalled();
  });

  it('marks run ownership conflicts as non-retryable harness failures', async () => {
    mocks.acquireRunLease.mockImplementationOnce(() => {
      throw new EmbeddedRunConflictError("259a62b5-df35-4b40-88ae-275ddf5f1ba0", 'run-active');
    });

    const result = await runXopcEmbeddedTurn({
      conversationId: "259a62b5-df35-4b40-88ae-275ddf5f1ba0",
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
      errorMessage: expect.stringContaining("already has active embedded run 'run-active'"),
    });
  });

  it('ignores legacy inline image blocks on userMessage.content', async () => {
    const userMessage = {
      role: 'user',
      content: [{ type: 'image', data: 'ZnJvbS11c2Vy', mimeType: 'image/jpeg' }],
      timestamp: 1,
    } as AgentMessage;

    await runXopcEmbeddedTurn({
      conversationId: "259a62b5-df35-4b40-88ae-275ddf5f1ba0",
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
      conversationId: "259a62b5-df35-4b40-88ae-275ddf5f1ba0",
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
  it('suspends after a durable connection request without aborting or retrying the model', async () => {
    mocks.prompt.mockImplementationOnce(async () => {
      mocks.connectionSuspended.mockReturnValue(true);
      await mocks.session.agent.afterToolCall({ toolCall: { id: 'connect', name: 'xopc_require_connection' }, args: {},
        isError: false, result: { content: [{ type: 'text', text: 'connection_required' }], details: {} } });
      expect(mocks.session.agent.shouldStopAfterTurn({})).toBe(true);
    });
    const result = await runXopcEmbeddedTurn({
      conversationId: "259a62b5-df35-4b40-88ae-275ddf5f1ba0", runId: 'connection-run',
      userMessage: { role: 'user', content: 'Summarize Gmail', timestamp: 1 } as AgentMessage,
      model: { id: 'gpt-4o', provider: 'openai' } as any, modelRef: 'openai/gpt-4o', tools: [], systemPrompt: 'system',
      workspaceDir: '/tmp/workspace', sessionStore: {} as any, timeoutMs: 60_000,
    });
    expect(result).toMatchObject({ ok: true, stopReason: 'connection_required' });
    expect(mocks.retryTurn).not.toHaveBeenCalled();
    expect(mocks.session.abort).not.toHaveBeenCalled();
  });

});
