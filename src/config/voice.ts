/**
 * Voice (STT/TTS) Model Configuration
 *
 * This module provides available STT/TTS models for the UI.
 * Models can be extended via config file or environment variables.
 */

import { OPENAI_TTS_MODELS, OPENAI_TTS_VOICES } from '../voice/tts/index.js';

export interface VoiceModel {
  id: string;
  name: string;
  description?: string;
}

export interface VoiceModelsConfig {
  stt: {
    alibaba: VoiceModel[];
    openai: VoiceModel[];
  };
  tts: {
    alibaba: VoiceModel[];
    openai: VoiceModel[];
    edge: VoiceModel[];
    minimax: VoiceModel[];
  };
  ttsVoices: {
    alibaba: VoiceModel[];
    openai: VoiceModel[];
    edge: VoiceModel[];
    minimax: VoiceModel[];
  };
}

// Default STT models
const DEFAULT_STT_ALIBABA: VoiceModel[] = [
  { id: 'paraformer-v2', name: 'Paraformer v2 (Recommended)' },
  { id: 'paraformer-v1', name: 'Paraformer v1' },
  { id: 'paraformer-8k-v1', name: 'Paraformer 8k v1 (Phone)' },
  { id: 'paraformer-mtl-v1', name: 'Paraformer MTL v1 (Multilingual)' },
];

const DEFAULT_STT_OPENAI: VoiceModel[] = [
  { id: 'whisper-1', name: 'Whisper-1' },
];

// Default TTS models - dynamically from TTS module
const DEFAULT_TTS_OPENAI: VoiceModel[] = OPENAI_TTS_MODELS.map(id => ({
  id,
  name: id === 'tts-1' ? 'TTS-1 (Fast)' :
        id === 'tts-1-hd' ? 'TTS-1 HD (High Quality)' :
        id === 'gpt-4o-mini-tts' ? 'GPT-4o Mini TTS (Latest)' :
        id,
}));

const DEFAULT_TTS_ALIBABA: VoiceModel[] = [
  { id: 'qwen-tts', name: 'Qwen TTS (Recommended)' },
  { id: 'qwen-tts-realtime', name: 'Qwen TTS Realtime' },
  { id: 'qwen3-tts-flash', name: 'Qwen3 TTS Flash' },
  { id: 'qwen3-tts-instruct-flash', name: 'Qwen3 TTS Instruct Flash' },
];

const DEFAULT_TTS_EDGE: VoiceModel[] = [
  { id: 'edge-default', name: 'Edge TTS (Free)' },
];

const DEFAULT_TTS_MINIMAX: VoiceModel[] = [
  { id: 'speech-2.8-hd', name: 'Speech 2.8 HD (Recommended)' },
  { id: 'speech-2.8-turbo', name: 'Speech 2.8 Turbo (Fast)' },
  { id: 'speech-2.6-hd', name: 'Speech 2.6 HD' },
  { id: 'speech-2.6-turbo', name: 'Speech 2.6 Turbo' },
  { id: 'speech-02-hd', name: 'Speech 02 HD' },
  { id: 'speech-02-turbo', name: 'Speech 02 Turbo' },
];

// Default TTS voices
const DEFAULT_TTS_VOICES_ALIBABA: VoiceModel[] = [
  { id: 'Cherry', name: 'Cherry' },
  { id: 'longxiaochun', name: 'Long Xiao Chun (龙小春)' },
  { id: 'longcheng', name: 'Long Cheng (龙呈)' },
  { id: 'xiaogang', name: 'Xiao Gang (小刚)' },
  { id: 'xiaoxian', name: 'Xiao Xian (小娴)' },
];

const DEFAULT_TTS_VOICES_OPENAI: VoiceModel[] = OPENAI_TTS_VOICES.map(id => ({
  id,
  name: id.charAt(0).toUpperCase() + id.slice(1),
}));

