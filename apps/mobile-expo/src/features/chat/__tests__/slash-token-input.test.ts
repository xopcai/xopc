import { describe, expect, it } from 'vitest';

import {
  findPillTokenEndingAtCursor,
  parseSlashTokens,
} from '../slash-token-utils';

describe('parseSlashTokens', () => {
  it('returns plain text segment when no skill tokens', () => {
    expect(parseSlashTokens('hello world')).toEqual([
      { text: 'hello world', isPill: false, start: 0, end: 11 },
    ]);
  });

  it('marks /skill:name tokens as pills', () => {
    expect(parseSlashTokens('run /skill:search now')).toEqual([
      { text: 'run ', isPill: false, start: 0, end: 4 },
      { text: '/skill:search', isPill: true, start: 4, end: 17 },
      { text: ' now', isPill: false, start: 17, end: 21 },
    ]);
  });
});

describe('findPillTokenEndingAtCursor', () => {
  it('returns token range when cursor is right after a pill', () => {
    const text = '/skill:search ';
    expect(findPillTokenEndingAtCursor(text, '/skill:search'.length)).toEqual({
      start: 0,
      end: '/skill:search'.length,
    });
  });

  it('returns null when cursor is inside or before token', () => {
    const text = '/skill:search';
    expect(findPillTokenEndingAtCursor(text, 3)).toBeNull();
  });
});
