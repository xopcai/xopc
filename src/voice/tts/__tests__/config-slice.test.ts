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
        'tts-local-cli': { command: 'piper --text {{Text}}' },
      },
    });

    expect(entries.openai).toEqual({ model: 'tts-1-hd', voice: 'nova' });
    expect(entries['tts-local-cli']).toEqual({ command: 'piper --text {{Text}}' });
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
  it('reads from the providers map', () => {
    const slice = resolveTtsProviderConfigSlice('openai', {
      providers: { openai: { model: 'from-map' } },
    });
    expect(slice.model).toBe('from-map');
  });
});
