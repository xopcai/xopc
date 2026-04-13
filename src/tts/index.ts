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

export {
  BaseTTSProvider,
  type BaseProviderConfig,
  OpenAIProvider,
  type OpenAIProviderConfig,
  OPENAI_TTS_MODELS,
  OPENAI_TTS_VOICES,
  isValidOpenAIVoice,
  isValidOpenAIModel,
  AlibabaProvider,
  type AlibabaProviderConfig,
  EdgeProvider,
  type EdgeProviderConfig,
  inferEdgeExtension,
} from './providers/index.js';

export {
  createTTSProviderChain,
  createSingleProvider,
  resolveProviderOrder,
} from './factory.js';

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
