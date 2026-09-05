import { describe, expect, it } from 'vitest';

import { buildNoteReadBlocks } from '../note-read-blocks';

describe('buildNoteReadBlocks', () => {
  it('keeps markdown around note images and resolves cached display sources', () => {
    const source = 'xopc-attachment://notes/note-1/image-1';
    expect(buildNoteReadBlocks(`Before\n\n![Photo](${source})\n\nAfter`, { [source]: 'data:image/png;base64,AA==' })).toEqual([
      { kind: 'markdown', key: 'text:0', content: 'Before' },
      { kind: 'image', key: `image:${source}:8`, alt: 'Photo', uri: 'data:image/png;base64,AA==' },
      { kind: 'markdown', key: 'text:56', content: 'After' },
    ]);
  });
});
