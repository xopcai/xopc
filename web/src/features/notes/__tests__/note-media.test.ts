// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { buildNoteAttachmentRef, noteMediaApiPath, parseNoteAttachmentTarget } from '../attachment-ref';
import { noteAttachmentRef } from '../note-media';

describe('attachment-ref (web)', () => {
  it('builds canonical refs and API fetch paths', () => {
    expect(noteAttachmentRef('n1', 'a1')).toBe('xopc-attachment://notes/n1/a1');
    expect(noteMediaApiPath('n1', 'a1')).toBe('/api/notes/n1/media/a1');
    expect(parseNoteAttachmentTarget('xopc-attachment://notes/n1/a1')).toEqual({
      noteId: 'n1',
      attachmentId: 'a1',
    });
    expect(parseNoteAttachmentTarget('/api/notes/n1/media/a1')).toBeNull();
  });
});

describe('note-media', () => {
  it('uses canonical refs for persistence', () => {
    const ref = buildNoteAttachmentRef('n1', 'a1');
    expect(ref).toBe('xopc-attachment://notes/n1/a1');
  });
});
