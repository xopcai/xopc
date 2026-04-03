import { describe, expect, it } from 'vitest';

import { applyReasoningVisibilityToSseEvent } from '../reasoning-visibility-sse.js';

describe('applyReasoningVisibilityToSseEvent', () => {
  it('passes through when reasoning is not off', () => {
    const e = { type: 'thinking', content: 'x', delta: true };
    expect(applyReasoningVisibilityToSseEvent(e, 'stream')).toBe(e);
    expect(applyReasoningVisibilityToSseEvent(e, 'on')).toBe(e);
  });

  it('drops thinking and thinking-stage progress when off', () => {
    expect(applyReasoningVisibilityToSseEvent({ type: 'thinking', content: 'a' }, 'off')).toBeNull();
    expect(
      applyReasoningVisibilityToSseEvent({ type: 'thinking', status: 'started' }, 'off'),
    ).toBeNull();
    expect(
      applyReasoningVisibilityToSseEvent(
        { type: 'progress', stage: 'thinking', message: 'Thinking...' },
        'off',
      ),
    ).toBeNull();
  });

  it('keeps tokens, tools, idle progress, and control events when off', () => {
    const token = { type: 'token', content: 'hi' };
    expect(applyReasoningVisibilityToSseEvent(token, 'off')).toBe(token);
    expect(
      applyReasoningVisibilityToSseEvent({ type: 'progress', stage: 'idle', message: 'Done' }, 'off'),
    ).toEqual({ type: 'progress', stage: 'idle', message: 'Done' });
    expect(applyReasoningVisibilityToSseEvent({ type: '__done__' }, 'off')).toEqual({ type: '__done__' });
  });
});
