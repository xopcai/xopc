import { describe, expect, it } from 'vitest';

import { ConfigSchema } from '../../config/schema.js';
import {
  applyAutomaticVoiceLanguage,
  initializeVoiceDefaults,
} from '../language-profile.js';

describe('voice language profile', () => {
  it('enables local STT with Chinese defaults without implicitly enabling TTS', () => {
    const config = ConfigSchema.parse({});

    expect(initializeVoiceDefaults(config, 'zh')).toBe(true);

    expect(config.tools?.media?.audio).toMatchObject({
      enabled: true,
      provider: 'xopc-local',
      providers: {
        'xopc-local': { model: 'sensevoice-small', language: 'auto' },
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
    expect(config.tools?.media?.audio?.providers?.['xopc-local']?.language).toBe('en');
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
