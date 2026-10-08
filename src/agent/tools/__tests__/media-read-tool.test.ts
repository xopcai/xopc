import { beforeEach, describe, expect, it, vi } from 'vitest';

const { readMediaReference } = vi.hoisted(() => ({
  readMediaReference: vi.fn(),
}));

vi.mock('../../../media/media-reference.js', () => ({ readMediaReference }));

vi.mock('../../../media/store.js', () => ({
  MEDIA_MAX_BYTES: 5 * 1024 * 1024,
  mimeTypeFromMediaPath: vi.fn(() => 'text/plain'),
}));

import { mimeTypeFromMediaPath } from '../../../media/store.js';
import { createReadMediaTool } from '../media-read-tool.js';

describe('read_media', () => {
  beforeEach(() => {
    vi.mocked(mimeTypeFromMediaPath).mockReturnValue('text/plain');
    readMediaReference.mockReset();
    readMediaReference.mockResolvedValue({
      buffer: Buffer.from('hello'),
      path: '/tmp/message.txt',
    });
  });

  it('bounds personal text output and never emits binary Base64', async () => {
    readMediaReference.mockResolvedValue({ buffer: Buffer.from('x'.repeat(20000)), path: '/tmp/file' });
    const tool = createReadMediaTool({ textOnly: true, maxChars: 8000 });
    const text = await tool.execute('text', { uri: 'media://inbound/file' });
    expect(text.details).toMatchObject({ truncated: true });
    expect((text.content[0] as { text: string }).text.length).toBeLessThan(8200);
    vi.mocked(mimeTypeFromMediaPath).mockReturnValue('application/pdf');
    const binary = await tool.execute('binary', { uri: 'media://inbound/file' });
    expect(binary.details).toMatchObject({ requiresSpecialist: true });
    expect(JSON.stringify(binary.content)).not.toContain('base64');
    expect(JSON.stringify(binary.content).length).toBeLessThan(300);
  });

  it('delegates oversized personal attachments with their original reference and size', async () => {
    readMediaReference.mockRejectedValue(Object.assign(new Error('Too large'), { code: 'MEDIA_READ_LIMIT', size: 900000 }));
    const result = await createReadMediaTool({ textOnly: true, maxChars: 8000, maxReadBytes: 12000 })
      .execute('large', { uri: 'media://inbound/large.txt', maxBytes: 999999 });
    expect(readMediaReference).toHaveBeenCalledWith('media://inbound/large.txt', 12000);
    expect(result.details).toMatchObject({ requiresSpecialist: true, reason: 'large_attachment', size: 900000, uri: 'media://inbound/large.txt' });
    expect((result.content[0] as { text: string }).text).toContain('Tell the user briefly');
  });

  it('keeps missing-file errors distinct from large attachments', async () => {
    readMediaReference.mockRejectedValue(new Error('ENOENT'));
    const result = await createReadMediaTool({ textOnly: true, maxReadBytes: 12000 }).execute('missing', { uri: 'media://inbound/missing' });
    expect(result.details).toMatchObject({ ok: false });
    expect(result.details).not.toHaveProperty('requiresSpecialist');
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
