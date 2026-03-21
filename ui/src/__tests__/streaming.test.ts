import { describe, it, expect } from 'vitest';
import {
  appendTextDelta,
  appendToolStart,
  cloneMessageForRender,
  completeTool,
} from '../messages/streaming.js';
import type { MessageContent } from '../messages/types.js';

describe('messages/streaming', () => {
  it('appendTextDelta merges into last text block', () => {
    const c: MessageContent[] = [{ type: 'text', text: 'a' }];
    appendTextDelta(c, 'b');
    expect(c).toEqual([{ type: 'text', text: 'ab' }]);
  });

  it('appendToolStart and completeTool update running tool', () => {
    const c: MessageContent[] = [];
    appendToolStart(c, 'bash', { cmd: 'ls' });
    expect(c).toHaveLength(1);
    expect(c[0].type).toBe('tool_use');
    if (c[0].type !== 'tool_use') throw new Error('expected tool_use');
    expect(c[0].status).toBe('running');

    completeTool(c, 'bash', false, 'ok');
    if (c[0].type !== 'tool_use') throw new Error('expected tool_use');
    expect(c[0].status).toBe('done');
    expect(c[0].result).toBe('ok');
  });

  it('cloneMessageForRender yields new content references for Lit updates', () => {
    const msg = {
      role: 'assistant' as const,
      content: [{ type: 'text' as const, text: 'hi' }],
      timestamp: 1,
    };
    const clone = cloneMessageForRender(msg);
    expect(clone).not.toBe(msg);
    expect(clone.content).not.toBe(msg.content);
    expect(clone.content[0]).not.toBe(msg.content[0]);
    expect(clone.content[0].text).toBe('hi');
  });
});
