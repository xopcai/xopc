import { describe, expect, it } from 'vitest';

import {
  buildTtsResolveRawConfig,
  collectTtsProviderConfigEntries,
  resolveTtsProviderConfigSlice,
} from '../config-slice.js';

describe('collectTtsProviderConfigEntries', () => {
  it('returns entries straight from the providers map', () => {
    const entries = collectTtsProviderConfigEntries({
      provider: 'openai',
      providers: {
        openai: { model: 'tts-1-hd', voice: 'nova' },
        'sample-speech': { endpoint: 'https://speech.example.test' },
      },
    });

    expect(entries.openai).toEqual({ model: 'tts-1-hd', voice: 'nova' });
    expect(entries['sample-speech']).toEqual({ endpoint: 'https://speech.example.test' });
  });

  it('returns {} when no providers map is set', () => {
    const entries = collectTtsProviderConfigEntries({
      enabled: true,
      provider: 'edge',
      fallback: { enabled: true, order: ['edge'] },
    });
    expect(entries).toEqual({});
  });
});

describe('buildTtsResolveRawConfig', () => {
  it('includes providers map and top-level slice for resolveConfig', () => {
    const raw = buildTtsResolveRawConfig('sample-speech', {
      enabled: true,
      provider: 'sample-speech',
      providers: {
        'sample-speech': { endpoint: 'https://speech.example.test' },
      },
    });

    expect(raw.providers).toEqual({
      'sample-speech': { endpoint: 'https://speech.example.test' },
    });
    expect(raw['sample-speech']).toEqual({ endpoint: 'https://speech.example.test' });
  });
});

describe('resolveTtsProviderConfigSlice', () => {
  it('reads from the providers map', () => {
    const slice = resolveTtsProviderConfigSlice('openai', {
      providers: { openai: { model: 'from-map' } },
    });
    expect(slice.model).toBe('from-map');
  });
});
