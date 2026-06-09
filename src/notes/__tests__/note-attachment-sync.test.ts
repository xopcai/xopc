import { describe, expect, it } from 'vitest';

import { buildNoteAttachmentRef } from '../attachment-ref.js';
import {
  collectReferencedAttachmentIds,
  partitionAttachmentsByReference,
} from '../note-attachment-sync.js';
import type { Note } from '../types.js';

function baseNote(overrides: Partial<Note> = {}): Note {
  return {
    id: 'note-1',
    kind: 'media',
    status: 'inbox',
    createdAt: 1,
    updatedAt: 1,
    capturedVia: { channel: 'web' },
    ...overrides,
  };
}

const imageAttachment = {
  id: 'att-1',
  type: 'image' as const,
  mimeType: 'image/png',
  fileName: 'photo.png',
  size: 10,
  relativePath: 'photo.png',
};

describe('note-attachment-sync', () => {
  it('collects attachment ids referenced in canonical markdown', () => {
    const ids = collectReferencedAttachmentIds(
      baseNote({
        text: `Hello ![x](${buildNoteAttachmentRef('note-1', 'att-1')}) and ![y](${buildNoteAttachmentRef('note-1', 'att-2')})`,
      }),
    );
    expect([...ids]).toEqual(['att-1', 'att-2']);
  });

  it('collects attachment ids referenced in canonical markdown links', () => {
    const ids = collectReferencedAttachmentIds(
      baseNote({
        text: `[Voice · 30s](${buildNoteAttachmentRef('note-1', 'att-voice')})`,
      }),
    );
    expect([...ids]).toEqual(['att-voice']);
  });

  it('collects attachment ids from image blocks', () => {
    const ids = collectReferencedAttachmentIds(
      baseNote({
        blocks: [
          {
            id: 'b1',
            type: 'image',
            attachmentId: 'att-block',
            createdAt: 1,
            updatedAt: 1,
          },
        ],
      }),
    );
    expect([...ids]).toEqual(['att-block']);
  });

  it('partitions attachments into kept vs orphan sets', () => {
    const { kept, removed } = partitionAttachmentsByReference(
      baseNote({
        text: `![photo](${buildNoteAttachmentRef('note-1', 'att-1')})`,
        attachments: [
          imageAttachment,
          { ...imageAttachment, id: 'att-2', relativePath: 'other.png', fileName: 'other.png' },
        ],
      }),
    );

    expect(kept.map((item) => item.id)).toEqual(['att-1']);
    expect(removed.map((item) => item.id)).toEqual(['att-2']);
  });
});
