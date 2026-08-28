import type { Config } from '../config/schema.js';
import { createLogger } from '../utils/logger.js';
import { startLocalVoiceModelInstall } from './local/model-manager.js';
import {
  DEFAULT_LOCAL_VOICE_MODEL_ID,
  isLocalVoiceModelInstalled,
} from './local/models.js';

const log = createLogger('Voice:Language');

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
    enabled: audio?.enabled ?? true,
    provider: audio?.provider ?? 'xopc-local',
    fallback: audio?.fallback ?? { enabled: false, order: ['xopc-local'] },
    providers: {
      ...(audio?.providers ?? {}),
      'xopc-local': {
        model: DEFAULT_LOCAL_VOICE_MODEL_ID,
        ...(audio?.providers?.['xopc-local'] ?? {}),
      },
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
  const audio = config.tools?.media?.audio;
  if (audio?.provider === 'xopc-local') {
    audio.providers = {
      ...(audio.providers ?? {}),
      'xopc-local': {
        ...(audio.providers?.['xopc-local'] ?? {}),
        model: DEFAULT_LOCAL_VOICE_MODEL_ID,
        language: profile.sttLanguage,
      },
    };
  }
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

/** Start the model download without delaying gateway readiness. */
export function prepareConfiguredLocalVoiceModel(config: Config): void {
  const audio = config.tools?.media?.audio;
  if (audio?.enabled === false || (audio?.provider ?? 'xopc-local') !== 'xopc-local') return;
  const configuredModel = audio?.providers?.['xopc-local']?.model;
  const modelId = typeof configuredModel === 'string' && configuredModel.trim()
    ? configuredModel.trim()
    : DEFAULT_LOCAL_VOICE_MODEL_ID;
  if (isLocalVoiceModelInstalled(modelId)) return;
  try {
    startLocalVoiceModelInstall(modelId);
    log.info({ modelId, phase: 'startup_prepare' }, 'Local voice model preparation started');
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    log.warn({ err, modelId, errorMessage, phase: 'startup_prepare' }, `Local voice model preparation failed: ${errorMessage}`);
  }
}
