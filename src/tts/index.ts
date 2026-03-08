/**
 * TTS (Text-to-Speech) Module
 *
 * Unified interface for multiple TTS providers with fallback support
 */

import type { TTSResult, TTSOptions, TTSConfig, TTSProvider, TTSModelOverrideConfig } from './types.js';
import { createTTSProviderChain } from './factory.js';
import { preprocessText, type PreprocessOptions } from './preprocess.js';
import { parseTtsDirectives } from './directives.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('TTS');

export interface SpeakOptions {
  /** TTS options */
  tts?: TTSOptions;
  /** Preprocessing options */
  preprocess?: PreprocessOptions;
  /** Whether to parse and apply TTS directives from text */
  parseDirectives?: boolean;
  /** Model override policy for directives */
  modelOverrides?: TTSModelOverrideConfig;
}

/**
 * Check if TTS is available with current configuration
 */
export { isTTSAvailable, isProviderConfigured, getAvailableProviders } from './factory.js';

/**
 * Preprocess text for TTS
 */
export { preprocessText, type PreprocessOptions, type PreprocessResult } from './preprocess.js';

/**
 * Parse TTS directives
 */
export { parseTtsDirectives, hasTtsDirectives, stripTtsDirectives, buildTtsSystemPromptHint } from './directives.js';

/**
 * Convert text to speech with fallback chain and preprocessing
 * Simplified: no AI intent detection, purely config-based
 */
export async function speak(
  text: string,
  config: TTSConfig,
  options?: SpeakOptions
): Promise<TTSResult & { wasPreprocessed?: boolean; ttsText?: string }> {
  if (!config.enabled) {
    throw new Error('TTS is not enabled');
  }

  // Simple tagged mode check: look for [[tts]] directive
  if (config.trigger === 'tagged') {
    const hasTtsDirective = /\[\[tts/.test(text);
    if (!hasTtsDirective) {
      throw new Error('TTS trigger is tagged but no [[tts]] directive found');
    }
  }

  let ttsText = text;
  let wasPreprocessed = false;

  // Step 1: Parse TTS directives for voice/model overrides (optional)
  if (options?.parseDirectives !== false && config.modelOverrides?.enabled) {
    const directiveResult = parseTtsDirectives(text, config.modelOverrides);
    ttsText = directiveResult.ttsText || directiveResult.cleanedText;

    if (directiveResult.overrides) {
      // Apply voice overrides to options
      if (!options?.tts) options = { tts: {} };
      if (directiveResult.overrides.openai?.voice) {
        options.tts!.voice = directiveResult.overrides.openai.voice;
      }
      if (directiveResult.overrides.alibaba?.voice) {
        options.tts!.voice = directiveResult.overrides.alibaba.voice;
      }
      if (directiveResult.overrides.edge?.voice) {
        options.tts!.voice = directiveResult.overrides.edge.voice;
      }
    }
  }

  // Step 2: Preprocess text (strip markdown, normalize)
  const preprocessOptions: PreprocessOptions = {
    maxLength: config.maxTextLength || 4096,
    stripMarkdown: true,
    normalizeWhitespace: true,
    ...options?.preprocess,
  };

  const preprocessResult = preprocessText(ttsText, preprocessOptions);
  wasPreprocessed = preprocessResult.wasTruncated || 
    preprocessResult.originalLength !== preprocessResult.finalLength;

  // Step 3: Convert to speech with fallback chain
  const providers = createTTSProviderChain(config);
  const errors: string[] = [];

  for (const provider of providers) {
    try {
      log.debug({
        textLength: preprocessResult.text.length,
        provider: provider.name,
      }, 'Converting text to speech');

      const result = await provider.speak(preprocessResult.text, options?.tts);

      log.info({
        provider: provider.name,
        format: result.format,
        size: result.audio.length,
      }, 'TTS succeeded');

      return {
        ...result,
        wasPreprocessed,
        ttsText: preprocessResult.text,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      log.warn({
        provider: provider.name,
        error: errorMsg,
      }, 'TTS provider failed, trying next');
      errors.push(`${provider.name}: ${errorMsg}`);
    }
  }

  throw new Error(`All TTS providers failed: ${errors.join('; ')}`);
}

/**
 * Convert text to speech with a specific provider
 */
export async function speakWithProvider(
  text: string,
  config: TTSConfig,
  providerName: TTSProvider,
  options?: SpeakOptions
): Promise<TTSResult & { wasPreprocessed?: boolean; ttsText?: string }> {
  if (!config.enabled) {
    throw new Error('TTS is not enabled');
  }

  // Preprocess text
  const preprocessOptions: PreprocessOptions = {
    maxLength: config.maxTextLength || 4096,
    stripMarkdown: true,
    normalizeWhitespace: true,
    ...options?.preprocess,
  };

  const preprocessResult = preprocessText(text, preprocessOptions);

  const { createSingleProvider } = await import('./factory.js');
  const provider = createSingleProvider(providerName, config);

  if (!provider) {
    throw new Error(`Provider '${providerName}' is not available`);
  }

  const result = await provider.speak(preprocessResult.text, options?.tts);

  return {
    ...result,
    wasPreprocessed: preprocessResult.wasTruncated,
    ttsText: preprocessResult.text,
  };
}

// Re-export types
export type {
  TTSResult,
  TTSOptions,
  TTSConfig,
  TTSProvider,
  TTSAutoMode,
  TTSModelOverrideConfig,
  TtsDirectiveParseResult,
  TtsDirectiveOverrides,
} from './types.js';

// Re-export providers
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

// Re-export factory functions
export {
  createTTSProviderChain,
  createSingleProvider,
  resolveProviderOrder,
} from './factory.js';

// Re-export service
export {
  TTSService,
  shouldUseTTS,
  getChannelOutputFormat,
  type TTSContext,
  type TTSDecision,
} from './service.js';

// Re-export payload processing (OpenClaw-style)
export {
  maybeApplyTtsToPayload,
  isTtsEnabled,
  resolveTtsAutoMode,
  type TTSApplyOptions,
} from './payload.js';
