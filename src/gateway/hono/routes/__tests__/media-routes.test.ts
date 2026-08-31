import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { saveMediaBuffer } = vi.hoisted(() => ({ saveMediaBuffer: vi.fn() }));

vi.mock('../../../../media/store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../media/store.js')>();
  return { ...actual, saveMediaBuffer };
});

import { registerMediaRoutes } from '../media.js';

function createApp() {
  const app = new Hono();
  registerMediaRoutes(app, {
    service: {},
    strictRateLimitMiddleware: async (_c, next) => next(),
  } as never);
  return app;
}

describe('media upload route', () => {
  beforeEach(() => {
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
