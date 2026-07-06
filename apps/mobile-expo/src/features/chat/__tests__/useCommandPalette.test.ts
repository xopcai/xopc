/**
 * Unit tests for detectSlashRange and paletteItemMatchRank.
 */
import { describe, expect, it } from 'vitest';

import { detectSlashRange, paletteItemMatchRank } from '../command-palette-utils';
import type { PaletteItem } from '../command-palette.types';

// ---------------------------------------------------------------------------
// detectSlashRange
// ---------------------------------------------------------------------------

describe('detectSlashRange', () => {
  it('returns null for empty text', () => {
    expect(detectSlashRange('', 0)).toBeNull();
  });

  it('detects `/` at position 0 with cursor at 1', () => {
    const result = detectSlashRange('/', 1);
    expect(result).toEqual({ start: 0, end: 1, query: '' });
  });

  it('detects `/` at position 0 with query', () => {
    const result = detectSlashRange('/sea', 4);
    expect(result).toEqual({ start: 0, end: 4, query: 'sea' });
  });

  it('detects `/` in the middle of text', () => {
    const result = detectSlashRange('hello /wor', 10);
    expect(result).toEqual({ start: 6, end: 10, query: 'wor' });
  });

  it('returns null when cursor is before the slash', () => {
    expect(detectSlashRange('hello /world', 3)).toBeNull();
  });

  it('returns null when there is a space after slash (broken token)', () => {
    // "/ " → the regex won't match because it requires non-whitespace after /
    expect(detectSlashRange('/ text', 1)).toEqual({ start: 0, end: 1, query: '' });
    // But with cursor at position after space, the slash is before a space so won't match
    expect(detectSlashRange('/ text', 2)).toBeNull();
  });

  it('does not trigger on already-applied /skill:name token', () => {
    expect(detectSlashRange('/skill:search ', 14)).toBeNull();
    expect(detectSlashRange('/skill:search', 13)).toBeNull();
  });

  it('handles edge case: single slash with cursor at 0', () => {
    // Special case in implementation: text is "/" but cursor is 0
    const result = detectSlashRange('/', 0);
    expect(result).toEqual({ start: 0, end: 1, query: '' });
  });

  it('works with multiline text', () => {
    const text = 'first line\n/se';
    const result = detectSlashRange(text, text.length);
    expect(result).toEqual({ start: 11, end: 14, query: 'se' });
  });

  it('returns null for text without slash', () => {
    expect(detectSlashRange('hello world', 11)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// paletteItemMatchRank
// ---------------------------------------------------------------------------

describe('paletteItemMatchRank', () => {
  const skillItem: PaletteItem = {
    kind: 'skill',
    id: 'skill:search',
    name: 'search',
    description: 'Web search skill',
    aliases: ['find', 'lookup'],
  };

  const commandItem: PaletteItem = {
    kind: 'command',
    id: 'cmd:new',
    name: 'new',
    description: 'Create a new session',
    aliases: ['create'],
  };

  it('returns 0 for empty query (matches everything)', () => {
    expect(paletteItemMatchRank(skillItem, '')).toBe(0);
    expect(paletteItemMatchRank(commandItem, '')).toBe(0);
  });

  it('returns 0 for exact name match', () => {
    expect(paletteItemMatchRank(skillItem, 'search')).toBe(0);
  });

  it('returns 1 for exact alias match', () => {
    expect(paletteItemMatchRank(skillItem, 'find')).toBe(1);
  });

  it('returns 2 for name prefix match', () => {
    expect(paletteItemMatchRank(skillItem, 'sea')).toBe(2);
  });

  it('returns 3 for alias prefix match', () => {
    expect(paletteItemMatchRank(skillItem, 'fin')).toBe(3);
  });

  it('returns 4 for name substring match', () => {
    expect(paletteItemMatchRank(skillItem, 'arc')).toBe(4);
  });

  it('returns 5 for alias substring match', () => {
    expect(paletteItemMatchRank(skillItem, 'oku')).toBe(5);
  });

  it('returns 100 for description-only match', () => {
    expect(paletteItemMatchRank(skillItem, 'web')).toBe(100);
  });

  it('returns null for no match', () => {
    expect(paletteItemMatchRank(skillItem, 'zzz')).toBeNull();
  });

  it('is case insensitive', () => {
    expect(paletteItemMatchRank(skillItem, 'SEARCH')).toBe(0);
    expect(paletteItemMatchRank(commandItem, 'NEW')).toBe(0);
  });
});
