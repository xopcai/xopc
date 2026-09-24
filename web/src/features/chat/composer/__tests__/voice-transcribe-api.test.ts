import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchJson } = vi.hoisted(() => ({ fetchJson: vi.fn() }));

vi.mock('@/lib/fetch', () => ({ fetchJson }));
vi.mock('@/lib/url', () => ({ apiUrl: (path: string) => path }));

import {
  fetchVoiceReadiness,
  fetchVoiceSttAvailable,
  invalidateVoiceSttAvailabilityCache,
  transcribeVoiceBlob,
} from '../voice-transcribe-api';

describe('voice-transcribe-api', () => {
  beforeEach(() => {
    fetchJson.mockReset();
    invalidateVoiceSttAvailabilityCache();
  });

  it('uploads browser recordings as multipart without base64 expansion', async () => {
    fetchJson.mockResolvedValue({ payload: { text: 'hello', refinementAvailable: false } });

    await expect(
      transcribeVoiceBlob(new Blob(['audio'], { type: 'audio/webm;codecs=opus' }), 'audio/webm'),
    ).resolves.toEqual({ text: 'hello', refinementAvailable: false });

    const [url, init] = fetchJson.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/voice/transcriptions');
    expect(init.body).toBeInstanceOf(FormData);
    const audio = (init.body as FormData).get('audio');
    expect(audio).toBeInstanceOf(Blob);
    expect((audio as File).name).toBe('recording.webm');
  });

  it('can invalidate the STT availability cache after settings change', async () => {
    fetchJson
      .mockResolvedValueOnce({ voice: { sttAvailable: false } })
      .mockResolvedValueOnce({ voice: { sttAvailable: true } });

    expect(await fetchVoiceSttAvailable()).toBe(false);
    expect(await fetchVoiceSttAvailable()).toBe(false);
    invalidateVoiceSttAvailabilityCache();
    expect(await fetchVoiceSttAvailable()).toBe(true);
    expect(fetchJson).toHaveBeenCalledTimes(2);
  });

  it('reports extension providers using the generic readiness state', async () => {
    fetchJson.mockResolvedValueOnce({
      voice: { sttAvailable: true, sttEnabled: true, sttProvider: 'my-local-stt' },
    });

    await expect(fetchVoiceReadiness()).resolves.toEqual({
      state: 'ready',
      provider: 'my-local-stt',
    });
  });
});
