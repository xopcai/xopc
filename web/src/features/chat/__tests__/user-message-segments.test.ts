import { describe, it, expect } from 'vitest';
import { parseSkillWireSegments } from '@/features/chat/user-message-segments';

describe('parseSkillWireSegments', () => {
  it('splits skill tokens and surrounding text', () => {
    expect(parseSkillWireSegments('hello /skill:foo bar')).toEqual([
      { kind: 'text', text: 'hello ' },
      { kind: 'skill', name: 'foo' },
      { kind: 'text', text: ' bar' },
    ]);
  });

  it('returns single text block when no skill token', () => {
    expect(parseSkillWireSegments('plain only')).toEqual([{ kind: 'text', text: 'plain only' }]);
  });

  it('handles leading skill', () => {
    expect(parseSkillWireSegments('/skill:babysit rest')).toEqual([
      { kind: 'skill', name: 'babysit' },
      { kind: 'text', text: ' rest' },
    ]);
  });

  it('does not merge CJK typed after the skill id into the skill name', () => {
    expect(parseSkillWireSegments('/skill:docx阿迪')).toEqual([
      { kind: 'skill', name: 'docx' },
      { kind: 'text', text: '阿迪' },
    ]);
  });
});
