import { describe, expect, it } from 'vitest';

import {
  buildTtsResolveRawConfig,
  collectTtsProviderConfigEntries,
  resolveTtsProviderConfigSlice,
} from '../config-slice.js';

describe('collectTtsProviderConfigEntries', () => {
  it('merges providers map with legacy flat keys', () => {
    const entries = collectTtsProviderConfigEntries({
      provider: 'openai',
      providers: {
        openai: { model: 'tts-1-hd', voice: 'nova' },
      },
      openai: { apiKey: 'sk-test' },
      'tts-local-cli': { command: 'piper --text {{Text}}' },
    });

    expect(entries.openai).toEqual({
      model: 'tts-1-hd',
      voice: 'nova',
    });
    expect(entries['tts-local-cli']).toEqual({ command: 'piper --text {{Text}}' });
  });

  it('ignores reserved top-level keys', () => {
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
    const raw = buildTtsResolveRawConfig('tts-local-cli', {
      enabled: true,
      provider: 'tts-local-cli',
      providers: {
        'tts-local-cli': { command: 'echo {{Text}}' },
      },
    });

    expect(raw.providers).toEqual({
      'tts-local-cli': { command: 'echo {{Text}}' },
    });
    expect(raw['tts-local-cli']).toEqual({ command: 'echo {{Text}}' });
  });
});

describe('resolveTtsProviderConfigSlice', () => {
  it('prefers providers map over flat legacy key', () => {
    const slice = resolveTtsProviderConfigSlice('openai', {
      providers: { openai: { model: 'from-map' } },
      openai: { model: 'from-flat' },
    });
    expect(slice.model).toBe('from-map');
  });
});
