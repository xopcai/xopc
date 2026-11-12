import { SEEDANCE_FAST_VIDEO_MODEL_REF, SEEDANCE_VIDEO_MODEL_REF } from '@xopcai/gateway-contract';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchProviderVideo, getVideoProvider } from '../providers.js';
import { querySeedanceVideo, submitSeedanceVideo } from '../seedance.js';

afterEach(() => vi.unstubAllGlobals());

const input = {
  model_ref: SEEDANCE_VIDEO_MODEL_REF, prompt: 'A paper boat', duration: 4, ratio: '16:9' as const,
  resolution: '480P' as const, image_bytes: null, image_mime: null,
};
const url = 'https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks';

describe('Ark Seedance adapter', () => {
  it('sends text-only and first-frame requests using the selected Ark model', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => Response.json({ id: 'cgt-123' }));
    vi.stubGlobal('fetch', fetch);
    await expect(submitSeedanceVideo('ark-key', input)).resolves.toBe('cgt-123');
    await submitSeedanceVideo('ark-key', {
      ...input, model_ref: SEEDANCE_FAST_VIDEO_MODEL_REF, ratio: 'adaptive',
      image_bytes: Buffer.from('reference'), image_mime: 'image/png',
    });
    expect(fetch.mock.calls[0][0]).toBe(url);
    expect(fetch.mock.calls[0][1]?.headers).toMatchObject({ Authorization: 'Bearer ark-key' });
    expect(JSON.parse(fetch.mock.calls[0][1]?.body as string)).toEqual({
      model: 'doubao-seedance-2-5-260628', content: [{ type: 'text', text: input.prompt }],
      ratio: '16:9', duration: 4, resolution: '480p', generate_audio: false, watermark: true,
    });
    expect(JSON.parse(fetch.mock.calls[1][1]?.body as string)).toMatchObject({
      model: 'doubao-seedance-2-0-fast-260128', ratio: 'adaptive',
      content: [{ type: 'text', text: input.prompt }, {
        type: 'image_url', role: 'first_frame', image_url: { url: 'data:image/png;base64,cmVmZXJlbmNl' },
      }],
    });
  });

  it('maps Ark task states and reads the nested result URL', async () => {
    const output = 'https://ark-content-generation-cn-beijing.tos-cn-beijing.volces.com/video.mp4';
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(Response.json({ status: 'queued' }))
      .mockResolvedValueOnce(Response.json({ status: 'running' }))
      .mockResolvedValueOnce(Response.json({ status: 'succeeded', content: { video_url: output } }))
      .mockResolvedValueOnce(Response.json({ status: 'expired' }));
    vi.stubGlobal('fetch', fetch);
    await expect(querySeedanceVideo('ark-key', 'cgt-123')).resolves.toEqual({ state: 'submitted' });
    await expect(querySeedanceVideo('ark-key', 'cgt-123')).resolves.toEqual({ state: 'running' });
    await expect(querySeedanceVideo('ark-key', 'cgt-123')).resolves.toEqual({ state: 'completed', url: output });
    await expect(querySeedanceVideo('ark-key', 'cgt-123')).resolves.toMatchObject({ state: 'failed' });
    expect(fetch.mock.calls[0][0]).toBe(url + '/cgt-123');
  });

  it('rejects output links outside the Ark storage host before fetching', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    vi.stubGlobal('fetch', fetch);
    const provider = getVideoProvider(SEEDANCE_VIDEO_MODEL_REF);
    await expect(fetchProviderVideo(provider, 'https://tos-cn-beijing.volces.com.example.org/file')).rejects.toThrow('invalid video download host');
    await expect(fetchProviderVideo(provider, 'https://output.oss-cn-beijing.aliyuncs.com/file')).rejects.toThrow('invalid video download host');
    expect(fetch).not.toHaveBeenCalled();
  });
});
