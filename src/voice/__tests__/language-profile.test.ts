import { describe, expect, it } from 'vitest';

import { ConfigSchema } from '../../config/schema.js';
import {
  applyAutomaticVoiceLanguage,
  initializeVoiceDefaults,
} from '../language-profile.js';

describe('voice language profile', () => {
  it('keeps STT disabled by default without implicitly enabling TTS', () => {
    const config = ConfigSchema.parse({});

    expect(initializeVoiceDefaults(config, 'zh')).toBe(true);

    expect(config.tools?.media?.audio).toMatchObject({
      enabled: false,
      provider: 'openai',
      providers: {
        openai: { model: 'gpt-4o-mini-transcribe' },
      },
    });
    expect(config.messages?.tts).toBeUndefined();
  });

  it('follows English only while language mode is automatic', () => {
    const config = ConfigSchema.parse({
      messages: { tts: { provider: 'edge' } },
    });
    initializeVoiceDefaults(config, 'zh');

    expect(applyAutomaticVoiceLanguage(config, 'en')).toBe(true);
    expect(config.tools?.media?.audio?.enabled).toBe(false);
    expect(config.messages?.tts?.providers?.edge?.voice).toBe('en-US-MichelleNeural');

    config.voice = { ...config.voice, languageMode: 'manual' };
    expect(applyAutomaticVoiceLanguage(config, 'zh')).toBe(false);
    expect(config.messages?.tts?.providers?.edge?.voice).toBe('en-US-MichelleNeural');
  });

  it('preserves explicit disabled states and manual voices', () => {
    const config = ConfigSchema.parse({
      voice: { languageMode: 'manual', language: 'en' },
      tools: { media: { audio: { enabled: false } } },
      messages: {
        tts: {
          enabled: false,
          providers: { edge: { voice: 'en-GB-SoniaNeural', lang: 'en-GB' } },
        },
      },
    });

    initializeVoiceDefaults(config, 'zh');

    expect(config.tools?.media?.audio?.enabled).toBe(false);
    expect(config.messages?.tts?.enabled).toBe(false);
    expect(config.voice?.languageMode).toBe('manual');
    expect(config.messages?.tts?.providers?.edge?.voice).toBe('en-GB-SoniaNeural');
  });
});
