/**
 * TTS (Text-to-Speech) Module
 *
 * Unified interface for multiple TTS providers with fallback support
 */

export { speak, speakWithProvider, type SpeakOptions } from './speak-core.js';

/**
 * Check if TTS is available with current configuration
 */
export { isTTSAvailable, isProviderConfigured, getAvailableProviders } from './factory.js';

export {
  mergeTtsConfigFromAppConfig,
  formatTtsSetupHint,
  appendTtsReadinessNote,
} from './merge-config.js';

/**
 * Preprocess text for TTS
 */
export { preprocessText, type PreprocessOptions, type PreprocessResult } from './preprocess.js';

/**
 * Parse TTS directives
 */
export { parseTtsDirectives, hasTtsDirectives, stripTtsDirectives, buildTtsSystemPromptHint } from './directives.js';

export { ttsStatusTracker, recordTtsSuccess, recordTtsFailure } from './status-tracker.js';

export type {
  TTSResult,
  TTSOptions,
  TTSConfig,
  TTSProvider,
  TTSAutoMode,
  TTSModelOverrideConfig,
  TtsDirectiveParseResult,
  TtsDirectiveOverrides,
  TTSResultWithTracking,
  ProviderAttempt,
  ProviderFailureReason,
  TtsStatusEntry,
  TtsRuntimeStatus,
  TTSSummarizationConfig,
} from './types.js';

// Re-export the registered SpeechProviderPlugin instances + UI constants.
export {
  openAiSpeechProvider,
  alibabaSpeechProvider,
  edgeSpeechProvider,
  minimaxSpeechProvider,
  OPENAI_TTS_MODELS,
  OPENAI_TTS_VOICES,
  MINIMAX_TTS_MODELS,
  MINIMAX_TTS_VOICES,
} from './providers/index.js';

export type {
  SpeechProviderPlugin,
  SpeechProviderId,
  SpeechProviderConfig,
  SpeechSynthesisRequest,
  SpeechSynthesisResult,
  SpeechSynthesisStreamRequest,
  SpeechSynthesisStreamResult,
  SpeechVoiceOption,
  SpeechModelOverridePolicy,
  SpeechDirectiveTokenParseContext,
  SpeechDirectiveTokenParseResult,
} from './speech-provider-types.js';

export {
  registerSpeechProvider,
  getSpeechProvider,
  listSpeechProviders,
} from './speech-registry.js';

export {
  resolveSpeechProvider,
  resolveSpeechProviderChain,
  resolveProviderOrder,
  listRegisteredSpeechProviderIds,
  type ResolvedSpeechProvider,
} from './factory.js';

export { speakStream, type SpeakStreamResult } from './speak-core.js';

export {
  TTSService,
  shouldUseTTS,
  getChannelOutputFormat,
  getSupportedChannels,
  isVoiceCompatibleChannel,
  type TTSContext,
  type TTSDecision,
  type ChannelAudioFormat,
} from './service.js';

export {
  maybeApplyTtsToPayload,
  isTtsEnabled,
  resolveTtsAutoMode,
  type TTSApplyOptions,
} from './payload.js';
