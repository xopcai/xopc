import { describe, expect, it } from 'vitest';

import {
  collectSttProviderConfigEntries,
  readSttProviderFields,
  resolveSttProviderConfigSlice,
} from '../config-slice.js';

describe('collectSttProviderConfigEntries', () => {
  it('merges providers map with legacy flat keys', () => {
    const entries = collectSttProviderConfigEntries({
      provider: 'openai',
      providers: {
        openai: { model: 'whisper-1' },
      },
      openai: { apiKey: 'sk-test' },
    });

    expect(entries.openai).toEqual({ model: 'whisper-1' });
  });

  it('ignores reserved top-level keys', () => {
    const entries = collectSttProviderConfigEntries({
      enabled: true,
      provider: 'alibaba',
      models: [{ provider: 'openai' }],
      fallback: { enabled: true, order: ['alibaba'] },
    });
    expect(entries).toEqual({});
  });
});

describe('resolveSttProviderConfigSlice', () => {
  it('prefers providers map over flat legacy key', () => {
    const slice = resolveSttProviderConfigSlice('openai', {
      providers: { openai: { model: 'from-map' } },
      openai: { model: 'from-flat' },
    });
    expect(slice.model).toBe('from-map');
  });
});

describe('readSttProviderFields', () => {
  it('merges model entry overrides', () => {
    const fields = readSttProviderFields({ model: 'whisper-1' }, { model: 'gpt-4o-mini-transcribe' });
    expect(fields.model).toBe('gpt-4o-mini-transcribe');
  });
});
