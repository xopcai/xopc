import { readFile } from 'node:fs/promises';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const saveMediaBufferMock = vi.fn();

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
}));

vi.mock('../../../media/store.js', () => ({
  MEDIA_MAX_BYTES: 5 * 1024 * 1024,
  mimeTypeFromMediaPath: (filePath: string) =>
    filePath.endsWith('.svg') ? 'image/svg+xml' : 'application/octet-stream',
  saveMediaBuffer: (...args: unknown[]) => saveMediaBufferMock(...args),
}));

import { createSendMediaTool } from '../send-media.js';

const readFileMock = vi.mocked(readFile);

function savedMedia(contentType: string) {
  return {
    id: 'photo---id.webp',
    bucket: 'outbound' as const,
    contentType,
    path: '/state/media/outbound/photo---id.webp',
    size: 12,
    uri: 'media://outbound/photo---id.webp',
  };
}

describe('send_media', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('persists Webchat media in the tool result without publishing to a channel adapter', async () => {
    const webp = Buffer.concat([
      Buffer.from('RIFF'),
      Buffer.alloc(4),
      Buffer.from('WEBP'),
    ]);
    readFileMock.mockResolvedValue(webp);
    saveMediaBufferMock.mockResolvedValue(savedMedia('image/webp'));
    const publishOutbound = vi.fn();
    const tool = createSendMediaTool(
      '/tmp/workspace',
      { publishOutbound } as any,
      () => ({ channel: 'webchat', chatId: 'chat-1' }),
    );

    const result = await tool.execute('call-1', {
      filePath: '/tmp/workspace/generated.jpeg',
      caption: 'Generated image',
    });

    expect(publishOutbound).not.toHaveBeenCalled();
    expect(saveMediaBufferMock).toHaveBeenCalledWith(
      webp,
      expect.objectContaining({ bucket: 'outbound', contentType: 'image/webp' }),
    );
    expect(result.details).toMatchObject({
      caption: 'Generated image',
      media: [{
        type: 'photo',
        mimeType: 'image/webp',
        uri: 'media://outbound/photo---id.webp',
      }],
    });
    expect(result.content[0]?.text).toContain('Media attached');
  });

  it('still dispatches persisted media to configured non-Webchat channels', async () => {
    const svg = Buffer.from('<svg/>');
    readFileMock.mockResolvedValue(svg);
    saveMediaBufferMock.mockResolvedValue(savedMedia('image/svg+xml'));
    const publishOutbound = vi.fn().mockResolvedValue(undefined);
    const tool = createSendMediaTool(
      '/tmp/workspace',
      { publishOutbound } as any,
      () => ({ channel: 'telegram', chatId: '123456' }),
    );

    const result = await tool.execute('call-1', { filePath: '/tmp/workspace/icon.svg' });

    expect(publishOutbound).toHaveBeenCalledWith(expect.objectContaining({
      channel: 'telegram',
      mediaType: 'document',
      mediaUrl: expect.stringMatching(/^data:image\/svg\+xml;base64,/),
    }));
    expect(result.details).toMatchObject({ media: [{ uri: 'media://outbound/photo---id.webp' }] });
  });

  it('returns an error when no conversation context is active', async () => {
    const tool = createSendMediaTool(
      '/tmp/workspace',
      { publishOutbound: vi.fn() } as any,
      () => null,
    );

    const result = await tool.execute('call-1', { filePath: 'image.png' });

    expect(result.content[0]?.text).toContain('No active conversation context');
    expect(readFileMock).not.toHaveBeenCalled();
  });
});
