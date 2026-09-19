import { describe, expect, it } from 'vitest';

import { countPendingChatInputs } from '../tui-backend.js';
import { acceptChatInputState, commitDeliveredChatInput } from '../tui-chat-input-state.js';

describe('countPendingChatInputs', () => {
  it('includes queued and not-yet-committed steer inputs', () => {
    expect(countPendingChatInputs([
      { id: 'queued', content: 'q', requestedDelivery: 'next', effectiveDelivery: 'next', status: 'queued', version: 1 },
      { id: 'running', content: 'r', requestedDelivery: 'next', effectiveDelivery: 'next', status: 'running', version: 1 },
      { id: 'injecting', content: 's', requestedDelivery: 'steer', effectiveDelivery: 'steer', status: 'injecting', version: 1 },
      { id: 'interrupted', content: 'i', requestedDelivery: 'next', effectiveDelivery: 'next', status: 'interrupted', version: 1 },
    ])).toBe(3);
  });
});

describe('acceptChatInputState', () => {
  it('does not replace a newer state with a stale reconnect snapshot', () => {
    const current = { conversationId: 'c1', revision: 4, inputs: [] };
    const stale = { conversationId: 'c1', revision: 3, inputs: [] };
    expect(acceptChatInputState(current, stale)).toBe(current);
  });
});

describe('commitDeliveredChatInput', () => {
  it('removes exactly the matching delivered input and advances the revision', () => {
    const state = {
      conversationId: 'c1',
      revision: 4,
      inputs: [
        { id: 's1', content: 'first', requestedDelivery: 'steer' as const, effectiveDelivery: 'steer' as const, status: 'injecting' as const, version: 1 },
        { id: 's2', content: 'second', requestedDelivery: 'steer' as const, effectiveDelivery: 'steer' as const, status: 'injecting' as const, version: 1 },
      ],
    };

    expect(commitDeliveredChatInput(state, 'second')).toEqual({
      ...state,
      revision: 5,
      inputs: [state.inputs[0]],
    });
    expect(commitDeliveredChatInput(state, 'unrelated')).toBe(state);
  });

  it('consumes duplicate text one revision at a time', () => {
    const state = {
      conversationId: 'c1',
      revision: 1,
      inputs: [
        { id: 's1', content: 'same', requestedDelivery: 'steer' as const, effectiveDelivery: 'steer' as const, status: 'injecting' as const, version: 1 },
        { id: 's2', content: 'same', requestedDelivery: 'steer' as const, effectiveDelivery: 'steer' as const, status: 'injecting' as const, version: 1 },
      ],
    };

    const next = commitDeliveredChatInput(state, 'same');
    expect(next.revision).toBe(2);
    expect(next.inputs.map((input) => input.id)).toEqual(['s2']);
  });
});
