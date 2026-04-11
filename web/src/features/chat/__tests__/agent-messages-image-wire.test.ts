import { describe, expect, it } from 'vitest';

import { normalizeAgentMessages } from '@/features/chat/agent-messages';

describe('normalizeAgentMessages image wire shape', () => {
  it('maps pi-style { type, data, mimeType } to ImageContent with data URL src', () => {
    const ui = normalizeAgentMessages([
      {
        role: 'user',
        content: [{ type: 'image', data: 'SGVsbG8=', mimeType: 'image/png' }],
        timestamp: 1,
      },
    ]);
    expect(ui).toHaveLength(1);
    const block = ui[0]?.content[0];
    expect(block?.type).toBe('image');
    if (block?.type === 'image') {
      expect(block.source?.data).toBe('data:image/png;base64,SGVsbG8=');
    }
  });

  it('preserves existing source.data', () => {
    const ui = normalizeAgentMessages([
      {
        role: 'user',
        content: [{ type: 'image', source: { data: 'data:image/jpeg;base64,xx' } }],
        timestamp: 2,
      },
    ]);
    const block = ui[0]?.content[0];
    expect(block?.type).toBe('image');
    if (block?.type === 'image') {
      expect(block.source?.data).toBe('data:image/jpeg;base64,xx');
    }
  });
});
