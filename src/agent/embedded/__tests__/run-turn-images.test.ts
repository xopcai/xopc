import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentMessage } from '@earendil-works/pi-agent-core';

const mocks = vi.hoisted(() => ({
  prompt: vi.fn(),
  waitForIdle: vi.fn(),
}));

vi.mock('../session-runner.js', () => ({
  acquireEmbeddedSessionRunner: vi.fn().mockResolvedValue({
    session: {
      prompt: mocks.prompt,
      agent: {
        streamFn: vi.fn(),
        waitForIdle: mocks.waitForIdle,
      },
      abort: vi.fn(),
    },
    piSm: {
      flushPendingToolResults: vi.fn(),
    },
    reused: false,
    release: vi.fn(),
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
  });

  it('passes image blocks from userMessage.content to session.prompt options', async () => {
    const userMessage = {
      role: 'user',
      content: [
        { type: 'text', text: 'What is in this image?' },
        { type: 'image', data: 'aW1hZ2U=', mimeType: 'image/png' },
      ],
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
    });

    expect(mocks.prompt).toHaveBeenCalledWith('What is in this image?', {
      images: [{ type: 'image', data: 'aW1hZ2U=', mimeType: 'image/png' }],
    });
  });

  it('keeps explicit params.images and appends user message image blocks', async () => {
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
      images: [
        { type: 'image', data: 'ZnJvbS1wYXJhbXM=', mimeType: 'image/png' },
        { type: 'image', data: 'ZnJvbS11c2Vy', mimeType: 'image/jpeg' },
      ],
    });
  });
});
