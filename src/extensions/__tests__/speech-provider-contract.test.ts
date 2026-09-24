import { describe, expect, it, vi } from 'vitest';

import {
  declaredSpeechProviderIds,
  normalizeRegisteredSpeechProviderIds,
  validateSpeechProviderContracts,
} from '../speech-provider-contracts.js';
import type { ExtensionManifest } from '../types/manifest.js';
import type { SpeechProviderPlugin } from '../../voice/tts/speech-provider-types.js';
import { registerSpeechProvider, _clearSpeechRegistryForTests } from '../../voice/tts/speech-registry.js';

const mockSpeechProvider: SpeechProviderPlugin = {
  id: 'sample-speech',
  aliases: ['sample-voice'],
  resolveConfig: (ctx) => ctx.rawConfig,
  isConfigured: (ctx) => Boolean((ctx.providerConfig as { apiKey?: string }).apiKey),
  synthesize: async () => ({
    audioBuffer: Buffer.from(''),
    outputFormat: 'mp3',
    fileExtension: 'mp3',
    voiceCompatible: false,
  }),
};

describe('speech provider contracts', () => {
  it('collects declared ids from manifest speechProviders and contracts', () => {
    const manifest: ExtensionManifest = {
      id: 'sample-speech-extension',
      name: 'Sample Speech Extension',
      speechProviders: ['sample-speech'],
      contracts: { speechProviders: ['sample-voice'] },
    };
    expect(declaredSpeechProviderIds(manifest).sort()).toEqual(['sample-speech', 'sample-voice']);
  });

  it('warns when declared contract ids were not registered', () => {
    const warn = vi.fn();
    validateSpeechProviderContracts({
      extensionId: 'sample-speech-extension',
      manifest: {
        id: 'sample-speech-extension',
        name: 'Sample Speech Extension',
        contracts: { speechProviders: ['missing-provider'] },
      },
      registeredProviderIds: [],
      logger: { debug: vi.fn(), info: vi.fn(), warn, error: vi.fn() },
    });
    expect(warn).toHaveBeenCalledOnce();
  });

  it('accepts a speech provider registration against manifest contracts', () => {
    _clearSpeechRegistryForTests();
    registerSpeechProvider(mockSpeechProvider);

    const registered = normalizeRegisteredSpeechProviderIds(['sample-speech']);
    expect(registered).toContain('sample-speech');

    const warn = vi.fn();
    validateSpeechProviderContracts({
      extensionId: 'sample-speech-extension',
      manifest: {
        id: 'sample-speech-extension',
        name: 'Sample Speech Extension',
        contracts: { speechProviders: ['sample-speech', 'sample-voice'] },
      },
      registeredProviderIds: ['sample-speech'],
      logger: { debug: vi.fn(), info: vi.fn(), warn, error: vi.fn() },
    });
    expect(warn).not.toHaveBeenCalled();

    _clearSpeechRegistryForTests();
  });
});

describe('SpeechProviderPlugin contract surface', () => {
  it('requires resolveConfig, isConfigured, and synthesize', () => {
    expect(mockSpeechProvider.id).toBe('sample-speech');
    expect(typeof mockSpeechProvider.resolveConfig).toBe('function');
    expect(typeof mockSpeechProvider.isConfigured).toBe('function');
    expect(typeof mockSpeechProvider.synthesize).toBe('function');
  });
});
