import { mkdtemp, mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetModelCatalogStore } from '../../../providers/model-catalog-store.js';
import { ConfigSchema } from '../../../config/schema.js';

const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_BASE64 = PNG_HEADER.toString('base64');

const generateImageMock = vi.fn();
const saveMediaBufferMock = vi.fn();

vi.mock('../../../media/store.js', () => ({
  MEDIA_MAX_BYTES: 5 * 1024 * 1024,
  mimeTypeFromMediaPath: () => 'image/png',
  saveMediaBuffer: (...args: unknown[]) => saveMediaBufferMock(...args),
}));

vi.mock('../../image/generation/runtime.js', () => ({
  generateImage: (...args: unknown[]) => generateImageMock(...args),
  listImageGenerationProvidersSummary: () => [
    { id: 'mock', defaultModel: 'mock-default', models: ['mock-default'] },
  ],
}));

vi.mock('../../image/generation/provider-registry.js', async (orig) => {
  const real = await orig<typeof import('../../image/generation/provider-registry.js')>();
  return {
    ...real,
    getImageGenerationProvider: () => ({
      id: 'mock',
      defaultModel: 'mock-default',
      models: ['mock-default'],
      isConfigured: () => true,
      async generateImage() {
        return { images: [{ buffer: Buffer.from(''), mimeType: 'image/png' }] };
      },
    }),
  };
});

import { createImageGenerateTool } from '../image-generate-tool.js';

let workspace: string;

beforeEach(async () => {
  resetModelCatalogStore();
  workspace = await mkdtemp(path.join(os.tmpdir(), 'xopc-img-tool-'));
  generateImageMock.mockReset();
  saveMediaBufferMock.mockReset();
  saveMediaBufferMock.mockResolvedValue({
    id: 'generated---id.png',
    bucket: 'outbound',
    contentType: 'image/png',
    path: '/state/media/outbound/generated---id.png',
    size: PNG_HEADER.length,
    uri: 'media://outbound/generated---id.png',
  });
});

afterEach(() => {
  resetModelCatalogStore();
  vi.clearAllMocks();
});

function makeTool(config?: any, agentId = 'studio') {
  const tool = createImageGenerateTool({ workspace, config, agentId });
  expect(tool).not.toBeNull();
  return tool!;
}

