import { describe, expect, it } from 'vitest';

import {
  attachmentIdFromTarget,
  buildNoteAttachmentRef,
  parseNoteAttachmentTarget,
} from '../attachment-ref.js';

describe('attachment-ref', () => {
  it('builds and parses canonical note attachment refs', () => {
    const ref = buildNoteAttachmentRef('note-1', 'att-1');
    expect(ref).toBe('xopc-attachment://notes/note-1/att-1');
    expect(parseNoteAttachmentTarget(ref)).toEqual({
      noteId: 'note-1',
      attachmentId: 'att-1',
    });
    expect(attachmentIdFromTarget(ref, 'note-1')).toBe('att-1');
  });

  it('rejects non-canonical targets', () => {
    expect(parseNoteAttachmentTarget('/api/notes/note-1/media/att-2')).toBeNull();
    expect(parseNoteAttachmentTarget('https://example.com/photo.png')).toBeNull();
  });

  it('rejects refs for a different note id when expected', () => {
    expect(
      parseNoteAttachmentTarget(
        buildNoteAttachmentRef('other', 'att-1'),
        'note-1',
      ),
    ).toBeNull();
  });
});
