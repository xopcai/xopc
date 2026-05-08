import { afterEach, describe, expect, it, vi } from 'vitest';

import { createOpenAiCompatibleImageProvider } from '../openai-compatible-image-provider.js';
import type {
  ImageGenerationProvider,
  ImageGenerationProviderCapabilities,
  ImageGenerationRequest,
} from '../types.js';

const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_BASE64 = PNG_HEADER.toString('base64');

const baseCaps: ImageGenerationProviderCapabilities = {
  generate: { maxCount: 4, supportsSize: true },
  edit: { enabled: true, maxInputImages: 1, supportsSize: true },
  geometry: { sizes: ['1024x1024'] },
  output: {
    qualities: ['low', 'medium', 'high', 'auto'],
    formats: ['png', 'jpeg'],
    backgrounds: ['transparent', 'opaque', 'auto'],
  },
};

interface MockFetchCall {
  url: string;
  init: RequestInit;
}

function makeJsonResponse(payload: unknown, init: ResponseInit = { status: 200 }): Response {
  return new Response(JSON.stringify(payload), {
    ...init,
    headers: { 'content-type': 'application/json' },
  });
}

function buildProvider(overrides?: Partial<Parameters<typeof createOpenAiCompatibleImageProvider>[0]>): ImageGenerationProvider {
  return createOpenAiCompatibleImageProvider({
    id: 'mock',
    label: 'Mock',
    defaultModel: 'mock-model',
    models: ['mock-model'],
    capabilities: baseCaps,
    isConfigured: () => true,
    resolveApiKey: () => 'sk-test',
    resolveEndpoint: () => ({ baseUrl: 'https://api.example.com/v1' }),
    defaultTimeoutMs: 5_000,
    ...overrides,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createOpenAiCompatibleImageProvider', () => {
  it('issues a JSON POST to /images/generations with bearer auth and decodes b64_json', async () => {
    const calls: MockFetchCall[] = [];
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return makeJsonResponse({ data: [{ b64_json: PNG_BASE64, revised_prompt: 'rewritten' }] });
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = buildProvider();
    const result = await provider.generateImage({
      provider: 'mock',
      model: 'mock-model',
      prompt: 'a cat',
      count: 1,
      size: '1024x1024',
    } as ImageGenerationRequest);

    expect(result.images).toHaveLength(1);
    expect(result.images[0]?.buffer.equals(PNG_HEADER)).toBe(true);
    expect(result.images[0]?.revisedPrompt).toBe('rewritten');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://api.example.com/v1/images/generations');
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers['authorization']).toBe('Bearer sk-test');
    expect(headers['content-type']).toBe('application/json');
    const body = JSON.parse(String(calls[0]?.init.body));
    expect(body).toMatchObject({ model: 'mock-model', prompt: 'a cat', n: 1, size: '1024x1024' });
  });

  it('routes to /images/edits with multipart when inputImages present', async () => {
    const calls: MockFetchCall[] = [];
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return makeJsonResponse({ data: [{ b64_json: PNG_BASE64 }] });
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = buildProvider();
    await provider.generateImage({
      provider: 'mock',
      model: 'mock-model',
      prompt: 'edit me',
      count: 1,
      size: '1024x1024',
      inputImages: [{ buffer: PNG_HEADER, mimeType: 'image/png', fileName: 'in.png' }],
    } as ImageGenerationRequest);

    expect(calls[0]?.url).toBe('https://api.example.com/v1/images/edits');
    expect(calls[0]?.init.body).toBeInstanceOf(FormData);
    const headers = calls[0]?.init.headers as Record<string, string>;
    // multipart helper strips content-type so the runtime sets the boundary.
    expect(headers['content-type']).toBeUndefined();
    expect(headers['authorization']).toBe('Bearer sk-test');
  });

  it('honours custom Authorization scheme + extra headers from resolveEndpoint', async () => {
    const calls: MockFetchCall[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return makeJsonResponse({ data: [{ b64_json: PNG_BASE64 }] });
      }),
    );

    const provider = buildProvider({
      resolveEndpoint: () => ({
        baseUrl: 'https://azure.example.com/openai',
        generationsPath: '/images/generations:submit',
        headers: { 'x-custom': 'yes' },
        authorization: { kind: 'header', headerName: 'api-key' },
      }),
    });

    await provider.generateImage({
      provider: 'mock',
      model: 'mock-model',
      prompt: 'p',
    } as ImageGenerationRequest);

    expect(calls[0]?.url).toBe('https://azure.example.com/openai/images/generations:submit');
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers['api-key']).toBe('sk-test');
    expect(headers['authorization']).toBeUndefined();
    expect(headers['x-custom']).toBe('yes');
  });

  it('forwards quality / outputFormat / background / providerOptions via applyOpenAiOptions', async () => {
    const calls: MockFetchCall[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return makeJsonResponse({ data: [{ b64_json: PNG_BASE64 }] });
      }),
    );

    const provider = buildProvider();
    await provider.generateImage({
      provider: 'mock',
      model: 'mock-model',
      prompt: 'p',
      quality: 'high',
      outputFormat: 'jpeg',
      background: 'transparent',
      providerOptions: { openai: { moderation: 'low', outputCompression: 80, user: 'user-1' } },
    } as ImageGenerationRequest);

    const body = JSON.parse(String(calls[0]?.init.body));
    expect(body.quality).toBe('high');
    expect(body.output_format).toBe('jpeg');
    expect(body.background).toBe('transparent');
    expect(body.moderation).toBe('low');
    expect(body.output_compression).toBe(80);
    expect(body.user).toBe('user-1');
  });

  it('clamps count between 1 and capability maxCount', async () => {
    const calls: MockFetchCall[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return makeJsonResponse({ data: [{ b64_json: PNG_BASE64 }] });
      }),
    );

    const provider = buildProvider();
    await provider.generateImage({
      provider: 'mock',
      model: 'mock-model',
      prompt: 'p',
      count: 999,
    } as ImageGenerationRequest);
    expect(JSON.parse(String(calls[0]?.init.body)).n).toBe(4);

    await provider.generateImage({
      provider: 'mock',
      model: 'mock-model',
      prompt: 'p',
      count: 0,
    } as ImageGenerationRequest);
    expect(JSON.parse(String(calls[1]?.init.body)).n).toBe(1);
  });

  it('throws when provider returns no decodable images', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => makeJsonResponse({ data: [{ b64_json: '' }] })));
    const provider = buildProvider();
    await expect(
      provider.generateImage({
        provider: 'mock',
        model: 'mock-model',
        prompt: 'p',
      } as ImageGenerationRequest),
    ).rejects.toThrow(/no images/);
  });

  it('uses buildGenerateRequestBody hook to mutate payload', async () => {
    const calls: MockFetchCall[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return makeJsonResponse({ data: [{ b64_json: PNG_BASE64 }] });
      }),
    );
    const provider = buildProvider({
      buildGenerateRequestBody: (_req, base) => ({ ...base, watermark: false }),
    });
    await provider.generateImage({
      provider: 'mock',
      model: 'mock-model',
      prompt: 'p',
    } as ImageGenerationRequest);
    expect(JSON.parse(String(calls[0]?.init.body)).watermark).toBe(false);
  });
});
