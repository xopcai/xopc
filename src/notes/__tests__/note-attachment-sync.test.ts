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
    markdown: '',
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
        markdown: `Hello ![x](${buildNoteAttachmentRef('note-1', 'att-1')}) and ![y](${buildNoteAttachmentRef('note-1', 'att-2')})`,
      }),
    );
    expect([...ids]).toEqual(['att-1', 'att-2']);
  });

  it('collects attachment ids referenced in canonical markdown links', () => {
    const ids = collectReferencedAttachmentIds(
      baseNote({
        markdown: `[Voice · 30s](${buildNoteAttachmentRef('note-1', 'att-voice')})`,
      }),
    );
    expect([...ids]).toEqual(['att-voice']);
  });

  it('collects attachment ids from bare canonical refs', () => {
    const ids = collectReferencedAttachmentIds(
      baseNote({
        markdown: buildNoteAttachmentRef('note-1', 'att-bare'),
      }),
    );
    expect([...ids]).toEqual(['att-bare']);
  });

  it('partitions attachments into kept vs orphan sets', () => {
    const { kept, removed } = partitionAttachmentsByReference(
      baseNote({
        markdown: `![photo](${buildNoteAttachmentRef('note-1', 'att-1')})`,
        attachments: [
          imageAttachment,
          { ...imageAttachment, id: 'att-2', relativePath: 'other.png', fileName: 'other.png' },
        ],
      }),
    );

    expect(kept.map((item) => item.id)).toEqual(['att-1']);
    expect(removed.map((item) => item.id)).toEqual(['att-2']);
  });

  it('keeps structured attachments that do not belong in user Markdown', () => {
    const { kept, removed } = partitionAttachmentsByReference(
      baseNote({
        attachments: [{ ...imageAttachment, retainWithoutReference: true }],
      }),
    );

    expect(kept.map((item) => item.id)).toEqual(['att-1']);
    expect(removed).toEqual([]);
  });
});
