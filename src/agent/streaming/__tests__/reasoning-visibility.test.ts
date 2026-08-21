import { describe, expect, it } from 'vitest';

import { applyReasoningVisibility } from '../reasoning-visibility.js';

describe('applyReasoningVisibility', () => {
  it('passes through when reasoning is not off', () => {
    const event = { type: 'thinking', content: 'x', delta: true };
    expect(applyReasoningVisibility(event, 'stream')).toBe(event);
    expect(applyReasoningVisibility(event, 'on')).toBe(event);
  });

  it('drops thinking and thinking-stage progress when off', () => {
    expect(applyReasoningVisibility({ type: 'thinking', content: 'a' }, 'off')).toBeNull();
    expect(applyReasoningVisibility({ type: 'thinking', status: 'started' }, 'off')).toBeNull();
    expect(
      applyReasoningVisibility(
        { type: 'progress', stage: 'thinking', message: 'Thinking...' },
        'off',
      ),
    ).toBeNull();
  });

  it('keeps tokens, tools, idle progress, and control events when off', () => {
    const token = { type: 'token', content: 'hi' };
    expect(applyReasoningVisibility(token, 'off')).toBe(token);
    expect(
      applyReasoningVisibility({ type: 'progress', stage: 'idle', message: 'Done' }, 'off'),
    ).toEqual({ type: 'progress', stage: 'idle', message: 'Done' });
    expect(applyReasoningVisibility({ type: '__done__' }, 'off')).toEqual({ type: '__done__' });
  });
});
