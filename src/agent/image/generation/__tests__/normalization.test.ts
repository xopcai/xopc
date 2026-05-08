import { describe, expect, it } from 'vitest';

import { resolveImageGenerationOverrides } from '../normalization.js';
import type {
  ImageGenerationProvider,
  ImageGenerationProviderCapabilities,
} from '../types.js';

function makeProvider(capabilities: ImageGenerationProviderCapabilities): ImageGenerationProvider {
  return {
    id: 'mock',
    capabilities,
    async generateImage() {
      return { images: [{ buffer: Buffer.from(''), mimeType: 'image/png' }] };
    },
  };
}

describe('resolveImageGenerationOverrides — geometry decision table', () => {
  it('forwards size when provider supports size and no list constrains it', () => {
    const provider = makeProvider({ generate: { supportsSize: true } });
    const out = resolveImageGenerationOverrides({ provider, size: '999x999' });
    expect(out.size).toBe('999x999');
    expect(out.aspectRatio).toBeUndefined();
    expect(out.normalization).toBeUndefined();
    expect(out.ignoredOverrides).toEqual([]);
  });

  it('snaps requested size to closest supported value and records normalization', () => {
    const provider = makeProvider({
      generate: { supportsSize: true },
      geometry: { sizes: ['1024x1024', '1024x1536', '1536x1024'] },
    });
    const out = resolveImageGenerationOverrides({ provider, size: '1000x1000' });
    expect(out.size).toBe('1024x1024');
    expect(out.normalization?.size?.requested).toBe('1000x1000');
    expect(out.normalization?.size?.applied).toBe('1024x1024');
    expect(out.normalization?.size?.supportedValues).toEqual(['1024x1024', '1024x1536', '1536x1024']);
  });

  it('derives aspectRatio from a requested size when provider only supports aspectRatio', () => {
    const provider = makeProvider({
      generate: { supportsAspectRatio: true },
      geometry: { aspectRatios: ['1:1', '16:9', '9:16'] },
    });
    const out = resolveImageGenerationOverrides({ provider, size: '1920x1080' });
    expect(out.size).toBeUndefined();
    expect(out.aspectRatio).toBe('16:9');
    expect(out.normalization?.aspectRatio?.derivedFrom).toBe('size');
    expect(out.normalization?.aspectRatio?.applied).toBe('16:9');
  });

  it('drops size when provider supports neither size nor aspectRatio', () => {
    const provider = makeProvider({ generate: {} });
    const out = resolveImageGenerationOverrides({ provider, size: '512x512' });
    expect(out.size).toBeUndefined();
    expect(out.aspectRatio).toBeUndefined();
    expect(out.ignoredOverrides).toContainEqual({ key: 'size', value: '512x512' });
  });

  it('snaps requested aspectRatio to closest supported value', () => {
    const provider = makeProvider({
      generate: { supportsAspectRatio: true },
      geometry: { aspectRatios: ['1:1', '16:9'] },
    });
    const out = resolveImageGenerationOverrides({ provider, aspectRatio: '4:3' });
    expect(out.aspectRatio).toBe('1:1');
    expect(out.normalization?.aspectRatio?.requested).toBe('4:3');
    expect(out.normalization?.aspectRatio?.applied).toBe('1:1');
  });

  it('derives size from aspectRatio when provider only supports size', () => {
    const provider = makeProvider({
      generate: { supportsSize: true },
      geometry: { sizes: ['1024x1024', '1280x720', '720x1280'] },
    });
    const out = resolveImageGenerationOverrides({ provider, aspectRatio: '16:9' });
    expect(out.size).toBe('1280x720');
    expect(out.normalization?.size?.derivedFrom).toBe('aspectRatio');
  });

  it('honours resolution when supported and snaps to closest enum', () => {
    const provider = makeProvider({
      generate: { supportsResolution: true },
      geometry: { resolutions: ['1K', '2K'] },
    });
    const out = resolveImageGenerationOverrides({ provider, resolution: '4K' });
    expect(out.resolution).toBe('2K');
    expect(out.normalization?.resolution?.requested).toBe('4K');
    expect(out.normalization?.resolution?.applied).toBe('2K');
  });

  it('drops resolution when provider does not support it', () => {
    const provider = makeProvider({ generate: {} });
    const out = resolveImageGenerationOverrides({ provider, resolution: '2K' });
    expect(out.resolution).toBeUndefined();
    expect(out.ignoredOverrides).toContainEqual({ key: 'resolution', value: '2K' });
  });

  it('forwards quality / outputFormat / background when no constraint is declared', () => {
    const provider = makeProvider({ generate: {} });
    const out = resolveImageGenerationOverrides({
      provider,
      quality: 'high',
      outputFormat: 'jpeg',
      background: 'transparent',
    });
    expect(out.quality).toBe('high');
    expect(out.outputFormat).toBe('jpeg');
    expect(out.background).toBe('transparent');
    expect(out.ignoredOverrides).toEqual([]);
  });

  it('drops unsupported quality / format / background and records them', () => {
    const provider = makeProvider({
      generate: {},
      output: {
        qualities: ['low', 'medium'],
        formats: ['png'],
        backgrounds: ['opaque'],
      },
    });
    const out = resolveImageGenerationOverrides({
      provider,
      quality: 'high',
      outputFormat: 'webp',
      background: 'transparent',
    });
    expect(out.quality).toBeUndefined();
    expect(out.outputFormat).toBeUndefined();
    expect(out.background).toBeUndefined();
    expect(out.ignoredOverrides).toEqual(
      expect.arrayContaining([
        { key: 'quality', value: 'high' },
        { key: 'outputFormat', value: 'webp' },
        { key: 'background', value: 'transparent' },
      ]),
    );
  });

  it('throws when caller requests edit but provider does not support it', () => {
    const provider = makeProvider({ generate: {} });
    expect(() =>
      resolveImageGenerationOverrides({
        provider,
        inputImages: [{ buffer: Buffer.from(''), mimeType: 'image/png' }],
      }),
    ).toThrow(/editing is not supported/);
  });

  it('throws when input image count exceeds provider maxInputImages', () => {
    const provider = makeProvider({
      generate: {},
      edit: { enabled: true, maxInputImages: 1 },
    });
    expect(() =>
      resolveImageGenerationOverrides({
        provider,
        inputImages: [
          { buffer: Buffer.from(''), mimeType: 'image/png' },
          { buffer: Buffer.from(''), mimeType: 'image/png' },
        ],
      }),
    ).toThrow(/at most 1/);
  });

  it('uses edit-mode caps for size when running edit', () => {
    const provider = makeProvider({
      generate: { supportsSize: false },
      edit: { enabled: true, maxInputImages: 1, supportsSize: true },
      geometry: { sizes: ['1024x1024'] },
    });
    const out = resolveImageGenerationOverrides({
      provider,
      size: '1000x1000',
      inputImages: [{ buffer: Buffer.from(''), mimeType: 'image/png' }],
    });
    expect(out.size).toBe('1024x1024');
  });
});