// Edge TTS popular voices
const DEFAULT_TTS_VOICES_MINIMAX: VoiceModel[] = [
  { id: 'male-qn-qingse', name: 'Male Qingse (青涩男声)' },
  { id: 'male-qn-jingying', name: 'Male Jingying (精英男声)' },
  { id: 'male-qn-badao', name: 'Male Badao (霸道男声)' },
  { id: 'male-qn-daxuesheng', name: 'Male Daxuesheng (大学生男声)' },
  { id: 'female-shaonv', name: 'Female Shaonv (少女音)' },
  { id: 'female-yujie', name: 'Female Yujie (御姐音)' },
  { id: 'female-chengshu', name: 'Female Chengshu (成熟女声)' },
  { id: 'female-tianmei', name: 'Female Tianmei (甜美女声)' },
  { id: 'audiobook_male_1', name: 'Audiobook Male 1' },
  { id: 'audiobook_male_2', name: 'Audiobook Male 2' },
  { id: 'audiobook_female_1', name: 'Audiobook Female 1' },
  { id: 'audiobook_female_2', name: 'Audiobook Female 2' },
  { id: 'presenter_male', name: 'Presenter Male' },
  { id: 'presenter_female', name: 'Presenter Female' },
];

const DEFAULT_TTS_VOICES_EDGE: VoiceModel[] = [
  { id: 'en-US-MichelleNeural', name: 'Michelle (US English, Female)' },
  { id: 'en-US-JennyNeural', name: 'Jenny (US English, Female)' },
  { id: 'en-US-GuyNeural', name: 'Guy (US English, Male)' },
  { id: 'en-GB-SoniaNeural', name: 'Sonia (UK English, Female)' },
  { id: 'en-GB-RyanNeural', name: 'Ryan (UK English, Male)' },
  { id: 'zh-CN-XiaoxiaoNeural', name: '晓晓 (中文, 女声)' },
  { id: 'zh-CN-YunyangNeural', name: '云扬 (中文, 男声)' },
  { id: 'zh-CN-XiaoyiNeural', name: '晓伊 (中文, 女声)' },
  { id: 'ja-JP-NanamiNeural', name: '七海 (日本語, 女性)' },
  { id: 'de-DE-KatjaNeural', name: 'Katja (Deutsch, Weiblich)' },
  { id: 'fr-FR-DeniseNeural', name: 'Denise (Français, Féminin)' },
  { id: 'es-ES-ElviraNeural', name: 'Elvira (Español, Femenino)' },
];

export function getVoiceModelsConfig(): VoiceModelsConfig {
  return {
    stt: {
      alibaba: DEFAULT_STT_ALIBABA,
      openai: DEFAULT_STT_OPENAI,
    },
    tts: {
      alibaba: DEFAULT_TTS_ALIBABA,
      openai: DEFAULT_TTS_OPENAI,
      edge: DEFAULT_TTS_EDGE,
      minimax: DEFAULT_TTS_MINIMAX,
    },
    ttsVoices: {
      alibaba: DEFAULT_TTS_VOICES_ALIBABA,
      openai: DEFAULT_TTS_VOICES_OPENAI,
      edge: DEFAULT_TTS_VOICES_EDGE,
      minimax: DEFAULT_TTS_VOICES_MINIMAX,
    },
  };
}

/**
 * Get available TTS providers for UI
 */
export function getTTSProviders(): Array<{ id: string; name: string; description?: string }> {
  return [
    { id: 'openai', name: 'OpenAI', description: 'High quality, multiple voices' },
    { id: 'alibaba', name: 'Alibaba', description: 'Qwen TTS, good for Chinese' },
    { id: 'minimax', name: 'MiniMax', description: 'High quality, 40+ languages' },
    { id: 'edge', name: 'Microsoft Edge', description: 'Free, 100+ voices, multi-language' },
  ];
}

/**
 * Get TTS trigger modes for UI
 */
export function getTTSTriggerModes(): Array<{ id: string; name: string; description: string }> {
  return [
    { id: 'off', name: 'Disabled', description: 'TTS is completely disabled' },
    { id: 'always', name: 'Always', description: 'Apply TTS to all messages' },
    { id: 'inbound', name: 'Inbound Audio', description: 'Only when user sends voice message' },
    { id: 'tagged', name: 'Tagged', description: 'Only when [[tts]] directive is used' },
  ];
}
