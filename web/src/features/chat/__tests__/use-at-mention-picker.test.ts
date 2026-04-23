import { describe, it, expect } from 'vitest';

import { detectAtRange } from '@/features/chat/use-at-mention-picker';

describe('detectAtRange', () => {
  it('returns range and query after @', () => {
    const text = 'hello @sche world';
    const cursor = 'hello @sche'.length;
    expect(detectAtRange(text, cursor)).toEqual({ start: 6, end: 11, query: 'sche' });
  });

  it('ignores @ inside email local-part but still detects a later @ mention', () => {
    const text = 'user@domain.com @ok';
    const cursor = text.length;
    expect(detectAtRange(text, cursor)).toEqual({ start: 16, end: text.length, query: 'ok' });
    const atDomain = 'a@b';
    expect(detectAtRange(atDomain, atDomain.length)).toBeNull();
  });

  it('returns null inside @file: wire token', () => {
    const text = 'see @file:src/foo.ts please';
    const cursor = text.indexOf('please');
    expect(detectAtRange(text, cursor)).toBeNull();
  });

  it('returns null when no @ before caret', () => {
    expect(detectAtRange('plain', 5)).toBeNull();
  });
});
