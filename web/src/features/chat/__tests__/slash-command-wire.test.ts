import { beforeEach, describe, expect, it } from 'vitest';

import type { CommandEntry } from '@/features/chat/palette/command-palette.types';
import {
  collectSlashCommandWireRanges,
  refreshSlashCommandWireIndex,
  trySlashCommandTokenAt,
} from '@/features/chat/palette/slash-command-wire';

const sampleCommands: CommandEntry[] = [
  {
    id: 'session.clear',
    name: 'clear',
    aliases: [],
    description: '',
    category: 'session',
    acceptsArgs: false,
    examples: [],
  },
  {
    id: 'system.help',
    name: 'help',
    aliases: ['h'],
    description: '',
    category: 'system',
    acceptsArgs: false,
    examples: [],
  },
];

describe('slash-command-wire', () => {
  beforeEach(() => {
    refreshSlashCommandWireIndex(sampleCommands);
  });

  it('matches at line start and after whitespace', () => {
    expect(trySlashCommandTokenAt('/clear', 0)).toEqual({ len: 6, matchedKey: 'clear' });
    expect(trySlashCommandTokenAt('x /clear', 2)).toEqual({ len: 6, matchedKey: 'clear' });
  });

  it('does not match command path segments', () => {
    expect(trySlashCommandTokenAt('foo/clear', 3)).toBeNull();
  });

  it('matches aliases', () => {
    expect(trySlashCommandTokenAt('/h', 0)).toEqual({ len: 2, matchedKey: 'h' });
  });

  it('does not treat /skill: as slash command', () => {
    expect(trySlashCommandTokenAt('/skill:doc', 0)).toBeNull();
  });

  it('collects non-overlapping command ranges', () => {
    expect(collectSlashCommandWireRanges('/clear then /h')).toEqual([
      { start: 0, end: 6 },
      { start: 12, end: 14 },
    ]);
  });
});
