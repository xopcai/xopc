import { randomUUID } from 'node:crypto';

import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  resolveEffectiveImageModelConfig: vi.fn(),
  describeImagesWithFallback: vi.fn(),
}));

vi.mock('../../../../agent/image/tool-model-config.js', () => ({
  resolveEffectiveImageModelConfig: mocks.resolveEffectiveImageModelConfig,
}));

vi.mock('../../../../agent/image/understanding/runtime.js', () => ({
  describeImagesWithFallback: mocks.describeImagesWithFallback,
}));

import { ConfigSchema } from '../../../../config/schema.js';
import { auth } from '../../middleware/auth.js';
import { gatewayScopes } from '../../middleware/scopes.js';
import type { AuthenticatedRouteDeps } from '../deps.js';
import {
  getLoadedLazyRouteBundleIdsForTests,
  registerAuthenticatedLazyRouteFallback,
  resetLazyRouteBundlesForTests,
} from '../lazy-fallback.js';
import { parseTranslationModelOutput } from '../screenshot-ai.js';

describe('screenshot AI authenticated Gateway endpoint (/api/screenshot/analyze)', () => {
  it('parses structured JSON, fenced JSON, and plain text translation responses', () => {
    const fenced =
      '```json\n{"targetLanguage":"zh-CN","sourceText":"Hello","translatedText":"你好","items":[{"source":"Hello","translation":"你好"}]}\n```';
    expect(parseTranslationModelOutput(fenced, 'zh')).toEqual({
      targetLanguage: 'zh-CN',
      sourceText: 'Hello',
      translatedText: '你好',
      items: [{ source: 'Hello', translation: '你好' }],
    });

    expect(parseTranslationModelOutput('Plain fallback translation', 'en')).toEqual({
      targetLanguage: 'en',
      sourceText: '',
      translatedText: 'Plain fallback translation',
      items: [],
    });
  });

  it('serves OCR and translation over real authenticated Gateway lazy routing', async () => {
    const token = randomUUID();
    resetLazyRouteBundlesForTests();

    const app = new Hono();
    app.use('*', auth({ getResolvedAuth: () => ({ mode: 'token', token }) }));
    app.use('*', gatewayScopes());
    registerAuthenticatedLazyRouteFallback(app, {
      service: {
        isGatewayReady: () => true,
        currentConfig: ConfigSchema.parse({}),
      },
      strictRateLimitMiddleware: async (_c, next) => next(),
      chatRateLimitMiddleware: async (_c, next) => next(),
      xopcCloudPollRateLimitMiddleware: async (_c, next) => next(),
    } as unknown as AuthenticatedRouteDeps);

    const pngBase64 = Buffer.from('fake-png-image-bytes-for-test').toString('base64');

    // 1. Unauthenticated request must be rejected with 401
    const unauth = await app.request('/api/screenshot/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'ocr', imageBase64: pngBase64 }),
    });
    expect(unauth.status).toBe(401);

    // 2. Returns 409 when no vision model is configured
    mocks.resolveEffectiveImageModelConfig.mockReturnValueOnce(null);
    const noModel = await app.request('/api/screenshot/analyze', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'ocr', imageBase64: pngBase64 }),
    });
    expect(noModel.status).toBe(409);
    expect(getLoadedLazyRouteBundleIdsForTests().authenticated).toContain('screenshot-ai');

    // 3. OCR mode
    mocks.resolveEffectiveImageModelConfig.mockReturnValueOnce({
      primary: 'openai/gpt-4o',
      fallbacks: [],
      source: 'explicit',
    });
    mocks.describeImagesWithFallback.mockResolvedValueOnce({
      text: '快捷键\n截图快捷键',
      provider: 'openai',
      model: 'gpt-4o',
      attempts: [],
    });
    const ocrRes = await app.request('/api/screenshot/analyze', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'ocr', imageBase64: pngBase64 }),
    });
    expect(ocrRes.status).toBe(200);
    await expect(ocrRes.json()).resolves.toEqual({
      ok: true,
      mode: 'ocr',
      engine: 'ai',
      text: '快捷键\n截图快捷键',
      model: 'openai/gpt-4o',
    });

    // 4. Translate mode
    mocks.resolveEffectiveImageModelConfig.mockReturnValueOnce({
      primary: 'openai/gpt-4o',
      fallbacks: [],
      source: 'explicit',
    });
    mocks.describeImagesWithFallback.mockResolvedValueOnce({
      text: JSON.stringify({
        targetLanguage: 'en',
        sourceText: '截图快捷键',
        translatedText: 'Screenshot shortcut',
        items: [{ source: '截图快捷键', translation: 'Screenshot shortcut' }],
      }),
      provider: 'openai',
      model: 'gpt-4o',
      attempts: [],
    });
    const transRes = await app.request('/api/screenshot/analyze', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'translate', imageBase64: pngBase64, targetLanguage: 'en' }),
    });
    expect(transRes.status).toBe(200);
    await expect(transRes.json()).resolves.toMatchObject({
      ok: true,
      mode: 'translate',
      sourceText: '截图快捷键',
      translatedText: 'Screenshot shortcut',
      targetLanguage: 'en',
      model: 'openai/gpt-4o',
    });
  });
});
