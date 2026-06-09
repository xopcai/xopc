import { describe, expect, it } from 'vitest';

import { buildNoteAttachmentRef } from '../attachment-ref.js';
import {
  buildNoteIndexMeta,
  buildNoteSnippet,
  extractAttachmentFileNames,
  extractCoverAttachmentId,
  stripMediaFromPlainText,
} from '../note-index-meta.js';
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

describe('note-index-meta', () => {
  it('strips canonical attachment refs from snippets', () => {
    const ref = buildNoteAttachmentRef('note-1', 'a1');
    expect(stripMediaFromPlainText(`Hello ![photo](${ref}) world`)).toBe('Hello world');
    expect(stripMediaFromPlainText(`![photo.jpg](${ref})`)).toBe('');
    expect(stripMediaFromPlainText(`[Voice · 30s](${ref})`)).toBe('');
  });

  it('extracts cover from image blocks and canonical markdown refs', () => {
    expect(
      extractCoverAttachmentId(
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
          attachments: [
            {
              id: 'att-block',
              type: 'image',
              mimeType: 'image/png',
              fileName: 'a.png',
              size: 1,
              relativePath: 'a.png',
            },
          ],
        }),
      ),
    ).toBe('att-block');

    expect(
      extractCoverAttachmentId(
        baseNote({
          text: `![photo.jpg](${buildNoteAttachmentRef('note-1', 'att-canonical')})`,
          attachments: [
            {
              id: 'att-canonical',
              type: 'image',
              mimeType: 'image/jpeg',
              fileName: 'photo.jpg',
              size: 1,
              relativePath: 'photo.jpg',
            },
          ],
        }),
      ),
    ).toBe('att-canonical');
  });

  it('ignores unreferenced attachments', () => {
    expect(
      extractCoverAttachmentId(
        baseNote({
          attachments: [
            {
              id: 'att-1',
              type: 'image',
              mimeType: 'image/png',
              fileName: 'a.png',
              size: 1,
              relativePath: 'x.png',
            },
          ],
        }),
      ),
    ).toBeUndefined();
  });

  it('extracts attachment file names for index search', () => {
    expect(
      extractAttachmentFileNames(
        baseNote({
          attachments: [
            {
              id: 'att-1',
              type: 'image',
              mimeType: 'image/jpeg',
              fileName: 'Vacation Photo.JPG',
              size: 1,
              relativePath: 'x.jpg',
            },
            {
              id: 'att-2',
              type: 'audio',
              mimeType: 'audio/webm',
              fileName: 'memo.webm',
              size: 1,
              relativePath: 'memo.webm',
            },
          ],
        }),
      ),
    ).toEqual(['vacation photo.jpg', 'memo.webm']);
  });

  it('builds empty snippet for image-only notes but keeps cover id', () => {
    const meta = buildNoteIndexMeta(
      baseNote({
        text: `![photo.jpg](${buildNoteAttachmentRef('note-1', 'att-1')})`,
        attachments: [
          {
            id: 'att-1',
            type: 'image',
            mimeType: 'image/jpeg',
            fileName: 'photo.jpg',
            size: 10,
            relativePath: 'photo.jpg',
          },
        ],
      }),
    );

    expect(meta.snippet).toBeUndefined();
    expect(meta.coverAttachmentId).toBe('att-1');
    expect(buildNoteSnippet(baseNote({ text: 'Remember to call Sam tomorrow' }))).toBe(
      'Remember to call Sam tomorrow',
    );
  });
});
