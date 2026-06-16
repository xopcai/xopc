import { describe, expect, it } from 'vitest';

import { normalizeAgentMessages } from '@/features/chat/messages/agent-messages';
import { messageAttachmentsToWire } from '@/features/chat/messages/user-message-plain-text';

describe('normalizeAgentMessages user attachment wire shape', () => {
  it('keeps persisted media metadata without inline data', () => {
    const ui = normalizeAgentMessages([
      {
        role: 'user',
        content: [{ type: 'text', text: 'see file' }],
        media: [
          {
            id: 'a1',
            name: 'photo.jpg',
            mimeType: 'image/jpeg',
            type: 'photo',
            size: 100,
            uri: 'media://inbound/photo---uuid.jpg',
            bucket: 'inbound',
            path: '/tmp/photo.jpg',
          },
        ],
        timestamp: 2,
      },
    ]);
    const att = ui[0]?.attachments?.[0];
    expect(att?.uri).toBe('media://inbound/photo---uuid.jpg');
    expect(att?.bucket).toBe('inbound');
    expect(att?.path).toBe('/tmp/photo.jpg');
    expect(att?.data).toBeUndefined();
    expect(att?.content).toBeUndefined();
  });

  it('builds retry payloads from persisted media refs without empty data fields', () => {
    const wire = messageAttachmentsToWire([
      {
        id: 'a1',
        type: 'image',
        name: 'photo.jpg',
        mimeType: 'image/jpeg',
        size: 100,
        uri: 'media://inbound/photo---uuid.jpg',
        bucket: 'inbound',
        path: '/tmp/photo.jpg',
      },
    ]);
    expect(wire?.[0]).toMatchObject({
      id: 'a1',
      type: 'image',
      mimeType: 'image/jpeg',
      name: 'photo.jpg',
      uri: 'media://inbound/photo---uuid.jpg',
      bucket: 'inbound',
      path: '/tmp/photo.jpg',
    });
    expect(wire?.[0]).not.toHaveProperty('data');
  });

  it('preserves assistant inline image blocks', () => {
    const ui = normalizeAgentMessages([
      {
        role: 'assistant',
        content: [{ type: 'image', data: 'SGVsbG8=', mimeType: 'image/png' }],
        timestamp: 3,
      },
    ]);
    const block = ui[0]?.content[0];
    expect(block?.type).toBe('image');
    if (block?.type === 'image') {
      expect(block.source?.data).toBe('data:image/png;base64,SGVsbG8=');
    }
  });
});
