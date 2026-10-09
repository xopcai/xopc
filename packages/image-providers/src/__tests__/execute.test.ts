import { describe, expect, it, vi } from 'vitest';
import { executeImageProvider, getImageProviderSpec, listImageProviderSpecs, validateImageRequest } from '../index.js';
import { authenticatedJobUrl, encodeBase64, readBytesLimited } from '../http.js';

const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jJYQAAAAASUVORK5CYII='), c => c.charCodeAt(0));
const b64 = encodeBase64(png);
const inputs = [{ blob: new Blob([png], { type: 'image/png' }), fileName: 'ref.png' }];
const reply = (id: string) => id === 'google' ? { status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'image', data: b64, mime_type: 'image/png' }] }] }
  : id === 'minimax' ? { base_resp: { status_code: 0 }, data: { image_base64: [b64] } }
  : id === 'tokenhub' ? { choices: [{ delta: { type: 'image', image: { url: 'https://cdn.test/image.png' } } }] }
  : ['zhipu-cn', 'ideogram'].includes(id) ? { data: [{ url: 'https://cdn.test/image.png' }] }
  : id === 'dashscope' ? { output: { choices: [{ message: { content: [{ image: 'https://cdn.test/image.png' }] } }] } }
  : { data: [{ b64_json: b64 }] };

for (const spec of listImageProviderSpecs()) describe(spec.id, () => {
  for (const editing of [false, true]) {
    const model = spec.models[0]!;
    if (editing && !model.capabilities.edit?.enabled) continue;
    it(`uses the current ${editing ? 'edit' : 'generation'} protocol and validates bytes`, async () => {
      const calls: Array<{ url: string; init?: RequestInit }> = [];
      const fetchImpl = vi.fn<typeof fetch>(async (url, init) => {
        calls.push({ url: String(url), init });
        if (String(url).startsWith('https://cdn.test')) {
          expect(new Headers(init?.headers).has('authorization')).toBe(false);
          return new Response(png);
        }
        if (spec.id === 'fal') {
          if (String(url).endsWith('/status')) return Response.json({ status: 'COMPLETED' });
          if (String(url).endsWith('/result')) return Response.json({ images: [{ url: 'https://cdn.test/image.png' }] });
          return Response.json({ request_id: 'job', status_url: `${spec.baseUrl}/status`, response_url: `${spec.baseUrl}/result` });
        }
        if (spec.id === 'bfl') {
          if (String(url).endsWith('/poll')) return Response.json({ status: 'Ready', result: { sample: 'https://cdn.test/image.png' } });
          return Response.json({ id: 'job', polling_url: `${spec.baseUrl}/poll` });
        }
        if (spec.id === 'stability') return new Response(png);
        return Response.json(reply(spec.id));
      });
      const result = await executeImageProvider({ providerId: spec.id, baseUrl: spec.baseUrl, apiKey: 'secret', signal: AbortSignal.timeout(1000), fetchImpl,
        request: { model: model.id, prompt: 'draw', ...(editing ? { inputImages: inputs } : {}) } });
      expect(result.images[0]?.bytes).toEqual(png);
      expect(result.images[0]?.mimeType).toBe('image/png');
      const first = calls[0]!;
      if (spec.id === 'openai') {
        expect(first.url.endsWith(editing ? '/images/edits' : '/images/generations')).toBe(true);
        expect(editing ? (first.init!.body as FormData).has('response_format') : JSON.parse(String(first.init?.body)).response_format).toBeFalsy();
      }
      if (spec.id === 'google') {
        expect(first.url).toMatch(/\/v1beta\/interactions$/);
        expect(JSON.parse(String(first.init?.body))).toMatchObject({ store: false, response_format: { type: 'image' } });
      }
      if (spec.id === 'ideogram') expect(first.url).toContain(editing ? '/precise-edit/ideogram-4-5' : '/generate/ideogram-4-5');
      if (editing && ['dashscope', 'seedream', 'tokenhub'].includes(spec.id)) expect(String(first.init?.body)).toContain('data:image/png;base64,');
    });
  }
});

