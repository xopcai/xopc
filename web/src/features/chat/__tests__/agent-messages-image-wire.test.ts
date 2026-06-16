import { describe, expect, it } from 'vitest';

import { normalizeAgentMessages } from '@/features/chat/messages/agent-messages';

describe('normalizeAgentMessages user attachment wire shape', () => {
  it('strips inline user image blocks from content', () => {
    const ui = normalizeAgentMessages([
      {
        role: 'user',
        content: [
          { type: 'image', data: 'SGVsbG8=', mimeType: 'image/png' },
          { type: 'text', text: 'caption' },
        ],
        timestamp: 1,
      },
    ]);
    expect(ui).toHaveLength(1);
    expect(ui[0]?.content).toEqual([{ type: 'text', text: 'caption' }]);
  });

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
    expect(att?.data).toBeUndefined();
    expect(att?.content).toBeUndefined();
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
