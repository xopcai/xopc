import { describe, expect, it } from 'vitest';

import { ConfigSchema } from '../schema.js';
import {
  normalizeSttConfigBlock,
  normalizeTtsConfigBlock,
  normalizeVoiceConfigInJson,
} from '../voice-config-normalize.js';

describe('voice-config-normalize', () => {
  it('hoists legacy STT provider keys into providers map', () => {
    const normalized = normalizeSttConfigBlock({
      enabled: true,
      provider: 'alibaba',
      alibaba: { model: 'paraformer-v2' },
      openai: { apiKey: 'sk-test' },
    }) as Record<string, Record<string, unknown>>;

    expect(normalized.alibaba).toBeUndefined();
    expect(normalized.providers.alibaba).toEqual({ model: 'paraformer-v2' });
    expect(normalized.providers.openai).toEqual({ apiKey: 'sk-test' });
  });

  it('hoists legacy TTS provider keys into providers map', () => {
    const normalized = normalizeTtsConfigBlock({
      enabled: true,
      provider: 'openai',
      openai: { model: 'tts-1', voice: 'alloy' },
      edge: { voice: 'en-US-MichelleNeural' },
      'tts-local-cli': { command: 'piper --text {{Text}}' },
    }) as Record<string, Record<string, unknown>>;

    expect(normalized.openai).toBeUndefined();
    expect(normalized.providers.openai).toEqual({ model: 'tts-1', voice: 'alloy' });
    expect(normalized.providers.edge).toEqual({ voice: 'en-US-MichelleNeural' });
    expect(normalized.providers['tts-local-cli']).toEqual({ command: 'piper --text {{Text}}' });
  });

  it('merges flat keys over existing providers map entries', () => {
    const normalized = normalizeTtsConfigBlock({
      providers: { openai: { apiKey: 'sk-old' } },
      openai: { model: 'tts-1-hd' },
    }) as Record<string, Record<string, unknown>>;

    expect(normalized.providers.openai).toEqual({ apiKey: 'sk-old', model: 'tts-1-hd' });
  });

  it('allows full config parse after normalization', () => {
    const parsed = ConfigSchema.parse(
      normalizeVoiceConfigInJson({
        tools: {
          media: {
            audio: {
              enabled: true,
              alibaba: { model: 'paraformer-v2' },
            },
          },
        },
        messages: {
          tts: {
            enabled: true,
            openai: { model: 'tts-1' },
            edge: { voice: 'en-US-MichelleNeural' },
          },
        },
      }),
    );

    expect(parsed.tools.media?.audio?.providers?.alibaba?.model).toBe('paraformer-v2');
    expect(parsed.messages?.tts?.providers?.openai?.model).toBe('tts-1');
    expect(parsed.messages?.tts?.providers?.edge?.voice).toBe('en-US-MichelleNeural');
  });
});
