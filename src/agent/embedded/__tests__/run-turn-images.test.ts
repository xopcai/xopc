import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentMessage } from '@earendil-works/pi-agent-core';

const mocks = vi.hoisted(() => ({
  prompt: vi.fn(),
  waitForIdle: vi.fn(),
  baseStreamFn: vi.fn(),
  debug: vi.fn(),
  session: undefined as any,
}));

vi.mock('../../../utils/logger.js', () => ({
  createLogger: () => ({
    debug: mocks.debug,
    error: vi.fn(),
  }),
}));

vi.mock('../session-runner.js', () => ({
  acquireEmbeddedSessionRunner: vi.fn().mockImplementation(async () => {
    const session = {
      prompt: mocks.prompt,
      agent: {
        streamFn: mocks.baseStreamFn,
        waitForIdle: mocks.waitForIdle,
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
  resolveEmbeddedTranscriptInputs: vi.fn().mockResolvedValue({
    sessionId: 'session-1',
    sessionKey: 'agent:main:test',
  }),
}));

vi.mock('../runs.js', () => ({
  registerEmbeddedRun: vi.fn(),
  unregisterEmbeddedRun: vi.fn(),
  abortEmbeddedRun: vi.fn(),
  queueEmbeddedSteer: vi.fn(),
}));

vi.mock('../subscribe-session.js', () => ({
  subscribeEmbeddedSessionEvents: vi.fn().mockReturnValue(() => {}),
  lastAssistantPlainText: vi.fn().mockReturnValue('done'),
}));

vi.mock('../../orchestration/run-agent-turn-with-timeout.js', () => ({
  runAgentTurnWithTimeout: vi.fn().mockImplementation(async (_agent, fn) => fn()),
  resolveAgentTurnTimeoutMs: vi.fn().mockReturnValue(60_000),
}));

vi.mock('../../orchestration/llm-turn-retry.js', () => ({
  isAssistantTurnAborted: vi.fn().mockReturnValue(false),
  isAssistantTurnFailed: vi.fn().mockReturnValue(false),
  maybeRetryTurnAfterTransientLlmFailure: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../orchestration/loop-guard.js', () => ({
  detectToolLoops: vi.fn().mockReturnValue({ hiddenTools: new Set(), injection: null }),
}));

vi.mock('../xopc-stream-bridge.js', () => ({
  wrapStreamFnForXopcExtensions: vi.fn((streamFn) => streamFn),
}));

import { runXopcEmbeddedTurn } from '../run-turn.js';

describe('runXopcEmbeddedTurn image input', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.waitForIdle.mockResolvedValue(undefined);
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

    mocks.session.agent.streamFn(
      { id: 'gpt-4o', provider: 'openai' },
      effectiveContext,
      {},
    );
    expect(mocks.debug).toHaveBeenLastCalledWith(
      expect.not.objectContaining({ effectiveContext: expect.anything() }),
      'Sending messages to AI',
    );

    process.env.XOPC_LOG_LLM_PAYLOAD = 'true';
    mocks.session.agent.streamFn(
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
