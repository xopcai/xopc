import { describe, expect, it } from 'vitest';

import {
  contextRefWireToken,
  parseUserTurnDocument,
  renderUserTurnDocument,
  serializeUserTurnDocument,
  userTurnDocumentRefIds,
} from './user-turn-document.js';

describe('user turn document', () => {
  it('preserves context references in sentence order', () => {
    const wire = `Compare ${contextRefWireToken('first')} with ${contextRefWireToken('second')}.`;
    const document = parseUserTurnDocument(wire);

    expect(document).toEqual({
      version: 1,
      parts: [
        { type: 'text', text: 'Compare ' },
        { type: 'context_ref', refId: 'first' },
        { type: 'text', text: ' with ' },
        { type: 'context_ref', refId: 'second' },
        { type: 'text', text: '.' },
      ],
    });
    expect(userTurnDocumentRefIds(document!)).toEqual(['first', 'second']);
    expect(renderUserTurnDocument(document!, id => ({ first: 'src', second: 'tests' })[id])).toBe(
      'Compare @src with @tests.',
    );
    expect(serializeUserTurnDocument(document!)).toBe(wire);
  });

  it('returns null for plain text and rejects invalid ids', () => {
    expect(parseUserTurnDocument('plain text')).toBeNull();
    expect(() => contextRefWireToken('bad id')).toThrow('Invalid context reference id');
  });
});
