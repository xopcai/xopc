import { describe, expect, it } from 'vitest';

import {
  collectSttProviderConfigEntries,
  readSttProviderFields,
  resolveSttProviderConfigSlice,
} from '../config-slice.js';

describe('collectSttProviderConfigEntries', () => {
  it('reads only entries from the providers map', () => {
    const entries = collectSttProviderConfigEntries({
      provider: 'openai',
      providers: {
        openai: { model: 'gpt-4o-mini-transcribe' },
      },
      openai: { apiKey: 'sk-test' },
    });

    expect(entries.openai).toEqual({ model: 'gpt-4o-mini-transcribe' });
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
  it('ignores unsupported flat provider keys', () => {
    const slice = resolveSttProviderConfigSlice('openai', {
      providers: { openai: { model: 'from-map' } },
      openai: { model: 'from-flat' },
    });
    expect(slice.model).toBe('from-map');
  });
});

describe('readSttProviderFields', () => {
  it('merges model entry overrides', () => {
    const fields = readSttProviderFields({ model: 'gpt-4o-transcribe' }, { model: 'gpt-4o-mini-transcribe' });
    expect(fields.model).toBe('gpt-4o-mini-transcribe');
  });
});
