/**
 * TTS provider barrel.
 *
 * Each `*-speech.ts` module SELF-REGISTERS into the SpeechProviderRegistry at
 * import time. Importing this barrel is the canonical way to ensure all 4
 * built-in providers are registered before the TTS factory looks them up.
 *
 * NOTE: We export the per-provider plugin objects so callers (e.g. tests, the
 * gateway console) can introspect them, but the registry-driven path
 * (`getSpeechProvider(id)`) is the only supported runtime API. Direct imports
 * of these objects bypass discoverability of registry overrides made by
 * extensions.
 */

export { openAiSpeechProvider, OPENAI_TTS_MODELS, OPENAI_TTS_VOICES } from './openai-speech.js';
export { alibabaSpeechProvider } from './alibaba-speech.js';
export { edgeSpeechProvider } from './edge-speech.js';
export { xopcCloudSpeechProvider } from './xopc-cloud-speech.js';
export {
  minimaxSpeechProvider,
  MINIMAX_TTS_MODELS,
  MINIMAX_TTS_VOICES,
} from './minimax-speech.js';
