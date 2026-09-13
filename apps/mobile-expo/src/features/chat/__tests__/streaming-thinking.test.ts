import { dispatchAgentStreamEvent, type AgentStreamCallbacks } from '@xopcai/agent-stream-client';
import { describe, expect, it, vi } from 'vitest';

import type { MessageContent } from '../messages.types';
import { appendTextDelta, appendThinkingDelta, finalizeStreamingThinking } from '../streaming';

describe('thinking stream integrity', () => {
  it('appends genuine repeated and overlapping deltas verbatim', () => {
    for (const type of ['thinking', 'text'] as const) {
      const content: MessageContent[] = [];
      for (const delta of ['哈', '哈', ' abc', 'cdef']) {
        if (type === 'thinking') appendThinkingDelta(content, delta, true);
        else appendTextDelta(content, delta, 'm1');
      }
      expect(content).toEqual([expect.objectContaining({ type, text: '哈哈 abccdef' })]);
    }
  });

  it('does not reopen a completed legacy thinking segment', () => {
    const content: MessageContent[] = [];
    appendThinkingDelta(content, 'First', true);
    finalizeStreamingThinking(content);
    appendThinkingDelta(content, 'Second', true);
    expect(content).toEqual([
      { type: 'thinking', text: 'First', streaming: false },
      { type: 'thinking', text: 'Second', streaming: true },
    ]);
  });

  it('keeps message boundaries and ignores another message end through the real dispatcher', () => {
    const content: MessageContent[] = [];
    const callbacks: AgentStreamCallbacks = {
      onStreamStart: vi.fn(),
      onToken: (delta, id) => appendTextDelta(content, delta, id),
      onThinking: (delta, isDelta, id) => appendThinkingDelta(content, delta, isDelta, id),
      onThinkingEnd: id => finalizeStreamingThinking(content, id),
      onToolStart: vi.fn(), onToolEnd: vi.fn(), onProgress: vi.fn(),
      onResult: vi.fn(), onError: vi.fn(),
    };
    const dispatch = (type: string, messageId: string, delta?: string) =>
      dispatchAgentStreamEvent(type, JSON.stringify({ type, payload: { messageId, delta } }), callbacks);
    dispatch('thinking_delta', 'm1', 'First');
    dispatch('thinking_end', 'm1');
    dispatch('assistant_message_start', 'm2');
    dispatch('thinking_delta', 'm2', 'Second');
    dispatch('thinking_end', 'm1');
    expect(content).toEqual([
      { type: 'thinking', text: 'First', streaming: false, segmentId: 'm1' },
      { type: 'thinking', text: 'Second', streaming: true, segmentId: 'm2' },
    ]);
    dispatch('thinking_delta', 'm2', 'Second');
    dispatch('thinking_end', 'm2');
    expect(content[1]).toEqual({ type: 'thinking', text: 'SecondSecond', streaming: false, segmentId: 'm2' });
  });
});
