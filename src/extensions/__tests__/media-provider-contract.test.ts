import { describe, expect, it, vi } from 'vitest';

import {
  declaredMediaUnderstandingProviderIds,
  validateMediaUnderstandingProviderContracts,
} from '../media-provider-contracts.js';
import type { ExtensionManifest } from '../types/manifest.js';
import type { MediaUnderstandingProvider } from '../../media-understanding/types.js';
import {
  registerMediaUnderstandingProvider,
  _clearMediaUnderstandingRegistryForTests,
} from '../../media-understanding/registry.js';

const mockGroqProvider: MediaUnderstandingProvider = {
  id: 'groq',
  capabilities: ['audio'],
  envKey: 'GROQ_API_KEY',
  transcribeAudio: async () => ({ text: 'ok' }),
};

describe('declaredMediaUnderstandingProviderIds', () => {
  it('collects declared ids from manifest mediaUnderstandingProviders and contracts', () => {
    const manifest: ExtensionManifest = {
      id: 'groq-stt',
      name: 'Groq STT',
      mediaUnderstandingProviders: ['groq'],
      contracts: { mediaUnderstandingProviders: ['groq-whisper'] },
    };
    expect(declaredMediaUnderstandingProviderIds(manifest).sort()).toEqual(['groq', 'groq-whisper']);
  });
});

describe('validateMediaUnderstandingProviderContracts', () => {
  it('warns when declared contract was not registered', () => {
    const warn = vi.fn();
    validateMediaUnderstandingProviderContracts({
      extensionId: 'groq-stt',
      manifest: {
        id: 'groq-stt',
        name: 'Groq STT',
        contracts: { mediaUnderstandingProviders: ['missing-provider'] },
      },
      registeredProviderIds: [],
      logger: { debug: vi.fn(), info: vi.fn(), warn, error: vi.fn() },
    });
    expect(warn).toHaveBeenCalled();
  });

  it('passes when registered provider matches contract', () => {
    _clearMediaUnderstandingRegistryForTests();
    registerMediaUnderstandingProvider(mockGroqProvider);
    const warn = vi.fn();
    validateMediaUnderstandingProviderContracts({
      extensionId: 'groq-stt',
      manifest: {
        id: 'groq-stt',
        name: 'Groq STT',
        contracts: { mediaUnderstandingProviders: ['groq'] },
      },
      registeredProviderIds: ['groq'],
      logger: { debug: vi.fn(), info: vi.fn(), warn, error: vi.fn() },
    });
    expect(warn).not.toHaveBeenCalled();
  });
});
