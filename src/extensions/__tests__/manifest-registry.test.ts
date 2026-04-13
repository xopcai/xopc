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
