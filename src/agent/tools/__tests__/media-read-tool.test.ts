import { beforeEach, describe, expect, it, vi } from 'vitest';

const { readMediaReference } = vi.hoisted(() => ({
  readMediaReference: vi.fn(),
}));

vi.mock('../../../media/media-reference.js', () => ({ readMediaReference }));

vi.mock('../../../media/store.js', () => ({
  MEDIA_MAX_BYTES: 5 * 1024 * 1024,
  mimeTypeFromMediaPath: () => 'text/plain',
}));

import { createReadMediaTool } from '../media-read-tool.js';

describe('read_media', () => {
  beforeEach(() => {
    readMediaReference.mockReset();
    readMediaReference.mockResolvedValue({
      buffer: Buffer.from('hello'),
      path: '/tmp/message.txt',
    });
  });

  it('reads up to 5 MiB by default', async () => {
    const tool = createReadMediaTool();

    const result = await tool.execute('call-1', { uri: 'media://inbound/message.txt' });

    expect(readMediaReference).toHaveBeenCalledWith(
      'media://inbound/message.txt',
      5 * 1024 * 1024,
    );
    expect(result.details).toMatchObject({ ok: true, size: 5 });
  });

  it('caps requested reads at 5 MiB', async () => {
    const tool = createReadMediaTool();

    await tool.execute('call-1', {
      uri: 'media://inbound/message.txt',
      maxBytes: 20 * 1024 * 1024,
    });

    expect(readMediaReference).toHaveBeenCalledWith(
      'media://inbound/message.txt',
      5 * 1024 * 1024,
    );
  });
});