describe('image_generate tool — Step 2 input wiring', () => {
  it('uses explicitly configured image-generation model settings before auto provider defaults', async () => {
    generateImageMock.mockResolvedValueOnce({
      images: [{ buffer: PNG_HEADER, mimeType: 'image/png' }],
      provider: 'openai',
      model: 'gpt-image-2',
      attempts: [],
      ignoredOverrides: [],
    });
    const tool = makeTool(ConfigSchema.parse({
      agents: {
        default: 'main',
        defaults: {
          models: {
            chat: { primary: 'openai/gpt-4.1', fallbacks: [] },
            intents: {},
            imageGeneration: {
              primary: 'openai/gpt-image-2',
              fallbacks: ['google/gemini-3.1-flash-image'],
              timeoutMs: 120_000,
              autoProviderFallback: true,
            },
          },
        },
        list: [{ id: 'main', enabled: true }],
      },
    }));

    await tool.execute('tc-explicit', { prompt: 'sunset' } as any, {} as any, () => {});

    expect(generateImageMock).toHaveBeenCalledTimes(1);
    expect(generateImageMock.mock.calls[0]?.[0]).toMatchObject({
      agentId: 'studio',
      modelConfig: {
        primary: 'openai/gpt-image-2',
        fallbacks: ['google/gemini-3.1-flash-image'],
        timeoutMs: 120_000,
        autoProviderFallback: true,
      },
      timeoutMs: 120_000,
      autoProviderFallback: true,
    });
  });

  it('forwards new optional fields (aspectRatio/resolution/quality/outputFormat/background/providerOptions) to generateImage', async () => {
    generateImageMock.mockResolvedValueOnce({
      images: [{ buffer: PNG_HEADER, mimeType: 'image/png' }],
      provider: 'mock',
      model: 'mock-default',
      attempts: [],
      ignoredOverrides: [],
    });
    const tool = makeTool();
    const res = await tool.execute(
      'tc-1',
      {
        prompt: 'sunset',
        aspectRatio: '16:9',
        resolution: '2k',
        quality: 'High',
        outputFormat: 'JPEG',
        background: 'transparent',
        providerOptions: { openai: { moderation: 'low', user: 'u1', outputCompression: 90 } },
      } as any,
      {} as any,
      () => {},
    );

    expect(generateImageMock).toHaveBeenCalledTimes(1);
    const call = generateImageMock.mock.calls[0]?.[0];
    expect(call).toMatchObject({
      prompt: 'sunset',
      aspectRatio: '16:9',
      resolution: '2K',
      quality: 'high',
      outputFormat: 'jpeg',
      background: 'transparent',
      providerOptions: { openai: { moderation: 'low', user: 'u1', outputCompression: 90 } },
    });
    expect(res.details?.provider).toBe('mock');
    expect(res.details?.media).toEqual([
      expect.objectContaining({
        type: 'photo',
        uri: 'media://outbound/generated---id.png',
      }),
    ]);
    expect(res.details?.artifacts).toEqual([
      expect.objectContaining({
        kind: 'image',
        location: 'artifact_store',
        uri: 'media://outbound/generated---id.png',
      }),
    ]);
  });

  it('drops invalid enum values silently (lets provider apply defaults)', async () => {
    generateImageMock.mockResolvedValueOnce({
      images: [{ buffer: PNG_HEADER, mimeType: 'image/png' }],
      provider: 'mock',
      model: 'mock-default',
      attempts: [],
      ignoredOverrides: [],
    });
    const tool = makeTool();
    await tool.execute(
      'tc-2',
      { prompt: 'p', quality: 'ultra', outputFormat: 'tiff', resolution: '8K' } as any,
      {} as any,
      () => {},
    );
    const call = generateImageMock.mock.calls[0]?.[0];
    expect(call.quality).toBeUndefined();
    expect(call.outputFormat).toBeUndefined();
    expect(call.resolution).toBeUndefined();
  });

  it('loads inputImages from data URL and from a workspace-relative path', async () => {
    generateImageMock.mockResolvedValueOnce({
      images: [{ buffer: PNG_HEADER, mimeType: 'image/png' }],
      provider: 'mock',
      model: 'mock-default',
      attempts: [],
      ignoredOverrides: [],
    });
    const filePath = path.join(workspace, 'ref.png');
    await writeFile(filePath, PNG_HEADER);

    const tool = makeTool();
    await tool.execute(
      'tc-3',
      {
        prompt: 'edit',
        inputImages: [
          { source: `data:image/png;base64,${PNG_BASE64}` },
          { source: 'ref.png' },
        ],
      } as any,
      {} as any,
      () => {},
    );

    const call = generateImageMock.mock.calls[0]?.[0];
    expect(call.inputImages).toHaveLength(2);
    expect(call.inputImages[0].mimeType).toBe('image/png');
    expect(call.inputImages[1].fileName).toBe('ref.png');
  });

  it('rejects path traversal and remote URLs in inputImages', async () => {
    const tool = makeTool();
    const traversal = await tool.execute(
      'tc-4',
      { prompt: 'p', inputImages: [{ source: '../escape.png' }] } as any,
      {} as any,
      () => {},
    );
    expect(traversal.details?.error).toBe('invalid_input_images');

    const remote = await tool.execute(
      'tc-5',
      { prompt: 'p', inputImages: [{ source: 'https://example.com/x.png' }] } as any,
      {} as any,
      () => {},
    );
    expect(remote.details?.error).toBe('invalid_input_images');
    expect(generateImageMock).not.toHaveBeenCalled();
  });

  it('writes images under workspace/media/generated and surfaces normalization notes', async () => {
    generateImageMock.mockResolvedValueOnce({
      images: [{ buffer: PNG_HEADER, mimeType: 'image/jpeg', fileName: 'a.jpg' }],
      provider: 'mock',
      model: 'mock-default',
      attempts: [],
      normalization: {
        size: { requested: '1000x1000', applied: '1024x1024' },
        aspectRatio: { applied: '16:9', derivedFrom: 'size' },
      },
      ignoredOverrides: [{ key: 'background', value: 'transparent' }],
    });
    const tool = makeTool();
    const res = await tool.execute(
      'tc-6',
      { prompt: 'p', size: '1000x1000', background: 'transparent' } as any,
      {} as any,
      () => {},
    );

    expect(res.details?.normalization).toBeDefined();
    expect(res.details?.ignoredOverrides).toEqual([{ key: 'background', value: 'transparent' }]);
    const text = res.content[0]?.text ?? '';
    expect(text).toMatch(/Note: requested size="1000x1000"/);
    expect(text).toMatch(/Note: aspectRatio="16:9" derived from size/);
    expect(text).toMatch(/Note: ignored background="transparent"/);

    const dir = path.join(workspace, 'media', 'generated');
    await mkdir(dir, { recursive: true });
    const files = await readdir(dir);
    expect(files.some((f) => f.endsWith('.jpg'))).toBe(true);
  });

  it('returns FailoverError details when generateImage throws FailoverError', async () => {
    const { FailoverError } = await import('../../failover-error.js');
    generateImageMock.mockImplementationOnce(() => {
      throw new FailoverError({
        message: 'all failed',
        attempts: [
          { provider: 'mock', model: 'mock-default', error: 'boom', reason: 'http_5xx', status: 503 },
        ],
        provider: 'mock',
        model: 'mock-default',
      });
    });
    const tool = makeTool();
    const res = await tool.execute(
      'tc-7',
      { prompt: 'p' } as any,
      {} as any,
      () => {},
    );
    expect(res.details?.error).toBe('generation_failed');
    expect(res.details?.attempts).toHaveLength(1);
    expect((res.details as any).status).toBe(503);
    expect((res.details as any).reason).toBe('http_5xx');
  });
});
