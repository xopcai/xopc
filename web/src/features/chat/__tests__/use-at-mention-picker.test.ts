import { describe, it, expect } from 'vitest';

import { detectAtRange } from '@/features/chat/palette/use-at-mention-picker';
import { noteContextRefFromAtMentionItem } from '@/features/chat/composer/use-composer-pickers';

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

  it('returns null inside @doc: wire token', () => {
    const text = 'read @doc:README.md thanks';
    const cursor = text.indexOf('thanks');
    expect(detectAtRange(text, cursor)).toBeNull();
  });

  it('returns null when no @ before caret', () => {
    expect(detectAtRange('plain', 5)).toBeNull();
  });
});

describe('Note @ mention context', () => {
  it('maps a Note item to a frozen composer context reference', () => {
    expect(noteContextRefFromAtMentionItem({
      kind: 'note',
      name: 'Launch plan',
      description: 'Plan snapshot',
      noteRef: { sourceId: 'note-1', expectedVersion: '42' },
    })).toEqual({
      kind: 'note',
      sourceId: 'note-1',
      expectedVersion: '42',
      title: 'Launch plan',
    });
  });

  it('does not treat files as Note context', () => {
    expect(noteContextRefFromAtMentionItem({
      kind: 'file',
      name: 'README.md',
      relativePath: 'README.md',
      isDirectory: false,
    })).toBeNull();
  });
});
