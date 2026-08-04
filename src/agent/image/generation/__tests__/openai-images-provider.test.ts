import { afterEach, describe, expect, it, vi } from 'vitest';

import * as providerHttp from '../../../../media-shared/http/index.js';
import { createOpenAiImagesProvider } from '../openai-images-provider.js';
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

interface MockPostCall {
  url: string;
  options: providerHttp.PostJsonRequestOptions | providerHttp.PostMultipartRequestOptions;
}

function makeJsonResponse(payload: unknown, init: ResponseInit = { status: 200 }): Response {
  return new Response(JSON.stringify(payload), {
    ...init,
    headers: { 'content-type': 'application/json' },
  });
}

function buildProvider(
  overrides?: Partial<Parameters<typeof createOpenAiImagesProvider>[0]>,
): ImageGenerationProvider {
  return createOpenAiImagesProvider({
    id: 'mock',
    label: 'Mock',
    defaultModel: 'mock-model',
    models: ['mock-model'],
    capabilities: baseCaps,
    isConfigured: () => true,
    resolveApiKey: () => 'sk-test',
    resolveEndpoint: () => ({ baseUrl: 'https://example.com/v1' }),
    defaultTimeoutMs: 5_000,
    ...overrides,
  });
}

function stubPostJson(
  calls: MockPostCall[],
  payload: unknown = { data: [{ b64_json: PNG_BASE64, revised_prompt: 'rewritten' }] },
): ReturnType<typeof vi.spyOn<typeof providerHttp, 'postJsonRequest'>> {
  return vi.spyOn(providerHttp, 'postJsonRequest').mockImplementation(async (url, options) => {
    calls.push({ url: String(url), options });
    return makeJsonResponse(payload);
  });
}

function stubPostMultipart(
  calls: MockPostCall[],
  payload: unknown = { data: [{ b64_json: PNG_BASE64 }] },
): ReturnType<typeof vi.spyOn<typeof providerHttp, 'postMultipartRequest'>> {
  return vi.spyOn(providerHttp, 'postMultipartRequest').mockImplementation(async (url, options) => {
    calls.push({ url: String(url), options });
    return makeJsonResponse(payload);
  });
}

function headersRecord(headers: Record<string, string> | Headers | undefined): Record<string, string> {
  if (!headers) return {};
  if (headers instanceof Headers) {
    const out: Record<string, string> = {};
    headers.forEach((value, key) => {
      out[key.toLowerCase()] = value;
    });
    return out;
  }
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    out[key.toLowerCase()] = value;
  }
  return out;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createOpenAiImagesProvider', () => {
  it('issues a JSON POST to /images/generations with bearer auth and decodes b64_json', async () => {
    const calls: MockPostCall[] = [];
    stubPostJson(calls);

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
    expect(calls[0]?.url).toBe('https://example.com/v1/images/generations');
    const headers = headersRecord((calls[0]?.options as providerHttp.PostJsonRequestOptions).headers);
    expect(headers['authorization']).toBe('Bearer sk-test');
    const body = (calls[0]?.options as providerHttp.PostJsonRequestOptions).body as Record<string, unknown>;
    expect(body).toMatchObject({ model: 'mock-model', prompt: 'a cat', n: 1, size: '1024x1024' });
  });

  it('routes to /images/edits with multipart when inputImages present', async () => {
    const calls: MockPostCall[] = [];
    stubPostMultipart(calls);

    const provider = buildProvider();
    await provider.generateImage({
      provider: 'mock',
      model: 'mock-model',
      prompt: 'edit me',
      count: 1,
      size: '1024x1024',
      inputImages: [{ buffer: PNG_HEADER, mimeType: 'image/png', fileName: 'in.png' }],
    } as ImageGenerationRequest);

    expect(calls[0]?.url).toBe('https://example.com/v1/images/edits');
    const options = calls[0]?.options as providerHttp.PostMultipartRequestOptions;
    expect(options.body).toBeInstanceOf(FormData);
    const headers = headersRecord(options.headers);
    // multipart helper strips content-type so the runtime sets the boundary.
    expect(headers['content-type']).toBeUndefined();
    expect(headers['authorization']).toBe('Bearer sk-test');
  });

  it('honours custom Authorization scheme + extra headers from resolveEndpoint', async () => {
    const calls: MockPostCall[] = [];
    stubPostJson(calls);

    const provider = buildProvider({
      resolveEndpoint: () => ({
        baseUrl: 'https://example.com/openai',
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

    expect(calls[0]?.url).toBe('https://example.com/openai/images/generations:submit');
    const headers = headersRecord((calls[0]?.options as providerHttp.PostJsonRequestOptions).headers);
    expect(headers['api-key']).toBe('sk-test');
    expect(headers['authorization']).toBeUndefined();
    expect(headers['x-custom']).toBe('yes');
  });

  it('passes an explicit private-host allowlist to the HTTP guard', async () => {
    const calls: MockPostCall[] = [];
    stubPostJson(calls);
    const provider = buildProvider({
      resolveEndpoint: () => ({
        baseUrl: 'http://image-server.lan/v1',
        privateNetworkPolicy: { allowHosts: ['image-server.lan'] },
      }),
    });

    await provider.generateImage({
      provider: 'mock',
      model: 'mock-model',
      prompt: 'p',
    } as ImageGenerationRequest);

    expect(calls[0]?.options).toMatchObject({ hostnameAllowlist: ['image-server.lan'] });
  });

  it('forwards quality / outputFormat / background / providerOptions via applyOpenAiOptions', async () => {
    const calls: MockPostCall[] = [];
    stubPostJson(calls);

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

    const body = (calls[0]?.options as providerHttp.PostJsonRequestOptions).body as Record<string, unknown>;
    expect(body.quality).toBe('high');
    expect(body.output_format).toBe('jpeg');
    expect(body.background).toBe('transparent');
    expect(body.moderation).toBe('low');
    expect(body.output_compression).toBe(80);
    expect(body.user).toBe('user-1');
  });

  it('clamps count between 1 and capability maxCount', async () => {
    const calls: MockPostCall[] = [];
    const postJson = stubPostJson(calls);

    const provider = buildProvider();
    await provider.generateImage({
      provider: 'mock',
      model: 'mock-model',
      prompt: 'p',
      count: 999,
    } as ImageGenerationRequest);
    expect((calls[0]?.options as providerHttp.PostJsonRequestOptions).body).toMatchObject({ n: 4 });

    await provider.generateImage({
      provider: 'mock',
      model: 'mock-model',
      prompt: 'p',
      count: 0,
    } as ImageGenerationRequest);
    expect((calls[1]?.options as providerHttp.PostJsonRequestOptions).body).toMatchObject({ n: 1 });
    expect(postJson).toHaveBeenCalledTimes(2);
  });

  it('throws when provider returns no decodable images', async () => {
    stubPostJson([], { data: [{ b64_json: '' }] });
    const provider = buildProvider();
    await expect(
      provider.generateImage({
        provider: 'mock',
        model: 'mock-model',
        prompt: 'p',
      } as ImageGenerationRequest),
    ).rejects.toThrow(/no images/);
  });

  it('reports a clear error when an API key contains non-ByteString characters', async () => {
    const provider = buildProvider({ resolveApiKey: () => 'sk-valid→invalid' });
    await expect(
      provider.generateImage({
        provider: 'mock',
        model: 'mock-model',
        prompt: 'p',
      } as ImageGenerationRequest),
    ).rejects.toThrow('API key contains characters that cannot be sent in an HTTP header');
  });
});
