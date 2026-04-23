import { describe, it, expect } from 'vitest';
import { parseMessageSegments, parseSkillWireSegments } from '@/features/chat/user-message-segments';

describe('parseMessageSegments', () => {
  it('parses @file: tokens', () => {
    expect(parseMessageSegments('x @file:src/a.ts y')).toEqual([
      { kind: 'text', text: 'x ' },
      { kind: 'file', path: 'src/a.ts' },
      { kind: 'text', text: ' y' },
    ]);
  });

  it('parses @doc:, @url:, and @symbol:', () => {
    expect(parseMessageSegments('a @doc:notes/x.md b @url:https://ex.com c @symbol:Foo')).toEqual([
      { kind: 'text', text: 'a ' },
      { kind: 'doc', path: 'notes/x.md' },
      { kind: 'text', text: ' b ' },
      { kind: 'url', href: 'https://ex.com' },
      { kind: 'text', text: ' c ' },
      { kind: 'symbol', name: 'Foo' },
    ]);
  });
});

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
