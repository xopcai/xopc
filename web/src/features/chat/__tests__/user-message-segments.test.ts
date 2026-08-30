import { describe, it, expect } from 'vitest';
import type { CommandEntry } from '@/features/chat/palette/command-palette.types';
import { refreshSlashCommandWireIndex } from '@/features/chat/palette/slash-command-wire';
import { parseMessageSegments, parseSkillWireSegments } from '@/features/chat/messages/user-message-segments.parse';

const cmdFixtures: CommandEntry[] = [
  {
    id: 'session.clear',
    name: 'clear',
    aliases: [],
    description: '',
    category: 'session',
    acceptsArgs: false,
    acceptsContext: false,
    examples: [],
  },
];

describe('parseMessageSegments', () => {
  it('parses @file: tokens', () => {
    expect(parseMessageSegments('x @file:src/a.ts y')).toEqual([
      { kind: 'text', text: 'x ' },
      { kind: 'file', path: 'src/a.ts' },
      { kind: 'text', text: ' y' },
    ]);
  });

  it('parses @file: with CJK filename as one segment', () => {
    expect(parseMessageSegments('x @file:demo-file/月度预算.xlsx y')).toEqual([
      { kind: 'text', text: 'x ' },
      { kind: 'file', path: 'demo-file/月度预算.xlsx' },
      { kind: 'text', text: ' y' },
    ]);
  });

  it('parses quoted @file: paths with spaces', () => {
    expect(parseMessageSegments('x @file:"Meeting Notes.docx" y')).toEqual([
      { kind: 'text', text: 'x ' },
      { kind: 'file', path: 'Meeting Notes.docx' },
      { kind: 'text', text: ' y' },
    ]);
  });

  it('treats removed wire prefixes as plain text', () => {
    expect(parseMessageSegments('a @doc:notes/x.md b')).toEqual([{ kind: 'text', text: 'a @doc:notes/x.md b' }]);
  });

  it('parses registered slash commands', () => {
    refreshSlashCommandWireIndex(cmdFixtures);
    expect(parseMessageSegments('/clear please')).toEqual([
      { kind: 'command', name: 'clear' },
      { kind: 'text', text: ' please' },
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
