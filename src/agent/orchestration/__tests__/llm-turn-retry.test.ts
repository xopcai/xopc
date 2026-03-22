import { describe, it, expect, vi } from 'vitest';
import type { AgentMessage } from '@mariozechner/pi-agent-core';
import {
  isTransientLlmErrorMessage,
  stripTrailingErrorAssistantMessages,
  maybeRetryTurnAfterTransientLlmFailure,
} from '../llm-turn-retry.js';

describe('llm-turn-retry', () => {
  it('detects transient provider errors', () => {
    expect(isTransientLlmErrorMessage('TypeError: fetch failed')).toBe(true);
    expect(isTransientLlmErrorMessage('ECONNRESET')).toBe(true);
    expect(isTransientLlmErrorMessage('Invalid API key')).toBe(false);
  });

  it('strips trailing error assistant messages', () => {
    const user: AgentMessage = { role: 'user', content: 'hi', timestamp: 1 };
    const errAssistant: AgentMessage = {
      role: 'assistant',
      content: [{ type: 'text', text: '' }],
      stopReason: 'error',
      errorMessage: 'fetch failed',
      timestamp: 2,
    } as AgentMessage;
    const out = stripTrailingErrorAssistantMessages([user, errAssistant]);
    expect(out).toEqual([user]);
  });

  it('retries via continue when last turn is transient error', async () => {
    const user: AgentMessage = { role: 'user', content: 'hi', timestamp: 1 };
    const errAssistant: AgentMessage = {
      role: 'assistant',
      content: [{ type: 'text', text: '' }],
      stopReason: 'error',
      errorMessage: 'fetch failed',
      timestamp: 2,
    } as AgentMessage;

    const continueFn = vi.fn().mockResolvedValue(undefined);
    const waitForIdle = vi.fn().mockResolvedValue(undefined);
    const replaceMessages = vi.fn();

    const agent = {
      state: {
        messages: [user, errAssistant] as AgentMessage[],
      },
      replaceMessages,
      continue: continueFn,
      waitForIdle,
    } as unknown as import('@mariozechner/pi-agent-core').Agent;

    await maybeRetryTurnAfterTransientLlmFailure(agent, {
      sessionKey: 'sk',
      log: { warn: vi.fn() },
      maxContinues: 1,
    });

    expect(replaceMessages).toHaveBeenCalledWith([user]);
    expect(continueFn).toHaveBeenCalledTimes(1);
    expect(waitForIdle).toHaveBeenCalledTimes(1);
  });
});
