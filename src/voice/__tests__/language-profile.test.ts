import { describe, expect, it } from 'vitest';

import { ConfigSchema } from '../../config/schema.js';
import {
  applyAutomaticVoiceLanguage,
  initializeVoiceDefaults,
} from '../language-profile.js';

describe('voice language profile', () => {
  it('enables local STT and Edge TTS with Chinese defaults', () => {
    const config = ConfigSchema.parse({});

    expect(initializeVoiceDefaults(config, 'zh')).toBe(true);

    expect(config.tools?.media?.audio).toMatchObject({
      enabled: true,
      provider: 'xopc-local',
      providers: {
        'xopc-local': { model: 'sensevoice-small', language: 'auto' },
      },
    });
    expect(config.messages?.tts).toMatchObject({
      enabled: true,
      provider: 'edge',
      trigger: 'inbound',
      providers: {
        edge: { enabled: true, voice: 'zh-CN-XiaoxiaoNeural', lang: 'zh-CN' },
      },
    });
  });

  it('follows English only while language mode is automatic', () => {
    const config = ConfigSchema.parse({});
    initializeVoiceDefaults(config, 'zh');

    expect(applyAutomaticVoiceLanguage(config, 'en')).toBe(true);
    expect(config.tools?.media?.audio?.providers?.['xopc-local']?.language).toBe('en');
    expect(config.messages?.tts?.providers?.edge?.voice).toBe('en-US-MichelleNeural');

    config.voice = { ...config.voice, languageMode: 'manual' };
    expect(applyAutomaticVoiceLanguage(config, 'zh')).toBe(false);
    expect(config.messages?.tts?.providers?.edge?.voice).toBe('en-US-MichelleNeural');
  });

  it('preserves explicit disabled states and legacy manual voices', () => {
    const config = ConfigSchema.parse({
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
