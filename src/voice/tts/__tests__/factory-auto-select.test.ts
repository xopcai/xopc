import { afterEach, describe, expect, it } from 'vitest';

import { resolveProviderOrder, resolveSpeechProviderChain } from '../factory.js';
import '../providers/index.js';
import type { TTSConfig } from '../types.js';
import { getModelCatalogStore, resetModelCatalogStore } from '../../../providers/model-catalog-store.js';

afterEach(() => resetModelCatalogStore());

describe('resolveProviderOrder', () => {
  it('uses explicit fallback order when enabled', () => {
    const order = resolveProviderOrder(
      'openai',
      { enabled: true, order: ['minimax', 'edge'] },
      {
        enabled: true,
        provider: 'openai',
        providers: { openai: { apiKey: 'sk-test' } },
      } as TTSConfig,
    );
    expect(order).toEqual(['openai', 'minimax', 'edge']);
  });

  it('auto-selects configured providers by autoSelectOrder when fallback disabled', () => {
    const order = resolveProviderOrder(
      'edge',
      { enabled: false, order: [] },
      {
        enabled: true,
        provider: 'edge',
        managedAuto: true,
        providers: { openai: { apiKey: 'sk-test' }, edge: { enabled: true } },
      } as TTSConfig,
    );
    expect(order[0]).toBe('edge');
    expect(order).toContain('openai');
    if (order.includes('alibaba')) {
      expect(order.indexOf('openai')).toBeLessThan(order.indexOf('alibaba'));
    }
  });

  it('expands every compatible Cloud model and keeps an explicit model first', () => {
    getModelCatalogStore().replaceSourceModels('xopc-cloud', {
      providerId: 'xopc-cloud', baseUrl: 'https://router.test/v1', api: 'openai-completions',
      etag: '1', recommendedModel: null, lastSuccessAt: Date.now(),
    }, ['voice-a', 'voice-b'].map((id) => ({
      id, name: id, kind: 'tts' as const, input: ['text' as const], output: ['audio' as const],
      operations: ['audio.speech' as const], reasoning: false, contextWindow: 128_000,
      maxOutputTokens: null,
      tts: { maxCharacters: 1_000, languages: ['en'], outputFormats: ['mp3' as const],
        streaming: false, speed: false, pitch: false, instructions: false, defaultVoice: 'coral' },
    })));
    const chain = resolveSpeechProviderChain({
      enabled: true, provider: 'xopc-cloud', trigger: 'off', managedAuto: false,
      fallback: { enabled: false, order: [] },
      providers: { 'xopc-cloud': { model: 'voice-b' } },
    });

    expect(chain.map((entry) => entry.providerConfig.model)).toEqual(['voice-b', 'voice-a']);
  });
});
