import { describe, expect, it } from 'vitest';
import { buildNativeImageProvider } from '../native-provider.js';
import { validateImageGenerationRequest } from '../validation.js';

describe('strict image overrides', () => {
  const provider = buildNativeImageProvider('openai');
  it('passes supported options unchanged', () => {
    expect(() => validateImageGenerationRequest({ provider, size: '1024x1024', quality: 'max' })).not.toThrow();
  });
  it('rejects unsupported sizes instead of snapping them', () => {
    expect(() => validateImageGenerationRequest({ provider, size: '1000x1000' })).toThrow(/Unsupported image size/);
  });
  it('rejects unsupported options instead of dropping them', () => {
    expect(() => validateImageGenerationRequest({ provider: buildNativeImageProvider('minimax'), size: '1920x1080' })).toThrow(/size/);
    expect(() => validateImageGenerationRequest({ provider: buildNativeImageProvider('google'), quality: 'high' })).toThrow(/quality/);
  });
});
