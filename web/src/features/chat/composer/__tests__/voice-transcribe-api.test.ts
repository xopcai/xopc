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
    fetchJson.mockResolvedValue({ payload: { raw: 'hello' } });

    await transcribeVoiceBlob(new Blob(['audio'], { type: 'audio/webm;codecs=opus' }), 'audio/webm');

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

  it('exposes local model download progress to the composer', async () => {
    fetchJson
      .mockResolvedValueOnce({
        voice: {
          sttAvailable: false,
          sttEnabled: true,
          sttProvider: 'xopc-local',
          localModelId: 'sensevoice-small',
        },
      })
      .mockResolvedValueOnce({
        payload: {
          models: [{
            id: 'sensevoice-small',
            state: 'downloading',
            progress: 0.42,
            downloadedBytes: 100,
            totalBytes: 240,
          }],
        },
      });

    await expect(fetchVoiceReadiness()).resolves.toMatchObject({
      state: 'preparing',
      provider: 'xopc-local',
      modelId: 'sensevoice-small',
      progress: 0.42,
    });
  });
});
