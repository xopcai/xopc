import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { messagesReferenceMediaUri, readMediaReference, saveMediaBuffer } = vi.hoisted(() => ({
  messagesReferenceMediaUri: vi.fn(),
  readMediaReference: vi.fn(),
  saveMediaBuffer: vi.fn(),
}));

vi.mock('../../../../media/media-reference.js', () => ({ readMediaReference }));

vi.mock('../../../../media/session-references.js', () => ({ messagesReferenceMediaUri }));

vi.mock('../../../../media/store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../media/store.js')>();
  return { ...actual, saveMediaBuffer };
});

import { registerMediaRoutes } from '../media.js';

function createApp() {
  const app = new Hono();
  registerMediaRoutes(app, {
    service: {
      sessionIndexInstance: {
        loadMessages: vi.fn().mockResolvedValue([]),
      },
    },
    strictRateLimitMiddleware: async (_c, next) => next(),
  } as never);
  return app;
}

describe('media routes', () => {
  beforeEach(() => {
    messagesReferenceMediaUri.mockReset();
    messagesReferenceMediaUri.mockReturnValue(true);
    readMediaReference.mockReset();
    readMediaReference.mockResolvedValue({
      buffer: Buffer.from('0123456789'),
      path: '/tmp/reply.mp3',
    });
    saveMediaBuffer.mockReset();
    saveMediaBuffer.mockResolvedValue({
      id: 'voice---id.m4a',
      path: '/tmp/voice---id.m4a',
      size: 5,
      contentType: 'audio/mp4',
      bucket: 'inbound',
      uri: 'media://inbound/voice---id.m4a',
    });
  });

  it('returns full media with byte range metadata', async () => {
    const response = await createApp().request(
      '/api/media/read?uri=media%3A%2F%2Ftts%2Freply.mp3&sessionKey=chat-1',
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Accept-Ranges')).toBe('bytes');
    expect(response.headers.get('Content-Length')).toBe('10');
    await expect(response.text()).resolves.toBe('0123456789');
  });

  it.each([
    ['bytes=2-5', 'bytes 2-5/10', '2345'],
    ['bytes=7-', 'bytes 7-9/10', '789'],
    ['bytes=-3', 'bytes 7-9/10', '789'],
    ['bytes=8-20', 'bytes 8-9/10', '89'],
  ])('serves a valid %s request with 206', async (range, contentRange, body) => {
    const response = await createApp().request(
      '/api/media/read?uri=media%3A%2F%2Ftts%2Freply.mp3&sessionKey=chat-1',
      { headers: { Range: range } },
    );

    expect(response.status).toBe(206);
    expect(response.headers.get('Accept-Ranges')).toBe('bytes');
    expect(response.headers.get('Content-Range')).toBe(contentRange);
    expect(response.headers.get('Content-Length')).toBe(String(body.length));
    await expect(response.text()).resolves.toBe(body);
  });

  it.each(['bytes=10-', 'bytes=5-2', 'bytes=-0', 'items=0-1', 'bytes=0-1,3-4'])(
    'rejects an invalid %s request with 416',
    async (range) => {
      const response = await createApp().request(
        '/api/media/read?uri=media%3A%2F%2Ftts%2Freply.mp3&sessionKey=chat-1',
        { headers: { Range: range } },
      );

      expect(response.status).toBe(416);
      expect(response.headers.get('Content-Range')).toBe('bytes */10');
      expect(response.headers.get('Accept-Ranges')).toBe('bytes');
    },
  );

  it('persists multipart bytes and returns a media reference', async () => {
    const form = new FormData();
    form.append('file', new File(['voice'], 'voice.m4a', { type: 'audio/mp4' }));

    const response = await createApp().request('/api/media', { method: 'POST', body: form });

    expect(response.status).toBe(201);
    expect(saveMediaBuffer).toHaveBeenCalledWith(expect.any(Buffer), {
      bucket: 'inbound',
      contentType: 'audio/mp4',
      maxBytes: 32 * 1024 * 1024,
      originalFilename: 'voice.m4a',
    });
    await expect(response.json()).resolves.toEqual({
      ok: true,
      payload: {
        uri: 'media://inbound/voice---id.m4a',
        mimeType: 'audio/mp4',
        name: 'voice.m4a',
        size: 5,
      },
    });
  });
});
