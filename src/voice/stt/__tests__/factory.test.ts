import { afterEach, describe, expect, it } from 'vitest';

import { resolveSTTProviderChain, resolveSTTProviderConfig } from '../factory.js';
import '../providers/index.js';
import { getModelCatalogStore, resetModelCatalogStore } from '../../../providers/model-catalog-store.js';

afterEach(() => resetModelCatalogStore());

describe('resolveSTTProviderConfig', () => {
  it('reads apiKey from providers map', () => {
    const resolved = resolveSTTProviderConfig('openai', {
      enabled: true,
      provider: 'openai',
      providers: { openai: { apiKey: 'sk-test', model: 'gpt-4o-mini-transcribe' } },
    });
    expect(resolved).toEqual({
      id: 'openai',
      apiKey: 'sk-test',
      model: 'gpt-4o-mini-transcribe',
    });
  });

  it('applies model entry overrides', () => {
    const resolved = resolveSTTProviderConfig(
      'openai',
      {
        enabled: true,
        provider: 'openai',
        providers: { openai: { apiKey: 'sk-test', model: 'gpt-4o-mini-transcribe' } },
      },
      { provider: 'openai', model: 'gpt-4o-mini-transcribe' },
    );
    expect(resolved?.model).toBe('gpt-4o-mini-transcribe');
  });
});

describe('resolveSTTProviderChain', () => {
  it('prefers models[] over primary/fallback', () => {
    const chain = resolveSTTProviderChain({
      enabled: true,
      provider: 'alibaba',
      fallback: { enabled: true, order: ['alibaba', 'openai'] },
      models: [
        { provider: 'openai', model: 'gpt-4o-mini-transcribe', capabilities: ['audio'] },
        { provider: 'alibaba', model: 'qwen-audio-3.0-asr-flash', capabilities: ['audio'] },
      ],
      providers: {
        openai: { apiKey: 'sk-openai' },
        alibaba: { apiKey: 'sk-alibaba' },
      },
    });

    expect(chain.map((entry) => entry.id)).toEqual(['openai', 'alibaba']);
    expect(chain[0]?.model).toBe('gpt-4o-mini-transcribe');
  });

  it('uses the configured primary and fallback when models[] is empty', () => {
    const config = {
      enabled: true,
      provider: 'alibaba',
      fallback: { enabled: true, order: ['alibaba', 'openai'] },
      providers: {
        openai: { apiKey: 'sk-openai' },
        alibaba: { apiKey: 'sk-alibaba' },
      },
    };
    const chain = resolveSTTProviderChain(config);

    expect(chain.map((entry) => entry.id)).toEqual(['alibaba', 'openai']);
  });

  it('auto-selects configured providers when fallback disabled', () => {
    const chain = resolveSTTProviderChain({
      enabled: true,
      provider: 'openai',
      managedAuto: true,
      fallback: { enabled: false, order: [] },
      providers: {
        openai: { apiKey: 'sk-openai' },
        alibaba: { apiKey: 'sk-alibaba' },
      },
    });

    expect(chain[0]?.id).toBe('openai');
    expect(chain.map((entry) => entry.id)).toContain('alibaba');
  });

  it('does not expand an explicit provider when fallback is disabled', () => {
    const chain = resolveSTTProviderChain({
      enabled: true,
      provider: 'openai',
      managedAuto: false,
      fallback: { enabled: false, order: [] },
      providers: {
        openai: { apiKey: 'sk-openai' },
        alibaba: { apiKey: 'sk-alibaba' },
      },
    });

    expect(chain.map((entry) => entry.id)).toEqual(['openai']);
  });

  it('expands every managed XOPC Cloud STT model for model-level failover', () => {
    getModelCatalogStore().replaceSourceModels('xopc-cloud', {
      providerId: 'xopc-cloud', baseUrl: 'https://router.test/v1', api: 'openai-completions',
      etag: '1', recommendedModel: null, lastSuccessAt: Date.now(),
    }, ['stt-a', 'stt-b'].map((id) => ({
      id, name: id, kind: 'stt' as const, input: ['audio' as const], output: ['text' as const],
      operations: ['audio.transcription' as const], reasoning: false,
      contextWindow: 128_000, maxOutputTokens: null,
    })));

    const chain = resolveSTTProviderChain({
      enabled: true, provider: 'xopc-cloud', managedAuto: true,
      fallback: { enabled: false, order: [] },
    });

    expect(chain.map((entry) => `${entry.id}/${entry.model}`).slice(0, 2)).toEqual([
      'xopc-cloud/stt-a', 'xopc-cloud/stt-b',
    ]);
  });
});
