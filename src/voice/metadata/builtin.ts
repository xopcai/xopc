import { registerVoiceProviderMetadata } from './registry.js';
import type { VoiceOptionMetadata, VoiceProviderMetadata } from './types.js';
import { MINIMAX_TTS_MODELS, MINIMAX_TTS_VOICES, OPENAI_TTS_MODELS, OPENAI_TTS_VOICES } from '../tts/providers/index.js';

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function options(values: readonly string[], names?: Record<string, string>): VoiceOptionMetadata[] {
  return values.map((id) => ({ id, name: names?.[id] ?? titleCase(id) }));
}

const alibabaSttModels = [
  { id: 'qwen-audio-3.0-asr-flash', name: 'Qwen Audio 3.0 ASR Flash' },
];

const localSttModels = [
  {
    id: 'sensevoice-small',
    name: 'SenseVoice Small 中文（推荐）',
    description: '约 230 MB · 普通话、粤语、中英混说',
  },
  { id: 'tiny', name: 'Whisper Tiny (Fastest)', description: 'About 45 MB' },
  { id: 'base', name: 'Whisper Base (Multilingual)', description: 'About 80 MB' },
  { id: 'small', name: 'Whisper Small (Higher quality)', description: 'About 245 MB' },
];

const alibabaTtsModels = [
  { id: 'qwen-tts', name: 'Qwen TTS (Recommended)' },
  { id: 'qwen-tts-realtime', name: 'Qwen TTS Realtime' },
  { id: 'qwen3-tts-flash', name: 'Qwen3 TTS Flash' },
  { id: 'qwen3-tts-instruct-flash', name: 'Qwen3 TTS Instruct Flash' },
];

const alibabaTtsVoices = [
  { id: 'Cherry', name: 'Cherry' },
  { id: 'Ethan', name: 'Ethan' },
  { id: 'Serena', name: 'Serena' },
  { id: 'Chelsie', name: 'Chelsie' },
  { id: 'longxiaochun', name: 'Long Xiao Chun (龙小春)' },
  { id: 'longxiaobai', name: 'Long Xiao Bai (龙小白)' },
  { id: 'longwan', name: 'Long Wan (龙婉)' },
  { id: 'longcheng', name: 'Long Cheng (龙呈)' },
];

