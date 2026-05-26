import { describe, expect, it, vi } from 'vitest';

import extension, { groqSttProvider } from './index.js';
import { validateMediaUnderstandingProviderContracts } from '../../src/extensions/media-provider-contracts.js';
import {
  getMediaUnderstandingProvider,
  registerMediaUnderstandingProvider,
  _clearMediaUnderstandingRegistryForTests,
} from '../../src/media-understanding/registry.js';
import { isSttProviderConfigured } from '../../src/voice/stt/list-providers.js';
import { resolveSTTProviderConfig } from '../../src/voice/stt/factory.js';

describe('groq-stt extension', () => {
  it('exports extension metadata and provider id groq', () => {
    expect(extension.id).toBe('groq-stt');
    expect(extension.kind).toBe('media-provider');
    expect(groqSttProvider.id).toBe('groq');
    expect(groqSttProvider.capabilities).toEqual(['audio']);
    expect(groqSttProvider.envKey).toBe('GROQ_API_KEY');
  });

  it('register() wires provider into the registry', () => {
    _clearMediaUnderstandingRegistryForTests();
    const registeredIds: string[] = [];
    extension.register?.({
      registerMediaUnderstandingProvider(plugin) {
        registerMediaUnderstandingProvider(plugin);
        registeredIds.push(plugin.id);
      },
    } as never);

    expect(registeredIds).toEqual(['groq']);
    expect(getMediaUnderstandingProvider('groq')?.id).toBe('groq');
    expect(getMediaUnderstandingProvider('groq-whisper')?.id).toBe('groq');
  });

  it('matches manifest mediaUnderstanding provider contracts', () => {
    const warn = vi.fn();
    validateMediaUnderstandingProviderContracts({
      extensionId: 'groq-stt',
      manifest: {
        id: 'groq-stt',
        name: 'Groq STT',
        mediaUnderstandingProviders: ['groq'],
        contracts: { mediaUnderstandingProviders: ['groq'] },
      },
      registeredProviderIds: ['groq'],
      logger: { debug: vi.fn(), info: vi.fn(), warn, error: vi.fn() },
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it('resolves configured when apiKey is present in providers map', () => {
    _clearMediaUnderstandingRegistryForTests();
    registerMediaUnderstandingProvider(groqSttProvider);
    const config = {
      enabled: true,
      provider: 'groq',
      providers: {
        groq: { apiKey: 'gsk-test', model: 'whisper-large-v3-turbo' },
      },
    };
    expect(isSttProviderConfigured('groq', config)).toBe(true);
    expect(resolveSTTProviderConfig('groq', config)?.model).toBe('whisper-large-v3-turbo');
  });
});