describe('strict image execution', () => {
  const spec = getImageProviderSpec('openai');
  const base = { providerId: spec.id, baseUrl: spec.baseUrl, apiKey: 'secret', signal: AbortSignal.timeout(1000) };
  it('rejects retired models and unsupported options before network access', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    for (const request of [{ model: 'dall-e-3', prompt: 'p' }, { model: spec.models[0]!.id, prompt: 'p', count: 99 }, { model: spec.models[0]!.id, prompt: 'p', size: '1000x1000' }]) {
      await expect(executeImageProvider({ ...base, request, fetchImpl })).rejects.toThrow(/Unsupported/);
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('validates generation and edit geometry independently', () => {
    const caps = getImageProviderSpec('dashscope').models.find(m => m.id === 'wan2.7-image-pro')!.capabilities;
    expect(() => validateImageRequest({ model: 'm', prompt: 'p', size: '4K' }, caps)).not.toThrow();
    expect(() => validateImageRequest({ model: 'm', prompt: 'p', size: '4K', inputImages: inputs }, caps)).toThrow(/size/);
  });
  it('rejects MIME spoofing, malformed base64 and excess output', async () => {
    for (const data of [{ data: [{ b64_json: 'aGVsbG8=' }] }, { data: [{ b64_json: '!!!' }] }, { data: [{ b64_json: b64 }, { b64_json: b64 }] }]) {
      await expect(executeImageProvider({ ...base, request: { model: spec.models[0]!.id, prompt: 'p' }, fetchImpl: async () => Response.json(data) })).rejects.toThrow();
    }
  });
  it('uses the documented stable TokenHub base64 and URL contract', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (url, init) => {
      if (String(url).startsWith('https://cdn.test')) return new Response(png);
      expect(String(url)).toContain('/v3-generation');
      expect(JSON.parse(String(init?.body))).toMatchObject({ images: [b64] });
      return Response.json({ data: [{ url: 'https://cdn.test/image.png' }], request_id: 'id', tokenhub_usage: { total_tokens: 1024 } });
    });
    const result = await executeImageProvider({ providerId: 'tokenhub', baseUrl: 'https://tokenhub.tencentmaas.com', apiKey: 'key', signal: AbortSignal.timeout(1000), fetchImpl,
      request: { model: 'hy-image-v3', prompt: 'p', inputImages: inputs } });
    expect(result).toMatchObject({ requestId: 'id', usage: { total_tokens: 1024 }, images: [{ mimeType: 'image/png' }] });
  });
  it('bounds streamed bytes without relying on Content-Length', async () => {
    const response = new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(12)); controller.close(); } }));
    await expect(readBytesLimited(response, 10)).rejects.toThrow(/byte limit/);
  });
  it('rejects credential forwarding to untrusted polling URLs', () => {
    expect(() => authenticatedJobUrl('https://evil.test/job', 'https://queue.fal.run')).toThrow(/Untrusted/);
    expect(() => authenticatedJobUrl('https://api.us.bfl.ai/job', 'https://custom.test', true)).toThrow(/Untrusted/);
    expect(authenticatedJobUrl('https://api.us.bfl.ai/job', 'https://api.bfl.ai/v1', true)).toContain('bfl.ai');
  });
  it('never retries a failure after an async job was accepted', async () => {
    let calls = 0;
    await expect(executeImageProvider({ providerId: 'bfl', baseUrl: 'https://api.bfl.ai/v1', apiKey: 'key', signal: AbortSignal.timeout(1000), request: { model: 'flux-2-pro', prompt: 'p' },
      fetchImpl: async () => ++calls === 1 ? Response.json({ polling_url: 'https://api.bfl.ai/poll' }) : new Response(null, { status: 429 }) })).rejects.toMatchObject({ retryable: false });
    expect(calls).toBe(2);
  });
});
