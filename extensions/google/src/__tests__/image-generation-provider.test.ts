import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  buildGoogleImageGenerationProvider,
  GOOGLE_DEFAULT_IMAGE_MODEL,
  resolveGoogleBaseUrl,
} from '../image-generation-provider.js';
import type { ImageGenerationRequest } from '@xopcai/xopc/agent/image/generation/types.js';

let savedBaseUrl: string | undefined;
let savedAltBaseUrl: string | undefined;
let savedApiVersion: string | undefined;

beforeEach(() => {
  savedBaseUrl = process.env.GEMINI_BASE_URL;
  savedAltBaseUrl = process.env.GOOGLE_GENERATIVE_AI_BASE_URL;
  savedApiVersion = process.env.GEMINI_API_VERSION;
  delete process.env.GEMINI_BASE_URL;
  delete process.env.GOOGLE_GENERATIVE_AI_BASE_URL;
  delete process.env.GEMINI_API_VERSION;
});

afterEach(() => {
  if (savedBaseUrl !== undefined) {
    process.env.GEMINI_BASE_URL = savedBaseUrl;
  } else {
    delete process.env.GEMINI_BASE_URL;
  }
  if (savedAltBaseUrl !== undefined) {
    process.env.GOOGLE_GENERATIVE_AI_BASE_URL = savedAltBaseUrl;
  } else {
    delete process.env.GOOGLE_GENERATIVE_AI_BASE_URL;
  }
  if (savedApiVersion !== undefined) {
    process.env.GEMINI_API_VERSION = savedApiVersion;
  } else {
    delete process.env.GEMINI_API_VERSION;
  }
});

function makeReq(overrides: Partial<ImageGenerationRequest> = {}): ImageGenerationRequest {
  return {
    provider: 'google',
    model: GOOGLE_DEFAULT_IMAGE_MODEL,
    prompt: 'a cat',
    ...overrides,
  } as ImageGenerationRequest;
}

describe('resolveGoogleBaseUrl', () => {
  it('defaults to generativelanguage.googleapis.com', () => {
    expect(resolveGoogleBaseUrl(makeReq())).toBe('https://generativelanguage.googleapis.com');
  });

  it('honours GEMINI_BASE_URL env', () => {
    process.env.GEMINI_BASE_URL = 'https://example.com/api/';
    expect(resolveGoogleBaseUrl(makeReq())).toBe('https://example.com/api');
  });

  it('honours GOOGLE_GENERATIVE_AI_BASE_URL env', () => {
    process.env.GOOGLE_GENERATIVE_AI_BASE_URL = 'https://alt.example.com/v1beta';
    expect(resolveGoogleBaseUrl(makeReq())).toBe('https://alt.example.com/v1beta');
  });

  it('cfg.providers.google.baseUrl wins over env', () => {
    process.env.GEMINI_BASE_URL = 'https://env.example.com';
    const req = makeReq({
      cfg: { providers: { google: { baseUrl: 'https://cfg.example.com/' } } } as any,
    });
    expect(resolveGoogleBaseUrl(req)).toBe('https://cfg.example.com');
  });
});

describe('buildGoogleImageGenerationProvider', () => {
  it('exposes id, label, default model, and generate/edit capabilities', () => {
    const p = buildGoogleImageGenerationProvider();
    expect(p.id).toBe('google');
    expect(p.aliases).toContain('gemini');
    expect(p.label).toBe('Google Gemini');
    expect(p.defaultModel).toBe(GOOGLE_DEFAULT_IMAGE_MODEL);
    expect(p.models?.length ?? 0).toBeGreaterThan(0);
    expect(p.capabilities?.generate?.supportsAspectRatio).toBe(true);
    expect(p.capabilities?.edit?.enabled).toBe(true);
    expect(p.capabilities?.edit?.maxInputImages).toBeGreaterThanOrEqual(1);
    expect(typeof p.generateImage).toBe('function');
  });
});
