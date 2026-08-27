import { describe, expect, it } from 'vitest';

import {
  imageBlockToMessageAttachment,
  imageContentBlocksToAttachments,
} from '../image-content-attachments';

describe('image content attachments', () => {
  it('keeps media URI image blocks as canonical media references', () => {
    const attachment = imageBlockToMessageAttachment({
      type: 'image',
      source: { media_type: 'image/png', data: 'media://generated/chat/image.png' },
    }, 0);

    expect(attachment).toEqual({
      name: 'image-1',
      mimeType: 'image/png',
      type: 'image',
      uri: 'media://generated/chat/image.png',
    });
  });

  it('keeps generated workspace images as workspace references', () => {
    const attachment = imageBlockToMessageAttachment({
      type: 'image',
      source: { media_type: 'image/webp', data: '/Users/x/ws/media/generated/cat.webp' },
    }, 0);

    expect(attachment).toEqual({
      name: 'cat.webp',
      mimeType: 'image/webp',
      type: 'image',
      workspaceRelativePath: 'media/generated/cat.webp',
    });
  });

  it('drops empty image blocks while preserving source order', () => {
    expect(imageContentBlocksToAttachments([
      { type: 'image', source: { data: '' } },
      { type: 'image', source: { data: 'media://generated/chat/second.png' } },
    ])).toEqual([
      expect.objectContaining({ uri: 'media://generated/chat/second.png' }),
    ]);
  });
});
