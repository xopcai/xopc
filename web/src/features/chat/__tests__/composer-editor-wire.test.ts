import { describe, it, expect } from 'vitest';
import {
  listSkillNamesInWire,
  removeSkillTokenAtOrBeforeCaret,
  removeTrailingSkillTokenBeforeCaret,
} from '@/features/chat/composer-editor-wire';

describe('removeSkillTokenAtOrBeforeCaret', () => {
  it('removes token when caret is at end of token', () => {
    const w = '/skill:a /skill:b';
    const endB = w.length;
    expect(removeSkillTokenAtOrBeforeCaret(w, endB)).toEqual({
      wire: '/skill:a ',
      caret: 9,
    });
  });

  it('removes first token when caret inside it', () => {
    expect(removeSkillTokenAtOrBeforeCaret('/skill:foo x', 8)).toEqual({
      wire: ' x',
      caret: 0,
    });
  });
});

describe('listSkillNamesInWire', () => {
  it('collects all skill tokens', () => {
    expect([...listSkillNamesInWire('/skill:a /skill:b x')].sort()).toEqual(['a', 'b']);
  });
});

describe('removeTrailingSkillTokenBeforeCaret', () => {
  it('removes last token when caret is immediately after token (suffix match)', () => {
    const w = '/skill:a /skill:b';
    // caret one past last char of /skill:b — same as len
    expect(removeTrailingSkillTokenBeforeCaret(w, w.length)).toEqual({
      wire: '/skill:a ',
      caret: 9,
    });
  });
});
