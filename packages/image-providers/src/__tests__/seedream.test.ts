import { describe, expect, it, vi } from 'vitest';
import { executeImageProvider, getImageProviderSpec } from '../index.js';
import { decodeBase64 } from '../http.js';

const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jJYQAAAAASUVORK5CYII=';
const spec = getImageProviderSpec('seedream');
const model = spec.models[0]!;
const base = { providerId: spec.id, baseUrl: spec.baseUrl, apiKey: 'test', signal: AbortSignal.timeout(1000) };
const response = () => Response.json({ data: [{ b64_json: b64 }] });

describe('Seedream Flash geometry compatibility', () => {
  it.each(model.capabilities.geometry!.aspectRatios!.flatMap(aspectRatio =>
    (['1K', '2K'] as const).map(resolution => ({ aspectRatio, resolution }))))('maps $aspectRatio at $resolution to valid exact-ratio pixels', async ({ aspectRatio, resolution }) => {
    const fetchImpl = vi.fn<typeof fetch>(async (url, init) => {
      expect(String(url)).toBe(`${spec.baseUrl}/images/generations`);
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer test');
      const body = JSON.parse(String(init?.body));
      const [w, h] = body.size.split('x').map(Number);
      const [a, b] = aspectRatio.split(':').map(Number);
      expect(w * b!).toBe(h * a!);
      expect(w * h).toBeGreaterThanOrEqual(921600);
      expect(w * h).toBeLessThanOrEqual(4624220);
      expect(Math.max(w / h, h / w)).toBeLessThanOrEqual(16);
      expect(body).toMatchObject({ prompt: 'draw', response_format: 'b64_json', watermark: false });
      expect(body.aspectRatio).toBeUndefined();
      return response();
    });
    const request = { model: model.id, prompt: 'draw', count: 1, aspectRatio, resolution };
    expect((await executeImageProvider({ ...base, request, fetchImpl })).images).toHaveLength(1);
    expect(request.aspectRatio).toBe(aspectRatio);
  });

  it.each([
    [{}, '2K'], [{ aspectRatio: '16:9' }, '2720x1530'],
    [{ resolution: '1K' }, '1K'], [{ size: '1.5K' }, '1.5K'],
    [{ size: '2048x1024' }, '2048x1024'],
  ] as const)('uses explicit sizes or the 2K default: %j', async (options, expected) => {
    const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
      expect(JSON.parse(String(init?.body)).size).toBe(expected);
      return response();
    });
    await executeImageProvider({ ...base, request: { model: model.id, prompt: 'draw', ...options }, fetchImpl });
  });

  it('rejects unsupported geometry and options before submitting', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    for (const options of [
      { resolution: '4K' as const }, { size: '4K' }, { size: '512x512' },
      { size: '4096x4096' }, { size: '16:9' }, { aspectRatio: '100:1' },
      { size: '2K', aspectRatio: '16:9' }, { size: '2K', resolution: '2K' as const },
      { count: 2 }, { background: 'transparent' as const },
    ]) {
      await expect(executeImageProvider({ ...base, request: { model: model.id, prompt: 'draw', ...options }, fetchImpl })).rejects.toThrow();
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('uses the same geometry for reference-image requests and forwards format', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
      expect(JSON.parse(String(init?.body))).toMatchObject({ size: '1530x2720', output_format: 'jpeg', image: `data:image/png;base64,${b64}` });
      return response();
    });
    await executeImageProvider({ ...base, request: { model: model.id, prompt: 'edit', aspectRatio: '9:16', outputFormat: 'jpeg',
      inputImages: [{ blob: new Blob([Uint8Array.from(atob(b64), c => c.charCodeAt(0))], { type: 'image/png' }), fileName: 'ref.png' }] }, fetchImpl });
  });
});

// Real 2K PNGs are much larger than the tiny protocol fixtures above.
describe('large generated-image base64', () => {
  it.each([4, 8])('decodes %i MiB without a regex stack overflow', megabytes => {
    const bytes = new Uint8Array(megabytes * 1024 * 1024).fill(123);
    const base64 = Buffer.from(bytes).toString('base64');
    const decoded = decodeBase64(base64);
    expect(decoded.byteLength).toBe(bytes.byteLength);
    expect(decoded[0]).toBe(123);
    expect(decoded[decoded.length - 1]).toBe(123);
  });
  it.each(['a', 'aaa', 'a===', '====', 'ab=c', 'a a=', '!!!!'])('rejects malformed base64 %s', value => {
    expect(() => decodeBase64(value)).toThrow('Invalid image base64');
  });
});
