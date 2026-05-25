import { describe, expect, it } from 'vitest';

import { appendTranscriptToDraft } from '@/features/chat/composer/append-transcript-to-draft';

describe('appendTranscriptToDraft', () => {
  it('returns transcript when draft is empty', () => {
    expect(appendTranscriptToDraft('', '你好')).toBe('你好');
    expect(appendTranscriptToDraft('   ', 'hello')).toBe('hello');
  });

  it('appends with a space when draft has text', () => {
    expect(appendTranscriptToDraft('Hello', 'world')).toBe('Hello world');
    expect(appendTranscriptToDraft('Hello ', 'world')).toBe('Hello world');
  });

  it('returns previous draft when transcript is empty', () => {
    expect(appendTranscriptToDraft('keep', '')).toBe('keep');
    expect(appendTranscriptToDraft('keep', '   ')).toBe('keep');
  });
});
