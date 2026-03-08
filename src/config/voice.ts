/**
 * Voice (STT/TTS) Model Configuration
 * 
 * This module provides available STT/TTS models for the UI.
 * Models can be extended via config file or environment variables.
 */

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
  };
  ttsVoices: {
    alibaba: VoiceModel[];
    openai: VoiceModel[];
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

// Default TTS models
const DEFAULT_TTS_ALIBABA: VoiceModel[] = [
  { id: 'qwen-tts', name: 'Qwen TTS (Recommended)' },
  { id: 'qwen-tts-realtime', name: 'Qwen TTS Realtime' },
  { id: 'qwen3-tts-flash', name: 'Qwen3 TTS Flash' },
  { id: 'qwen3-tts-instruct-flash', name: 'Qwen3 TTS Instruct Flash' },
];

const DEFAULT_TTS_OPENAI: VoiceModel[] = [
  { id: 'tts-1', name: 'TTS-1 (Fast)' },
  { id: 'tts-1-hd', name: 'TTS-1 HD (High Quality)' },
];

// Default TTS voices
const DEFAULT_TTS_VOICES_ALIBABA: VoiceModel[] = [
  { id: 'Cherry', name: 'Cherry' },
  { id: 'longxiaochun', name: 'Long Xiao Chun' },
  { id: 'longcheng', name: 'Long Cheng' },
  { id: 'xiaogang', name: 'Xiao Gang' },
  { id: 'xiaoxian', name: 'Xiao Xian' },
];

const DEFAULT_TTS_VOICES_OPENAI: VoiceModel[] = [
  { id: 'alloy', name: 'Alloy' },
  { id: 'echo', name: 'Echo' },
  { id: 'fable', name: 'Fable' },
  { id: 'onyx', name: 'Onyx' },
  { id: 'nova', name: 'Nova' },
  { id: 'shimmer', name: 'Shimmer' },
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
    },
    ttsVoices: {
      alibaba: DEFAULT_TTS_VOICES_ALIBABA,
      openai: DEFAULT_TTS_VOICES_OPENAI,
    },
  };
}
