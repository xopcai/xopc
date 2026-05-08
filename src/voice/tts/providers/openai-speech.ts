/**
 * OpenAI TTS provider — built via createOpenAiCompatibleSpeechProvider factory.
 *
 * Env: OPENAI_API_KEY, OPENAI_TTS_BASE_URL (optional override).
 *
 * `OPENAI_TTS_MODELS` / `OPENAI_TTS_VOICES` are exported because the gateway
 * console imports them for UI dropdowns. The factory's `models` / `voices`
 * arrays are used only for `listVoices` discovery; runtime calls accept any
 * string so custom OpenAI-compatible endpoints work without enumeration.
 *
 * Resolution priority for base URL: providerConfig > OPENAI_TTS_BASE_URL env >
 * https://api.openai.com/v1 (env is read at module load time below).
 */

import { createOpenAiCompatibleSpeechProvider } from '../openai-compatible-speech.js';
import { registerSpeechProvider } from '../speech-registry.js';

export const OPENAI_TTS_MODELS = [
  'gpt-4o-mini-tts',
  'tts-1',
  'tts-1-hd',
] as const;

export const OPENAI_TTS_VOICES = [
  'alloy',
  'ash',
  'ballad',
  'cedar',
  'coral',
  'echo',
  'fable',
  'juniper',
  'marin',
  'onyx',
  'nova',
  'sage',
  'shimmer',
  'verse',
] as const;

const DEFAULT_BASE_URL =
  process.env.OPENAI_TTS_BASE_URL?.trim().replace(/\/+$/, '') ?? 'https://api.openai.com/v1';

export const openAiSpeechProvider = createOpenAiCompatibleSpeechProvider({
  id: 'openai',
  label: 'OpenAI',
  autoSelectOrder: 10,
  models: OPENAI_TTS_MODELS,
  voices: OPENAI_TTS_VOICES,
  defaultModel: 'tts-1',
  defaultVoice: 'alloy',
  defaultBaseUrl: DEFAULT_BASE_URL,
  envKey: 'OPENAI_API_KEY',
  responseFormats: ['opus', 'mp3', 'aac', 'flac', 'wav', 'pcm'],
  defaultResponseFormat: 'opus',
  voiceCompatibleResponseFormats: ['opus'],
  apiErrorLabel: 'OpenAI TTS error',
  missingApiKeyError: 'OpenAI TTS API key missing (set OPENAI_API_KEY or providers.openai.apiKey)',
});

// Self-register at module load so the registry is populated when this file is
// imported via providers/index.ts (side-effect aggregator).
registerSpeechProvider(openAiSpeechProvider);
