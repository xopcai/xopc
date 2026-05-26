import { describe, expect, it, vi } from 'vitest';

import {
  declaredSpeechProviderIds,
  normalizeRegisteredSpeechProviderIds,
  validateSpeechProviderContracts,
} from '../speech-provider-contracts.js';
import type { ExtensionManifest } from '../types/manifest.js';
import type { SpeechProviderPlugin } from '../../voice/tts/speech-provider-types.js';
import { registerSpeechProvider, _clearSpeechRegistryForTests } from '../../voice/tts/speech-registry.js';

const mockLocalCliProvider: SpeechProviderPlugin = {
  id: 'tts-local-cli',
  aliases: ['cli', 'local-cli'],
  resolveConfig: (ctx) => ctx.rawConfig,
  isConfigured: (ctx) => Boolean((ctx.providerConfig as { command?: string }).command),
  synthesize: async () => ({
    audioBuffer: Buffer.from(''),
    outputFormat: 'wav',
    fileExtension: 'wav',
    voiceCompatible: false,
  }),
};

describe('speech provider contracts', () => {
  it('collects declared ids from manifest speechProviders and contracts', () => {
    const manifest: ExtensionManifest = {
      id: 'tts-local-cli',
      name: 'Local CLI TTS',
      speechProviders: ['tts-local-cli'],
      contracts: { speechProviders: ['cli'] },
    };
    expect(declaredSpeechProviderIds(manifest).sort()).toEqual(['cli', 'tts-local-cli']);
  });

  it('warns when declared contract ids were not registered', () => {
    const warn = vi.fn();
    validateSpeechProviderContracts({
      extensionId: 'tts-local-cli',
      manifest: {
        id: 'tts-local-cli',
        name: 'Local CLI TTS',
        contracts: { speechProviders: ['missing-provider'] },
      },
      registeredProviderIds: [],
      logger: { debug: vi.fn(), info: vi.fn(), warn, error: vi.fn() },
    });
    expect(warn).toHaveBeenCalledOnce();
  });

  it('accepts tts-local-cli registration against manifest contracts', () => {
    _clearSpeechRegistryForTests();
    registerSpeechProvider(mockLocalCliProvider);

    const registered = normalizeRegisteredSpeechProviderIds(['tts-local-cli']);
    expect(registered).toContain('tts-local-cli');

    const warn = vi.fn();
    validateSpeechProviderContracts({
      extensionId: 'tts-local-cli',
      manifest: {
        id: 'tts-local-cli',
        name: 'Local CLI TTS',
        contracts: { speechProviders: ['tts-local-cli', 'cli'] },
      },
      registeredProviderIds: ['tts-local-cli'],
      logger: { debug: vi.fn(), info: vi.fn(), warn, error: vi.fn() },
    });
    expect(warn).not.toHaveBeenCalled();

    _clearSpeechRegistryForTests();
  });
});

describe('SpeechProviderPlugin contract surface', () => {
  it('requires resolveConfig, isConfigured, and synthesize', () => {
    expect(mockLocalCliProvider.id).toBe('tts-local-cli');
    expect(typeof mockLocalCliProvider.resolveConfig).toBe('function');
    expect(typeof mockLocalCliProvider.isConfigured).toBe('function');
    expect(typeof mockLocalCliProvider.synthesize).toBe('function');
  });
});