const edgeVoices = [
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

export const builtinVoiceProviderMetadata: VoiceProviderMetadata[] = [
  {
    id: 'xopc-local',
    capability: 'stt',
    displayName: 'xopc Local Voice',
    description: 'Private on-device Chinese and multilingual transcription. Audio never leaves this device.',
    aliases: ['local'],
    models: localSttModels,
    fields: [
      { key: 'model', label: 'Model', type: 'select', options: localSttModels, defaultValue: 'sensevoice-small' },
      { key: 'language', label: 'Language hint', type: 'string', placeholder: 'zh' },
    ],
    diagnostics: { requiresApiKey: false, configPath: 'tools.media.audio.providers.xopc-local' },
  },
  {
    id: 'xopc-cloud',
    capability: 'stt',
    displayName: 'XOPC Cloud',
    description: 'OAuth-based speech recognition using models published by XOPC Cloud.',
    models: [],
    fields: [
      { key: 'model', label: 'Public model ID', type: 'string' },
      { key: 'language', label: 'Language hint', type: 'string', placeholder: 'zh' },
    ],
    diagnostics: { requiresApiKey: false, configPath: 'tools.media.audio.providers.xopc-cloud' },
  },
  {
    id: 'alibaba',
    capability: 'stt',
    displayName: 'Alibaba DashScope',
    description: 'DashScope Qwen Audio speech-to-text for Chinese and multilingual recognition.',
    aliases: ['dashscope'],
    models: alibabaSttModels,
    fields: [
      { key: 'apiKey', label: 'API Key', type: 'password', secret: true, placeholder: 'sk-...', description: 'DASHSCOPE_API_KEY' },
      { key: 'model', label: 'Model', type: 'select', options: alibabaSttModels, defaultValue: 'qwen-audio-3.0-asr-flash' },
      { key: 'language', label: 'Language hint', type: 'string', placeholder: 'zh' },
    ],
    diagnostics: { requiresApiKey: true, envKeys: ['DASHSCOPE_API_KEY'], configPath: 'tools.media.audio.providers.alibaba' },
  },
  {
    id: 'openai',
    capability: 'stt',
    displayName: 'OpenAI',
    description: 'OpenAI transcription endpoint.',
    models: [{ id: 'gpt-transcribe', name: 'GPT Transcribe' }, { id: 'gpt-4o-transcribe', name: 'GPT-4o Transcribe' }, { id: 'gpt-4o-mini-transcribe', name: 'GPT-4o Mini Transcribe' }],
    fields: [
      { key: 'apiKey', label: 'API Key', type: 'password', secret: true, placeholder: 'sk-...', description: 'OPENAI_API_KEY' },
      { key: 'model', label: 'Model', type: 'select', options: [{ id: 'gpt-transcribe', name: 'GPT Transcribe' }, { id: 'gpt-4o-transcribe', name: 'GPT-4o Transcribe' }, { id: 'gpt-4o-mini-transcribe', name: 'GPT-4o Mini Transcribe' }], defaultValue: 'gpt-transcribe' },
      { key: 'baseUrl', label: 'Base URL', type: 'string', placeholder: 'https://api.openai.com/v1' },
      { key: 'language', label: 'Language hint', type: 'string', placeholder: 'en' },
      { key: 'prompt', label: 'Prompt', type: 'textarea' },
    ],
    diagnostics: { requiresApiKey: true, envKeys: ['OPENAI_API_KEY'], configPath: 'tools.media.audio.providers.openai' },
  },
  {
    id: 'xopc-cloud',
    capability: 'tts',
    displayName: 'XOPC Cloud',
    description: 'OAuth-based speech synthesis using models and voices published by XOPC Cloud.',
    models: [],
    voices: [],
    fields: [
      { key: 'model', label: 'Public model ID', type: 'string' },
      { key: 'voice', label: 'Voice ID', type: 'string' },
      { key: 'speed', label: 'Speed', type: 'number', defaultValue: 1, min: 0.25, max: 4, step: 0.05, description: 'Speech speed from 0.25× to 4×.' },
      { key: 'instructions', label: 'Speaking instructions', type: 'textarea', placeholder: 'Speak warmly and clearly.' },
    ],
    diagnostics: { requiresApiKey: false, configPath: 'messages.tts.providers.xopc-cloud' },
  },
  {
    id: 'openai',
    capability: 'tts',
    displayName: 'OpenAI',
    description: 'OpenAI speech synthesis with multiple voices.',
    models: options(OPENAI_TTS_MODELS, {
      'gpt-4o-mini-tts': 'GPT-4o Mini TTS (Latest)',
      'tts-1': 'TTS-1 (Fast)',
      'tts-1-hd': 'TTS-1 HD (High Quality)',
    }),
    voices: options(OPENAI_TTS_VOICES),
    fields: [
      { key: 'apiKey', label: 'API Key', type: 'password', secret: true, placeholder: 'sk-...', description: 'OPENAI_API_KEY' },
      { key: 'model', label: 'Model', type: 'select', options: options(OPENAI_TTS_MODELS), defaultValue: 'tts-1' },
      { key: 'voice', label: 'Voice', type: 'select', options: options(OPENAI_TTS_VOICES), defaultValue: 'alloy' },
      { key: 'baseUrl', label: 'Base URL', type: 'string', placeholder: 'https://api.openai.com/v1' },
    ],
    diagnostics: { requiresApiKey: true, envKeys: ['OPENAI_API_KEY'], configPath: 'messages.tts.providers.openai' },
  },
  {
    id: 'alibaba',
    capability: 'tts',
    displayName: 'Alibaba DashScope',
    description: 'DashScope Qwen TTS, strong Chinese voice quality.',
    models: alibabaTtsModels,
    voices: alibabaTtsVoices,
    fields: [
      { key: 'apiKey', label: 'API Key', type: 'password', secret: true, placeholder: 'sk-...', description: 'DASHSCOPE_API_KEY' },
      { key: 'model', label: 'Model', type: 'select', options: alibabaTtsModels, defaultValue: 'qwen-tts' },
      { key: 'voice', label: 'Voice', type: 'select', options: alibabaTtsVoices, defaultValue: 'longxiaochun' },
    ],
    diagnostics: { requiresApiKey: true, envKeys: ['DASHSCOPE_API_KEY'], configPath: 'messages.tts.providers.alibaba' },
  },
  {
    id: 'minimax',
    capability: 'tts',
    displayName: 'MiniMax',
    description: 'MiniMax high-quality async text-to-speech.',
    models: options(MINIMAX_TTS_MODELS),
    voices: options(MINIMAX_TTS_VOICES),
    fields: [
      { key: 'apiKey', label: 'API Key', type: 'password', secret: true, placeholder: 'eyJ...', description: 'MINIMAX_API_KEY' },
      { key: 'model', label: 'Model', type: 'select', options: options(MINIMAX_TTS_MODELS), defaultValue: 'speech-2.8-hd' },
      { key: 'voice', label: 'Voice', type: 'select', options: options(MINIMAX_TTS_VOICES), defaultValue: 'male-qn-qingse' },
      { key: 'baseUrl', label: 'Base URL', type: 'string', placeholder: 'https://api.minimaxi.com/v1' },
      { key: 'groupId', label: 'Group ID', type: 'string' },
    ],
    diagnostics: { requiresApiKey: true, envKeys: ['MINIMAX_API_KEY'], configPath: 'messages.tts.providers.minimax' },
  },
  {
    id: 'edge',
    capability: 'tts',
    displayName: 'Microsoft Edge',
    description: 'Free Edge TTS endpoint, no API key required.',
    models: [{ id: 'edge-default', name: 'Edge TTS (Free)' }],
    voices: edgeVoices,
    fields: [
      { key: 'voice', label: 'Voice', type: 'select', options: edgeVoices, defaultValue: 'en-US-MichelleNeural' },
      { key: 'lang', label: 'Language', type: 'string', placeholder: 'en-US' },
      { key: 'outputFormat', label: 'Output format', type: 'string', placeholder: 'audio-24khz-48kbitrate-mono-mp3' },
      { key: 'rate', label: 'Rate', type: 'string', placeholder: '+0%' },
      { key: 'pitch', label: 'Pitch', type: 'string', placeholder: '+0Hz' },
      { key: 'volume', label: 'Volume', type: 'string', placeholder: '+0%' },
      { key: 'proxy', label: 'Proxy', type: 'string' },
    ],
    diagnostics: { requiresApiKey: false, configPath: 'messages.tts.providers.edge' },
  },
];

for (const metadata of builtinVoiceProviderMetadata) {
  registerVoiceProviderMetadata(metadata);
}
