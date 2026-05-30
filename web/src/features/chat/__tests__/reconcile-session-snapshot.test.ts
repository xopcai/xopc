import { describe, expect, it } from 'vitest';

import {
  assistantTurnVisuallyEquivalent,
  reconcileSessionSnapshot,
} from '@/features/chat/messages/agent-messages';
import type { Message } from '@/features/chat/messages/messages.types';

describe('reconcileSessionSnapshot', () => {
  const user: Message = {
    role: 'user',
    content: [{ type: 'text', text: 'Hi' }],
    timestamp: 1000,
  };

  const localAssistant: Message = {
    role: 'assistant',
    content: [{ type: 'text', text: 'Hello there' }],
    timestamp: 2001,
  };

  const serverAssistant: Message = {
    role: 'assistant',
    content: [{ type: 'text', text: 'Hello there' }],
    timestamp: 1999,
    usage: { outputTokens: 12 },
  };

  it('returns prev when the last assistant turn is visually equivalent and metadata matches', () => {
    const prev = [user, localAssistant];
    const loaded = [user, { ...localAssistant, timestamp: 1999 }];
    expect(reconcileSessionSnapshot(prev, loaded)).toBe(prev);
  });

  it('keeps local timestamps when only server usage differs', () => {
    const prev = [user, localAssistant];
    const loaded = [user, serverAssistant];
    const out = reconcileSessionSnapshot(prev, loaded);
    expect(out).not.toBe(loaded);
    expect(out[1]?.timestamp).toBe(localAssistant.timestamp);
    expect(out[1]?.usage).toEqual({ outputTokens: 12 });
  });

  it('patches usage on the last assistant without replacing the array', () => {
    const prev = [user, localAssistant];
    const loaded = [user, { ...serverAssistant, usage: { outputTokens: 99 } }];
    const out = reconcileSessionSnapshot(prev, loaded);
    expect(out).not.toBe(prev);
    expect(out[1]).toEqual({ ...localAssistant, usage: { outputTokens: 99 } });
    expect(out[0]).toBe(prev[0]);
  });

  it('returns loaded when assistant text differs', () => {
    const prev = [user, localAssistant];
    const loaded: Message[] = [
      user,
      { ...serverAssistant, content: [{ type: 'text', text: 'Different' }] },
    ];
    expect(reconcileSessionSnapshot(prev, loaded)).toBe(loaded);
  });

  it('returns loaded when prev is empty', () => {
    const loaded = [user, serverAssistant];
    expect(reconcileSessionSnapshot([], loaded)).toBe(loaded);
  });
});

describe('assistantTurnVisuallyEquivalent', () => {
  it('ignores timestamp and compares text/tools/thinking', () => {
    const a: Message = {
      role: 'assistant',
      timestamp: 1,
      content: [
        { type: 'thinking', text: 'plan', streaming: true },
        { type: 'text', text: 'Answer' },
      ],
    };
    const b: Message = {
      role: 'assistant',
      timestamp: 2,
      content: [
        { type: 'thinking', text: 'plan', streaming: false },
        { type: 'text', text: 'Answer' },
      ],
    };
    expect(assistantTurnVisuallyEquivalent(a, b)).toBe(true);
  });
});
