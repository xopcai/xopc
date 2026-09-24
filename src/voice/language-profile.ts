import type { Config } from '../config/schema.js';

export type ProductLanguage = 'en' | 'zh';
export type VoiceLanguageMode = 'auto' | 'manual';

export interface VoiceLanguageProfile {
  language: ProductLanguage;
  sttLanguage: 'auto' | 'en';
  edgeLanguage: 'en-US' | 'zh-CN';
  edgeVoice: 'en-US-MichelleNeural' | 'zh-CN-XiaoxiaoNeural';
}

export function resolveVoiceLanguageProfile(language: ProductLanguage): VoiceLanguageProfile {
  return language === 'zh'
    ? {
        language,
        sttLanguage: 'auto',
        edgeLanguage: 'zh-CN',
        edgeVoice: 'zh-CN-XiaoxiaoNeural',
      }
    : {
        language,
        sttLanguage: 'en',
        edgeLanguage: 'en-US',
        edgeVoice: 'en-US-MichelleNeural',
      };
}

export function inferProductLanguageFromEnvironment(): ProductLanguage {
  const locale = [
    process.env.LC_ALL,
    process.env.LC_MESSAGES,
    process.env.LANG,
    Intl.DateTimeFormat().resolvedOptions().locale,
  ].find((value) => typeof value === 'string' && value.trim());
  return locale?.trim().toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

/** Install safe product defaults while preserving every explicit on/off choice. */
export function initializeVoiceDefaults(
  config: Config,
  language: ProductLanguage = inferProductLanguageFromEnvironment(),
): boolean {
  const before = JSON.stringify({ voice: config.voice, tools: config.tools?.media?.audio, tts: config.messages?.tts });
  const existingMode = config.voice?.languageMode;
  const languageMode: VoiceLanguageMode = existingMode ?? 'auto';

  config.voice = {
    ...config.voice,
    languageMode,
    language: config.voice?.language ?? language,
  };

  config.tools = config.tools ?? {};
  config.tools.media = config.tools.media ?? {};
  const audio = config.tools.media.audio;
  config.tools.media.audio = {
    ...audio,
    enabled: audio?.enabled ?? false,
    provider: audio?.provider ?? 'openai',
    fallback: audio?.fallback ?? { enabled: false, order: [] },
    providers: {
      ...(audio?.providers ?? {}),
      alibaba: { model: 'qwen-audio-3.0-asr-flash', ...(audio?.providers?.alibaba ?? {}) },
      openai: { model: 'gpt-4o-mini-transcribe', ...(audio?.providers?.openai ?? {}) },
    },
  };

  if (languageMode === 'auto') {
    applyAutomaticVoiceLanguage(config, language);
  }
  return before !== JSON.stringify({ voice: config.voice, tools: config.tools?.media?.audio, tts: config.messages?.tts });
}

/** Apply product language only to providers whose language mapping is known. */
export function applyAutomaticVoiceLanguage(config: Config, language: ProductLanguage): boolean {
  if ((config.voice?.languageMode ?? 'auto') !== 'auto') return false;
  const before = JSON.stringify({ voice: config.voice, tools: config.tools?.media?.audio, tts: config.messages?.tts });
  const profile = resolveVoiceLanguageProfile(language);

  config.voice = { ...config.voice, languageMode: 'auto', language };
  const tts = config.messages?.tts;
  if (tts?.provider === 'edge') {
    tts.providers = {
      ...(tts.providers ?? {}),
      edge: {
        enabled: true,
        ...(tts.providers?.edge ?? {}),
        voice: profile.edgeVoice,
        lang: profile.edgeLanguage,
      },
    };
  }
  return before !== JSON.stringify({ voice: config.voice, tools: config.tools?.media?.audio, tts: config.messages?.tts });
}
