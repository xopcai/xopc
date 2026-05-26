import { describe, expect, it } from 'vitest';

import { collectConfiguredProviderIds } from '../activation-context.js';
import '../../voice/stt/providers/index.js';
import '../../voice/tts/providers/index.js';

describe('collectConfiguredProviderIds', () => {
  it('includes only configured TTS providers from messages.tts', () => {
    const ids = collectConfiguredProviderIds({
      messages: {
        tts: {
          enabled: true,
          provider: 'openai',
          openai: { apiKey: 'sk-test' },
          edge: { enabled: true },
        },
      },
    });
    expect(ids).toContain('openai');
    expect(ids).toContain('edge');
  });

  it('includes only configured STT providers from tools.media.audio', () => {
    const ids = collectConfiguredProviderIds({
      tools: {
        media: {
          audio: {
            enabled: true,
            provider: 'alibaba',
            providers: {
              alibaba: { apiKey: 'sk-alibaba' },
            },
          },
        },
      },
    });
    expect(ids).toContain('alibaba');
    expect(ids).not.toContain('openai');
  });

  it('does not include TTS provider keys without credentials', () => {
    const ids = collectConfiguredProviderIds({
      messages: {
        tts: {
          enabled: true,
          provider: 'openai',
          openai: {},
        },
      },
    });
    expect(ids ?? []).not.toContain('openai');
  });
});
