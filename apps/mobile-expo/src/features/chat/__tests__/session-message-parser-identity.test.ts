import { describe, expect, it } from 'vitest';

import { parseSessionMessages } from '../session-message-parser';

describe('session message parser identity', () => {
  it('keeps legacy tool ids stable across history refreshes', () => {
    const wire = [{
      id: 'assistant-1',
      role: 'assistant',
      rawContent: [
        { type: 'tool_use', name: 'search', input: { query: 'xopc' }, status: 'done' },
        { type: 'tool_use', name: 'search', input: { query: 'mobile' }, status: 'done' },
        { type: 'text', text: 'Done.' },
      ],
    }];

    const first = parseSessionMessages(structuredClone(wire));
    const refreshed = parseSessionMessages(structuredClone(wire));
    const updatedWire = structuredClone(wire);
    updatedWire[0].rawContent[0].status = 'running';
    const updated = parseSessionMessages(updatedWire);
    const firstIds = first[0].content
      .filter((block) => block.type === 'tool_use')
      .map((block) => block.id);
    const refreshedIds = refreshed[0].content
      .filter((block) => block.type === 'tool_use')
      .map((block) => block.id);
    const updatedIds = updated[0].content
      .filter((block) => block.type === 'tool_use')
      .map((block) => block.id);

    expect(refreshedIds).toEqual(firstIds);
    expect(updatedIds).toEqual(firstIds);
    expect(new Set(firstIds).size).toBe(2);
  });
});
