import { beforeEach, describe, expect, it, vi } from 'vitest';

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));

vi.mock('../../../api/client', () => ({
  apiFetch,
  formatApiHttpError: (status: number, statusText: string, message?: string) => (
    message ? `${status} ${statusText}: ${message}` : `${status} ${statusText}`
  ),
}));

import { generateSpeechChunk } from '../read-aloud-api';

describe('generateSpeechChunk', () => {
  beforeEach(() => apiFetch.mockReset());

  it('returns binary speech with its mime type', async () => {
    apiFetch.mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), {
      status: 200,
      headers: { 'Content-Type': 'audio/mpeg' },
    }));

    await expect(generateSpeechChunk({ text: '你好', language: 'zh-CN' })).resolves.toEqual({
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: 'audio/mpeg',
    });
    expect(apiFetch).toHaveBeenCalledWith('/api/voice/speech', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ text: '你好', language: 'zh-CN' }),
    }));
  });

  it('surfaces the gateway error message', async () => {
    apiFetch.mockResolvedValue(new Response(JSON.stringify({ error: { message: 'TTS unavailable' } }), {
      status: 503,
      statusText: 'Unavailable',
      headers: { 'Content-Type': 'application/json' },
    }));

    await expect(generateSpeechChunk({ text: 'Hello', language: 'en-US' }))
      .rejects.toThrow('503 Unavailable: TTS unavailable');
  });
});
