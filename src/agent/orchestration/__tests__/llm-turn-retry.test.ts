import { describe, it, expect, vi } from 'vitest';
import type { AgentMessage } from '@earendil-works/pi-agent-core';
import {
  getAssistantTurnErrorMessage,
  isTransientLlmErrorMessage,
  stripTrailingErrorAssistantMessages,
  maybeRetryTurnAfterTransientLlmFailure,
  isAssistantTurnFailed,
  isAssistantTurnAborted,
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
    let transcript: AgentMessage[] = [user, errAssistant];

    const agent = {
      state: {
        get messages() {
          return transcript;
        },
        set messages(next: AgentMessage[]) {
          replaceMessages(next);
          transcript = next;
        },
      },
      continue: continueFn,
      waitForIdle,
    } as unknown as import('@earendil-works/pi-agent-core').Agent;

    await maybeRetryTurnAfterTransientLlmFailure(agent, {
      sessionKey: 'sk',
      log: { warn: vi.fn() },
      maxContinues: 1,
    });

    expect(replaceMessages).toHaveBeenCalledWith([user]);
    expect(continueFn).toHaveBeenCalledTimes(1);
    expect(waitForIdle).toHaveBeenCalledTimes(1);
  });

  it('isAssistantTurnFailed reflects last assistant stopReason', () => {
    const user: AgentMessage = { role: 'user', content: 'hi', timestamp: 1 };
    const okAssistant: AgentMessage = {
      role: 'assistant',
      content: [{ type: 'text', text: 'ok' }],
      stopReason: 'stop',
      timestamp: 2,
    } as AgentMessage;
    const errAssistant: AgentMessage = {
      role: 'assistant',
      content: [{ type: 'text', text: '' }],
      stopReason: 'error',
      timestamp: 3,
    } as AgentMessage;

    expect(
      isAssistantTurnFailed({
        state: { messages: [user, okAssistant] },
      } as unknown as import('@earendil-works/pi-agent-core').Agent),
    ).toBe(false);
    expect(
      isAssistantTurnFailed({
        state: { messages: [user, errAssistant] },
      } as unknown as import('@earendil-works/pi-agent-core').Agent),
    ).toBe(true);
  });

  it('getAssistantTurnErrorMessage returns errorMessage from failed assistant', () => {
    const user: AgentMessage = { role: 'user', content: 'hi', timestamp: 1 };
    const errAssistant: AgentMessage = {
      role: 'assistant',
      content: [{ type: 'text', text: '' }],
      stopReason: 'error',
      errorMessage: '401 Authentication Fails',
      timestamp: 2,
    } as AgentMessage;

    expect(
      getAssistantTurnErrorMessage({
        state: { messages: [user, errAssistant] },
      } as unknown as import('@earendil-works/pi-agent-core').Agent),
    ).toBe('401 Authentication Fails');
  });

  it('isAssistantTurnAborted detects aborted assistant', () => {
    const user: AgentMessage = { role: 'user', content: 'hi', timestamp: 1 };
    const aborted: AgentMessage = {
      role: 'assistant',
      content: [{ type: 'text', text: '' }],
      stopReason: 'aborted',
      timestamp: 2,
    } as AgentMessage;
    expect(
      isAssistantTurnAborted({
        state: { messages: [user, aborted] },
      } as unknown as import('@earendil-works/pi-agent-core').Agent),
    ).toBe(true);
  });
});
