import { describe, expect, it } from 'vitest';

import { resolveSTTProviderChain, resolveSTTProviderConfig } from '../factory.js';
import '../providers/index.js';

describe('resolveSTTProviderConfig', () => {
  it('reads apiKey from providers map', () => {
    const resolved = resolveSTTProviderConfig('openai', {
      enabled: true,
      provider: 'openai',
      providers: { openai: { apiKey: 'sk-test', model: 'whisper-1' } },
    });
    expect(resolved).toEqual({
      id: 'openai',
      apiKey: 'sk-test',
      model: 'whisper-1',
    });
  });

  it('applies model entry overrides', () => {
    const resolved = resolveSTTProviderConfig(
      'openai',
      {
        enabled: true,
        provider: 'openai',
        providers: { openai: { apiKey: 'sk-test', model: 'whisper-1' } },
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
        { provider: 'openai', model: 'whisper-1', capabilities: ['audio'] },
        { provider: 'alibaba', model: 'paraformer-v2', capabilities: ['audio'] },
      ],
      providers: {
        openai: { apiKey: 'sk-openai' },
        alibaba: { apiKey: 'sk-alibaba' },
      },
    });

    expect(chain.map((entry) => entry.id)).toEqual(['openai', 'alibaba']);
    expect(chain[0]?.model).toBe('whisper-1');
  });

  it('uses legacy primary + fallback when models[] is empty', () => {
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
      fallback: { enabled: false, order: [] },
      providers: {
        openai: { apiKey: 'sk-openai' },
        alibaba: { apiKey: 'sk-alibaba' },
      },
    });

    expect(chain[0]?.id).toBe('openai');
    expect(chain.map((entry) => entry.id)).toContain('alibaba');
  });
});
