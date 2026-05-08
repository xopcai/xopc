import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  buildFalImageGenerationProvider,
  FAL_DEFAULT_IMAGE_MODEL,
  resolveFalBaseUrl,
} from '../image-generation-provider.js';
import type { ImageGenerationRequest } from '@xopcai/xopc/agent/image/generation/types.js';

let savedBaseUrl: string | undefined;
let savedQueueBaseUrl: string | undefined;

beforeEach(() => {
  savedBaseUrl = process.env.FAL_BASE_URL;
  savedQueueBaseUrl = process.env.FAL_QUEUE_BASE_URL;
  delete process.env.FAL_BASE_URL;
  delete process.env.FAL_QUEUE_BASE_URL;
});

afterEach(() => {
  if (savedBaseUrl !== undefined) {
    process.env.FAL_BASE_URL = savedBaseUrl;
  } else {
    delete process.env.FAL_BASE_URL;
  }
  if (savedQueueBaseUrl !== undefined) {
    process.env.FAL_QUEUE_BASE_URL = savedQueueBaseUrl;
  } else {
    delete process.env.FAL_QUEUE_BASE_URL;
  }
});

function makeReq(overrides: Partial<ImageGenerationRequest> = {}): ImageGenerationRequest {
  return {
    provider: 'fal',
    model: FAL_DEFAULT_IMAGE_MODEL,
    prompt: 'a sunset',
    ...overrides,
  } as ImageGenerationRequest;
}

describe('resolveFalBaseUrl', () => {
  it('defaults to https://queue.fal.run', () => {
    expect(resolveFalBaseUrl(makeReq())).toBe('https://queue.fal.run');
  });

  it('honours FAL_QUEUE_BASE_URL env over default', () => {
    process.env.FAL_QUEUE_BASE_URL = 'https://my-fal.example.com/';
    expect(resolveFalBaseUrl(makeReq())).toBe('https://my-fal.example.com');
  });

  it('honours FAL_BASE_URL env when FAL_QUEUE_BASE_URL is absent', () => {
    process.env.FAL_BASE_URL = 'https://alt-fal.example.com/api';
    expect(resolveFalBaseUrl(makeReq())).toBe('https://alt-fal.example.com/api');
  });

  it('cfg.providers.fal.baseUrl wins over env', () => {
    process.env.FAL_QUEUE_BASE_URL = 'https://env.example.com';
    const req = makeReq({
      cfg: { providers: { fal: { baseUrl: 'https://cfg.example.com/' } } } as any,
    });
    expect(resolveFalBaseUrl(req)).toBe('https://cfg.example.com');
  });
});

describe('buildFalImageGenerationProvider', () => {
  it('exposes id, alias, default model, and edit capabilities', () => {
    const p = buildFalImageGenerationProvider();
    expect(p.id).toBe('fal');
    expect(p.aliases).toContain('fal-ai');
    expect(p.label).toBe('Fal.ai');
    expect(p.defaultModel).toBe(FAL_DEFAULT_IMAGE_MODEL);
    expect(p.models?.length ?? 0).toBeGreaterThan(0);
    expect(p.capabilities?.generate?.supportsAspectRatio).toBe(true);
    expect(p.capabilities?.edit?.enabled).toBe(true);
    expect(p.capabilities?.edit?.maxInputImages).toBeGreaterThanOrEqual(1);
    expect(typeof p.generateImage).toBe('function');
  });
});
