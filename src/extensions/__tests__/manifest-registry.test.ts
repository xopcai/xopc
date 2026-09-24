import { describe, expect, it } from 'vitest';
import { ManifestRegistry } from '../manifest-registry.js';
import type { DiscoveredExtension } from '../types/loader.js';

describe('ManifestRegistry', () => {
  it('indexes providers, channels, model prefixes, and env vars', () => {
    const discovered: DiscoveredExtension[] = [
      {
        id: 'ext-a',
        path: '/p/a',
        source: 'bundled',
        manifest: {
          id: 'ext-a',
          name: 'A',
          providers: ['openai'],
          providerAuthEnvVars: { openai: ['OPENAI_API_KEY'] },
          modelSupport: { modelPrefixes: ['gpt-'] },
          channels: ['telegram'],
          channelEnvVars: { telegram: ['TELEGRAM_BOT_TOKEN'] },
        },
      },
    ];
    const reg = ManifestRegistry.fromDiscovered(discovered);
    expect(reg.findByProvider('openai')?.id).toBe('ext-a');
    expect(reg.findByChannel('telegram')?.id).toBe('ext-a');
    expect(reg.findByModelId('gpt-4o')?.id).toBe('ext-a');
    expect(reg.findByEnvVar('OPENAI_API_KEY')?.id).toBe('ext-a');
    expect(reg.detectAvailableByEnv({ OPENAI_API_KEY: 'x' }).map((e) => e.id)).toEqual(['ext-a']);
  });

  it('indexes speechProviders from manifest and contracts', () => {
    const reg = ManifestRegistry.fromDiscovered([
      {
        id: 'sample-speech-extension',
        path: '/p/sample-speech-extension',
        source: 'bundled',
        manifest: {
          id: 'sample-speech-extension',
          name: 'Sample Speech Extension',
          speechProviders: ['sample-speech'],
          contracts: { speechProviders: ['sample-voice'] },
        },
      },
    ]);
    expect(reg.findBySpeechProvider('sample-speech')?.id).toBe('sample-speech-extension');
    expect(reg.findBySpeechProvider('sample-voice')?.id).toBe('sample-speech-extension');
  });

  it('indexes mediaUnderstandingProviders from manifest and contracts', () => {
    const reg = ManifestRegistry.fromDiscovered([
      {
        id: 'groq-stt',
        path: '/p/groq-stt',
        source: 'bundled',
        manifest: {
          id: 'groq-stt',
          name: 'Groq STT',
          mediaUnderstandingProviders: ['groq'],
          contracts: { mediaUnderstandingProviders: ['groq-whisper'] },
        },
      },
    ]);
    expect(reg.findByMediaUnderstandingProvider('groq')?.id).toBe('groq-stt');
    expect(reg.findByMediaUnderstandingProvider('groq-whisper')?.id).toBe('groq-stt');
  });

  it('matches modelPatterns', () => {
    const reg = ManifestRegistry.fromDiscovered([
      {
        id: 'm',
        path: '/m',
        source: 'global',
        manifest: {
          id: 'm',
          name: 'M',
          modelSupport: { modelPatterns: ['^ft:gpt-'] },
        },
      },
    ]);
    expect(reg.findByModelId('ft:gpt-abc')?.id).toBe('m');
  });
});
