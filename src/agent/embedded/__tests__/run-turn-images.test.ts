import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentMessage } from '@earendil-works/pi-agent-core';
import { bindComputerAgentTurn, computerAgentTurn, retainComputerFrame, computerImagesForRequest } from '../../../computer/agent-context.js';

const mocks = vi.hoisted(() => ({
  phoneSuspended: vi.fn(),
  appendMessage: vi.fn(),
  connectionSuspended: vi.fn(),
  connectionResume: vi.fn(),
  mcpResume: vi.fn(),
  customMessage: vi.fn(),
  prompt: vi.fn(),
  waitForIdle: vi.fn(),
  baseStreamFn: vi.fn(),
  basePrepareRequest: vi.fn(),
  retryTurn: vi.fn(),
  assistantError: vi.fn(),
  compact: vi.fn(),
  loadMessages: vi.fn(),
  acquireRunLease: vi.fn(),
  debug: vi.fn(),
  lastText: 'done',
  session: undefined as any,
  leaseController: undefined as AbortController | undefined,
}));

vi.mock('../../mcp/continuation-input.js', () => ({ getMcpSetupResumeInput: mocks.mcpResume }));
vi.mock('../../../phone/assistance.js', () => ({ isPhoneAssistanceSuspended: (...args: unknown[]) => mocks.phoneSuspended(...args), phoneAssistance: () => ({ id: 'phone-wait' }), phoneResumeForRun: () => undefined }));

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
      getAllTools: () => [],
      prompt: mocks.prompt,
      sendCustomMessage: mocks.customMessage,
      agent: {
        streamFunction: mocks.baseStreamFn,
        prepareRequest: mocks.basePrepareRequest,
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
        appendMessage: mocks.appendMessage,
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
  lastAssistantPlainText: vi.fn(() => mocks.lastText),
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
  it('projects computer pixels only into the provider request, leaving transcript and debug payload text-only', async () => {
    const owner = '259a62b5-df35-4b40-88ae-275ddf5f1ba0';
    const model = { id: 'visual-main', provider: 'test', api: 'openai-completions',
      baseUrl: 'https://model.test/v1', input: ['text', 'image'], contextWindow: 128_000 } as any;
    const messages: any[] = [
      { role: 'user', content: 'Inspect the test window', timestamp: 1 },
      { role: 'assistant', content: [{ type: 'toolCall', id: 'call_screen-1', name: 'computer_use', arguments: { op: 'exec', code: 'await ui.observe({visual:true})' } }],
        model: model.id, provider: model.provider, api: model.api, timestamp: 2 },
      { role: 'toolResult', toolCallId: 'call_screen-1', toolName: 'computer_use', content: [{ type: 'text', text: 'Ephemeral screenshot ready' }], timestamp: 3 },
    ];
    const before = JSON.stringify(messages);
    process.env.XOPC_LOG_LLM_PAYLOAD = 'true';
    mocks.prompt.mockImplementationOnce(async () => {
      bindComputerAgentTurn(owner, 'run-computer-image', model);
      retainComputerFrame(owner, 'call_screen-1', new Uint8Array([1, 2, 3]), 'image/png');
      const stream = mocks.session.agent.streamFunction(model, { systemPrompt: 'system', messages,
        tools: [{ name: 'computer_use', description: 'UI', parameters: { type: 'object' } }] }, {});
      await stream.result();
    });
    const result = await runXopcEmbeddedTurn({ conversationId: owner, runId: 'run-computer-image',
      userMessage: { role: 'user', content: 'Inspect the test window', timestamp: 1 }, model, modelRef: 'test/visual-main',
      tools: [], systemPrompt: 'system', workspaceDir: '/tmp/workspace', sessionStore: {} as any, timeoutMs: 60_000 });
    expect(result.ok).toBe(true);
    const outgoing = mocks.baseStreamFn.mock.calls[0]?.[1].messages.find((m: any) => m.role === 'toolResult');
    expect(outgoing.toolCallId).not.toBe('call_screen-1');
    expect(outgoing.content).toContainEqual({ type: 'image', mimeType: 'image/png', data: 'AQID' });
    expect(JSON.stringify(messages)).toBe(before);
    expect(JSON.stringify(mocks.debug.mock.calls)).not.toContain('AQID');
    expect(computerImagesForRequest(owner, 'run-computer-image', 'call_screen-1')).toEqual([]);
  });
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.phoneSuspended.mockReturnValue(false);
    mocks.connectionSuspended.mockReturnValue(false);
    mocks.connectionResume.mockReturnValue(undefined);
    mocks.mcpResume.mockReturnValue(undefined);
    mocks.leaseController = new AbortController();
    mocks.acquireRunLease.mockReturnValue({
      signal: mocks.leaseController.signal,
      attach: vi.fn(),
      release: vi.fn(),
    });
    mocks.baseStreamFn.mockReturnValue({ result: async () => ({ role: 'assistant', content: [], stopReason: 'stop' }) });
    mocks.waitForIdle.mockResolvedValue(undefined);
    mocks.retryTurn.mockResolvedValue(undefined);
    mocks.basePrepareRequest.mockResolvedValue(undefined);
    mocks.assistantError.mockReturnValue(undefined);
    mocks.compact.mockResolvedValue({
      compacted: true,
      tokensBefore: 100,
      tokensAfter: 50,
      summary: 'Compacted context.',
    });
    mocks.loadMessages.mockResolvedValue([]);
    mocks.lastText = 'done';
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

  it('passes MCP setup continuation instructions to the model as hidden context', async () => {
    mocks.mcpResume.mockReturnValue({ content: 'MCP configuration is saved. Continue the original task.' });
    const result = await runXopcEmbeddedTurn({
      conversationId: '259a62b5-df35-4b40-88ae-275ddf5f1ba0', runId: 'run-mcp-resume',
      userMessage: { role: 'user', content: 'MCP configuration is saved. Continue the original task.', timestamp: 1 } as AgentMessage,
      model: { id: 'gpt-4o', provider: 'openai' } as any,
      modelRef: 'openai/gpt-4o', tools: [], systemPrompt: 'system',
      workspaceDir: '/tmp/workspace', sessionStore: {} as any, timeoutMs: 60_000,
    });
    expect(result.ok).toBe(true);
    expect(mocks.prompt).not.toHaveBeenCalled();
    expect(mocks.customMessage).toHaveBeenCalledWith({
      customType: 'connection_resume', content: 'MCP configuration is saved. Continue the original task.', display: false,
    }, { triggerTurn: true });
  });

  it('retries a silent response to a direct user message once within the same turn', async () => {
    mocks.waitForIdle.mockImplementationOnce(async () => { mocks.lastText = 'NO_REPLY'; })
      .mockImplementationOnce(async () => { mocks.lastText = '我在，想让我做什么？'; });

    const result = await runXopcEmbeddedTurn({
      conversationId: "259a62b5-df35-4b40-88ae-275ddf5f1ba0", runId: 'run-visible-reply',
      userMessage: { role: 'user', content: '你好', timestamp: 1 } as AgentMessage,
      model: { id: 'gpt-4o', provider: 'openai' } as any,
      modelRef: 'openai/gpt-4o', tools: [], systemPrompt: 'system',
      workspaceDir: '/tmp/workspace', sessionStore: {} as any, timeoutMs: 60_000,
      requireVisibleReply: true,
    });

    expect(result).toMatchObject({ ok: true, lastAssistantText: '我在，想让我做什么？' });
    expect(mocks.prompt).toHaveBeenCalledOnce();
    expect(mocks.customMessage).toHaveBeenCalledWith(expect.objectContaining({
      customType: 'visible_reply_required', display: false,
    }), { triggerTurn: true });
  });

  it('reports an error if the bounded retry is still silent', async () => {
    mocks.lastText = 'NO_REPLY';
    const result = await runXopcEmbeddedTurn({
      conversationId: "259a62b5-df35-4b40-88ae-275ddf5f1ba0", runId: 'run-still-silent',
      userMessage: { role: 'user', content: '你好', timestamp: 1 } as AgentMessage,
      model: { id: 'gpt-4o', provider: 'openai' } as any,
      modelRef: 'openai/gpt-4o', tools: [], systemPrompt: 'system',
      workspaceDir: '/tmp/workspace', sessionStore: {} as any, timeoutMs: 60_000,
      requireVisibleReply: true,
    });

    expect(result).toEqual({ ok: false, retryable: false, errorMessage: 'Assistant did not produce a visible reply' });
    expect(mocks.customMessage).toHaveBeenCalledOnce();
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

  it('restores images after the session projection replaces the prompt with persisted text', async () => {
    const persistedUser = { role: 'user', content: 'Describe this image', turnId: 'run-image', timestamp: 1 };
    const projectedContext = { messages: [persistedUser], tools: [] };
    mocks.basePrepareRequest.mockResolvedValue({ context: projectedContext });
    let providerMessages: AgentMessage[] = [];
    mocks.prompt.mockImplementationOnce(async () => {
      const prepared = await mocks.session.agent.prepareRequest({ context: projectedContext }, undefined);
      providerMessages = prepared.context.messages;
    });

    await runXopcEmbeddedTurn({
      conversationId: '259a62b5-df35-4b40-88ae-275ddf5f1ba0',
      runId: 'run-image',
      userMessage: persistedUser as AgentMessage,
      model: { id: 'gpt-4o', provider: 'openai' } as any,
      modelRef: 'openai/gpt-4o', tools: [], systemPrompt: 'system',
      workspaceDir: '/tmp/workspace', sessionStore: {} as any, timeoutMs: 60_000,
      images: [{ type: 'image', data: 'aW1hZ2U=', mimeType: 'image/png' }],
    });

    expect(providerMessages[0]).toMatchObject({ content: [
      { type: 'text', text: 'Describe this image' },
      { type: 'image', data: 'aW1hZ2U=', mimeType: 'image/png' },
    ] });
    expect(persistedUser.content).toBe('Describe this image');
  });

  it('installs and resets the authoritative turn policy on the embedded agent', async () => {
    const turnPolicy = {
      reset: vi.fn(),
      beforeToolCall: vi.fn(),
      afterToolCall: vi.fn(),
      shouldStopAfterTurn: vi.fn(),
    };
    const context = {
      toolCall: { id: 'check', name: 'exec_command' }, args: { cmd: 'pnpm test' },
      isError: false, result: { content: [], details: { command: 'pnpm test', exitCode: 1 } },
    };
    let normalized: any;
    const finishDecisions: unknown[] = [];
    mocks.prompt.mockImplementationOnce(async () => {
      await mocks.session.agent.beforeToolCall(context);
      normalized = await mocks.session.agent.afterToolCall(context);
      turnPolicy.shouldStopAfterTurn.mockReturnValueOnce(true);
      finishDecisions.push(await mocks.session.agent.finishTurn({}));
      finishDecisions.push(await mocks.session.agent.finishTurn({}));
    });

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
    expect(turnPolicy.beforeToolCall).toHaveBeenCalledWith(context, undefined);
    expect(normalized.isError).toBe(true);
    expect(turnPolicy.afterToolCall).toHaveBeenCalledWith(expect.objectContaining({ isError: true }));
    expect(mocks.session.agent.beforeToolCall).toBeUndefined();
    expect(mocks.session.agent.afterToolCall).toBeUndefined();
    expect(finishDecisions).toEqual([{ action: 'end' }, { action: 'end' }]);
  });
  it('rechecks each UI host call with distinct matched before/after policy identities', async () => {
    const owner = '259a62b5-df35-4b40-88ae-275ddf5f1ba0';
    const model = { id: 'visual-main', provider: 'test', input: ['image'], baseUrl: 'https://model.test/v1' } as any;
    const turnPolicy = { reset: vi.fn(), beforeToolCall: vi.fn(), afterToolCall: vi.fn(), shouldStopAfterTurn: vi.fn() };
    mocks.prompt.mockImplementationOnce(async () => {
      bindComputerAgentTurn(owner, 'ui-policy', model);
      await mocks.session.agent.beforeToolCall({ toolCall: { id: 'program', name: 'computer_use' }, args: { op: 'exec', code: '' } });
      const turn = computerAgentTurn(owner);
      for (let i = 0; i < 2; i++) {
        await turn.authorize!('observe', {});
        expect(await turn.complete!('observe', { snapshotId: String(i) })).toEqual({ snapshotId: String(i) });
      }
    });
    const result = await runXopcEmbeddedTurn({ conversationId: owner, runId: 'ui-policy',
      userMessage: { role: 'user', content: 'Inspect the fixture', timestamp: 1 }, model, modelRef: 'test/visual-main',
      tools: [], systemPrompt: 'system', workspaceDir: '/tmp/workspace', sessionStore: {} as any, timeoutMs: 60_000, turnPolicy });
    expect(result.ok).toBe(true);
    expect(turnPolicy.beforeToolCall.mock.calls.map(([context]) => context.toolCall.id)).toEqual(['program', 'program/ui/1', 'program/ui/2']);
    expect(turnPolicy.afterToolCall.mock.calls.map(([context]) => context.toolCall.id)).toEqual(['program/ui/1', 'program/ui/2']);
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

    expect(result).toEqual({ ok: false, retryable: false, terminationReason: 'parent_cancelled', errorMessage: 'aborted' });
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

    expect(result).toEqual({ ok: false, retryable: false, terminationReason: 'parent_cancelled', errorMessage: 'aborted' });
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
      { signal: expect.any(AbortSignal), fallbackModels: [] },
    );
    expect(mocks.compact).toHaveBeenCalledOnce();
    const recoverySignal = mocks.compact.mock.calls[0]![4].signal as AbortSignal;
    expect(recoverySignal.aborted).toBe(false);
    mocks.leaseController?.abort(new Error('Cancelled'));
    expect(recoverySignal.aborted).toBe(true);
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
    const stream = mocks.session.agent.streamFunction(
      { id: 'smaller-fallback', provider: 'test', contextWindow: 8_000 },
      { systemPrompt: 'system', messages: [{ role: 'user', content: 'x'.repeat(100_000) }], tools: [] },
      {},
    );
    const events = [];
    for await (const event of stream) events.push(event);
    expect(events.at(-1)).toMatchObject({
      type: 'error',
      error: { stopReason: 'error', errorMessage: expect.stringContaining('Context budget exceeded before provider request') },
    });
    expect(mocks.baseStreamFn).not.toHaveBeenCalled();
  });

  it('allows an image larger than the transcript byte limit through provider preflight', async () => {
    await runXopcEmbeddedTurn({
      conversationId: '259a62b5-df35-4b40-88ae-275ddf5f1ba0', runId: 'run-large-image',
      userMessage: { role: 'user', content: 'Describe this photo', timestamp: 1 },
      model: { id: 'test', provider: 'test', contextWindow: 128_000 } as any,
      modelRef: 'test/test', tools: [], systemPrompt: 'system',
      workspaceDir: '/tmp/workspace', sessionStore: {} as any, timeoutMs: 60_000,
    });
    mocks.baseStreamFn.mockClear();
    const image = { type: 'image', data: 'a'.repeat(2_250_000), mimeType: 'image/jpeg' };
    mocks.session.agent.streamFunction(
      { id: 'test', provider: 'test', contextWindow: 128_000 },
      { systemPrompt: 'system', messages: [{ role: 'user', content: [
        { type: 'text', text: 'Describe this photo' }, image,
      ] }], tools: [] },
      {},
    );
    expect(mocks.baseStreamFn).toHaveBeenCalledOnce();
    expect(mocks.baseStreamFn.mock.calls[0]?.[1].messages[0].content[1]).toBe(image);
  });

  it('compacts between a tool result and the next provider request', async () => {
    const original = [
      { role: 'user', content: 'x'.repeat(20_000), timestamp: 1 },
      { role: 'assistant', content: [{ type: 'toolCall', id: 'tool-1', name: 'read_file', arguments: {} }],
        stopReason: 'toolUse', timestamp: 2 },
      { role: 'toolResult', toolCallId: 'tool-1', toolName: 'read_file', content: [{ type: 'text', text: 'done' }], timestamp: 3 },
    ] as AgentMessage[];
    const compacted = [{ role: 'user', content: 'compacted handover', timestamp: 4 }] as AgentMessage[];
    mocks.loadMessages.mockResolvedValue(original);
    mocks.compact.mockImplementationOnce(async () => {
      mocks.loadMessages.mockResolvedValue(compacted);
      return { compacted: true, messages: compacted, summary: 'compacted handover',
        firstKeptIndex: 3, tokensBefore: 5_000, tokensAfter: 20 };
    });
    let preparedMessages: AgentMessage[] = [];
    mocks.basePrepareRequest.mockImplementation(async request => ({
      context: { ...request.context, messages: [{ role: 'system', content: 'system', timestamp: 0 }, ...original] },
    }));
    mocks.prompt.mockImplementationOnce(async () => {
      const update = await mocks.session.agent.prepareNextTurnWithContext({
        message: original[1], toolResults: [original[2]], newMessages: original,
        context: { messages: [{ role: 'system', content: 'system', timestamp: 0 }, ...original], tools: [] },
      });
      const request = await mocks.session.agent.prepareRequest({
        context: update.context, model: { id: 'test', provider: 'test' }, thinkingLevel: 'off',
      });
      preparedMessages = request.context.messages;
    });

    await runXopcEmbeddedTurn({
      conversationId: '259a62b5-df35-4b40-88ae-275ddf5f1ba0', runId: 'run-mid-turn-compaction',
      userMessage: { role: 'user', content: 'work', timestamp: 1 },
      model: { id: 'test', provider: 'test', contextWindow: 8_000 } as any,
      modelRef: 'test/test', tools: [], systemPrompt: 'system',
      workspaceDir: '/tmp/workspace', sessionStore: {} as any, timeoutMs: 60_000,
    });

    expect(mocks.compact).toHaveBeenCalledWith(original, expect.objectContaining({ id: 'test' }),
      undefined, true, expect.objectContaining({ fallbackModels: [] }));
    expect(preparedMessages).toEqual([
      expect.objectContaining({ role: 'system' }),
      expect.objectContaining({ role: 'user', content: 'compacted handover' }),
    ]);
  });

  it('discards a truncated tool-call attempt and performs one full-history recovery', async () => {
    const truncated = {
      role: 'assistant', provider: 'test', model: 'test', stopReason: 'length', timestamp: 2,
      content: [{ type: 'toolCall', id: 'tool-1', name: 'read_file', arguments: { path: '/partial' } }],
      usage: { input: 100, output: 10, cacheRead: 0, cacheWrite: 0, totalTokens: 110,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    } as AgentMessage;
    const synthetic = { role: 'toolResult', toolCallId: 'tool-1', toolName: 'read_file',
      content: [{ type: 'text', text: 'Skipped truncated tool call' }], timestamp: 3 } as AgentMessage;
    const original = [{ role: 'user', content: 'finish the task', timestamp: 1 } as AgentMessage, truncated, synthetic];
    const compacted = [{ role: 'user', content: 'finish the task', timestamp: 1 } as AgentMessage];
    mocks.loadMessages.mockResolvedValue(original);
    mocks.compact.mockImplementationOnce(async () => {
      mocks.loadMessages.mockResolvedValue(compacted);
      return { compacted: true, messages: compacted, summary: 'safe handover',
        firstKeptIndex: 3, tokensBefore: 100, tokensAfter: 10 };
    });
    let preparedMessages: AgentMessage[] = [];
    mocks.basePrepareRequest.mockImplementation(async request => ({
      context: { ...request.context, messages: original },
    }));
    mocks.prompt.mockImplementationOnce(async () => {
      const update = await mocks.session.agent.prepareNextTurnWithContext({
        message: truncated, toolResults: [synthetic], newMessages: original,
        context: { messages: original, tools: [] },
      });
      const request = await mocks.session.agent.prepareRequest({
        context: update.context, model: { id: 'test', provider: 'test' }, thinkingLevel: 'off',
      });
      preparedMessages = request.context.messages;
    });

    await runXopcEmbeddedTurn({
      conversationId: '259a62b5-df35-4b40-88ae-275ddf5f1ba0', runId: 'run-length-recovery',
      userMessage: original[0],
      model: { id: 'test', provider: 'test', contextWindow: 8_000, maxTokens: 100 } as any,
      modelRef: 'test/test', tools: [], systemPrompt: 'system',
      workspaceDir: '/tmp/workspace', sessionStore: {} as any, timeoutMs: 60_000,
    });

    expect(mocks.compact).toHaveBeenCalledOnce();
    expect(mocks.compact.mock.calls[0]?.[4]).toMatchObject({
      summarizeAll: true,
      preserveLastUser: true,
      discardedAttempt: { assistantTimestamp: 2, provider: 'test', model: 'test', toolCallIds: ['tool-1'] },
    });
    expect(preparedMessages).toEqual(compacted);
    expect(mocks.session.agent.continue).not.toHaveBeenCalled();
  });

  it('recovers a thinking-only truncated response after the loop settles', async () => {
    const truncated = {
      role: 'assistant', provider: 'test', model: 'test', stopReason: 'length', timestamp: 2,
      content: [{ type: 'thinking', thinking: 'unfinished reasoning' }],
      usage: { input: 100, output: 10, cacheRead: 0, cacheWrite: 0, totalTokens: 110,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    } as AgentMessage;
    const original = [{ role: 'user', content: 'finish the task', timestamp: 1 } as AgentMessage, truncated];
    const compacted = [{ role: 'user', content: 'finish the task', timestamp: 1 } as AgentMessage];
    mocks.loadMessages.mockResolvedValue(original);
    mocks.compact.mockImplementationOnce(async () => {
      mocks.loadMessages.mockResolvedValue(compacted);
      return { compacted: true, messages: compacted, summary: 'safe handover',
        firstKeptIndex: 2, tokensBefore: 100, tokensAfter: 10 };
    });

    const result = await runXopcEmbeddedTurn({
      conversationId: '259a62b5-df35-4b40-88ae-275ddf5f1ba0', runId: 'run-thinking-length',
      userMessage: original[0],
      model: { id: 'test', provider: 'test', contextWindow: 8_000, maxTokens: 100 } as any,
      modelRef: 'test/test', tools: [], systemPrompt: 'system',
      workspaceDir: '/tmp/workspace', sessionStore: {} as any, timeoutMs: 60_000,
    });

    expect(result.ok).toBe(true);
    expect(mocks.compact.mock.calls[0]?.[4]).toMatchObject({
      summarizeAll: true,
      discardedAttempt: { assistantTimestamp: 2, provider: 'test', model: 'test', toolCallIds: [] },
    });
    expect(mocks.session.agent.continue).toHaveBeenCalledOnce();
    expect(mocks.waitForIdle).toHaveBeenCalledTimes(2);
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

    const legacyContext = {
      systemPrompt: 'complete system prompt',
      messages: [{ role: 'user', content: 'complete user message', timestamp: 1 }],
      tools: [{ name: 'example_tool', description: 'Example tool' }],
    };
    const effectiveContext = (await import('@earendil-works/pi-ai')).normalizeContext(legacyContext as any);

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
      expect.objectContaining({ effectiveContext: legacyContext }),
      'Sending messages to AI',
    );
  });
  it('suspends after a durable connection request without aborting or retrying the model', async () => {
    mocks.prompt.mockImplementationOnce(async () => {
      mocks.connectionSuspended.mockReturnValue(true);
      await mocks.session.agent.afterToolCall({ toolCall: { id: 'connect', name: 'xopc_require_connection' }, args: {},
        isError: false, result: { content: [{ type: 'text', text: 'connection_required' }], details: {} } });
      await expect(mocks.session.agent.finishTurn({})).resolves.toEqual({ action: 'end' });
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

  it('ends a phone assistance turn normally, saves a visible notice and blocks subsequent tools', async () => {
    mocks.prompt.mockImplementationOnce(async () => {
      mocks.phoneSuspended.mockReturnValue(true);
      await mocks.session.agent.afterToolCall({ toolCall: { id: 'phone', name: 'phone_use' }, args: {},
        isError: false, result: { content: [{ type: 'text', text: 'needs_user' }], details: {} } });
      await expect(mocks.session.agent.beforeToolCall({ toolCall: { name: 'shell' }, args: {} })).resolves.toMatchObject({ block: true, terminate: true });
      await expect(mocks.session.agent.finishTurn({})).resolves.toEqual({ action: 'end' });
    });
    const events: unknown[] = [];
    const result = await runXopcEmbeddedTurn({
      conversationId: '259a62b5-df35-4b40-88ae-275ddf5f1ba0', runId: 'phone-run',
      userMessage: { role: 'user', content: 'Read orders on the phone', timestamp: 1 } as AgentMessage,
      model: { id: 'gpt-4o', provider: 'openai', api: 'openai-completions' } as any, modelRef: 'openai/gpt-4o', tools: [], systemPrompt: 'system',
      workspaceDir: '/tmp/workspace', sessionStore: {} as any, timeoutMs: 60_000, onEvent: event => events.push(event),
    });
    expect(result).toMatchObject({ ok: true, stopReason: 'phone_assistance_required' });
    expect(mocks.appendMessage).toHaveBeenCalledWith(expect.objectContaining({ role: 'assistant', stopReason: 'stop' }));
    expect(events).toContainEqual(expect.objectContaining({ type: 'message_end' }));
    expect(mocks.retryTurn).not.toHaveBeenCalled(); expect(mocks.session.abort).not.toHaveBeenCalled();
  });

});
