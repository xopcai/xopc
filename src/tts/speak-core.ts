import type {
  TTSOptions,
  TTSConfig,
  TTSProvider,
  TTSModelOverrideConfig,
  TTSResultWithTracking,
  ProviderAttempt,
  ProviderFailureReason,
} from './types.js';
import { createSingleProvider, resolveProviderOrder } from './factory.js';
import { preprocessText, type PreprocessOptions, type PreprocessResult } from './preprocess.js';
import { parseTtsDirectives } from './directives.js';
import { summarizeForTts } from './summarize.js';
import { createLogger } from '../utils/logger.js';
import type { Config } from '../config/schema.js';

const log = createLogger('TTS');

export interface SpeakOptions {
  tts?: TTSOptions;
  preprocess?: PreprocessOptions;
  parseDirectives?: boolean;
  modelOverrides?: TTSModelOverrideConfig;
  appConfig?: Config;
}

function classifyError(error: unknown): ProviderFailureReason {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    if (message.includes('not configured') || message.includes('api key')) {
      return 'not_configured';
    }
    if (message.includes('timeout') || message.includes('timed out') || message.includes('aborted')) {
      return 'timeout';
    }
    if (message.includes('too long') || message.includes('text length')) {
      return 'text_too_long';
    }
    return 'provider_error';
  }
  return 'unknown';
}

export async function speak(
  text: string,
  config: TTSConfig,
  options?: SpeakOptions,
): Promise<TTSResultWithTracking> {
  if (!config.enabled) {
    throw new Error('TTS is not enabled');
  }

  if (config.trigger === 'tagged') {
    const hasTtsDirective = /\[\[tts/.test(text);
    if (!hasTtsDirective) {
      throw new Error('TTS trigger is tagged but no [[tts]] directive found');
    }
  }

  let ttsText = text;
  let wasPreprocessed = false;

  if (options?.parseDirectives !== false && config.modelOverrides?.enabled) {
    const directiveResult = parseTtsDirectives(text, config.modelOverrides);
    ttsText = directiveResult.ttsText || directiveResult.cleanedText;

    if (directiveResult.overrides) {
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

  const maxLength = config.maxTextLength || 4096;
  const preprocessOptions: PreprocessOptions = {
    maxLength,
    stripMarkdown: true,
    normalizeWhitespace: true,
    ...options?.preprocess,
  };

  let preprocessResult: PreprocessResult = preprocessText(ttsText, preprocessOptions);
  wasPreprocessed =
    preprocessResult.wasTruncated || preprocessResult.originalLength !== preprocessResult.finalLength;

  let wasSummarized = false;
  const sumCfg = config.summarization;
  const threshold = sumCfg?.threshold ?? maxLength;
  if (sumCfg?.enabled !== false && preprocessResult.text.length > threshold) {
    const summarizeResult = await summarizeForTts({
      text: preprocessResult.text,
      targetLength: sumCfg?.targetLength ?? maxLength,
      config: options?.appConfig,
      modelRef: sumCfg?.model,
    });

    if (summarizeResult.wasSummarized) {
      preprocessResult = {
        ...preprocessResult,
        text: summarizeResult.summary,
        finalLength: summarizeResult.summaryLength,
        wasTruncated: false,
      };
      wasSummarized = true;
      log.info(
        {
          originalLength: summarizeResult.originalLength,
          summaryLength: summarizeResult.summaryLength,
        },
        'Text summarized before TTS',
      );
    }
  }

  const attempts: ProviderAttempt[] = [];
  const attemptedProviders: string[] = [];
  let lastError: Error | undefined;

  const providerOrder = resolveProviderOrder(config.provider, config.fallback);

  for (const providerName of providerOrder) {
    const startTime = Date.now();
    attemptedProviders.push(providerName);

    const provider = createSingleProvider(providerName, config);

    if (!provider || !provider.isConfigured()) {
      attempts.push({
        provider: providerName,
        outcome: 'skipped',
        reasonCode: 'not_configured',
        latencyMs: Date.now() - startTime,
      });
      continue;
    }

    try {
      log.debug(
        {
          textLength: preprocessResult.text.length,
          provider: provider.name,
        },
        'Converting text to speech',
      );

      const result = await provider.speak(preprocessResult.text, options?.tts);
      const latencyMs = Date.now() - startTime;

      attempts.push({
        provider: providerName,
        outcome: 'success',
        reasonCode: 'success',
        latencyMs,
      });

      const primaryProvider = providerOrder[0]!;
      const fallbackFrom = providerName !== primaryProvider ? primaryProvider : undefined;

      if (fallbackFrom) {
        log.info(
          {
            primaryProvider: fallbackFrom,
            actualProvider: result.provider,
            attempts,
          },
          'TTS used fallback provider',
        );
      } else {
        log.info(
          {
            provider: provider.name,
            format: result.format,
            size: result.audio.length,
          },
          'TTS succeeded',
        );
      }

      return {
        ...result,
        attempts,
        fallbackFrom,
        attemptedProviders,
        wasPreprocessed,
        ttsText: preprocessResult.text,
        wasSummarized,
      };
    } catch (error) {
      const latencyMs = Date.now() - startTime;
      const reasonCode = classifyError(error);
      const errorMsg = error instanceof Error ? error.message : String(error);

      attempts.push({
        provider: providerName,
        outcome: 'failed',
        reasonCode,
        latencyMs,
        error: errorMsg,
      });

      lastError = error instanceof Error ? error : new Error(String(error));
      log.warn(
        { provider: providerName, errorMessage: errorMsg, reasonCode, latencyMs },
        'TTS provider failed, trying next',
      );
    }
  }

  log.error({ attempts, attemptedProviders }, 'All TTS providers failed');
  throw lastError || new Error(`All TTS providers failed: ${attempts.map((a) => a.error).join('; ')}`);
}

export async function speakWithProvider(
  text: string,
  config: TTSConfig,
  providerName: TTSProvider,
  options?: SpeakOptions,
): Promise<TTSResultWithTracking> {
  if (!config.enabled) {
    throw new Error('TTS is not enabled');
  }

  const maxLength = config.maxTextLength || 4096;
  const preprocessOptions: PreprocessOptions = {
    maxLength,
    stripMarkdown: true,
    normalizeWhitespace: true,
    ...options?.preprocess,
  };

  let preprocessResult = preprocessText(text, preprocessOptions);
  let wasSummarized = false;
  const sumCfg = config.summarization;
  const threshold = sumCfg?.threshold ?? maxLength;
  if (sumCfg?.enabled !== false && preprocessResult.text.length > threshold) {
    const summarizeResult = await summarizeForTts({
      text: preprocessResult.text,
      targetLength: sumCfg?.targetLength ?? maxLength,
      config: options?.appConfig,
      modelRef: sumCfg?.model,
    });
    if (summarizeResult.wasSummarized) {
      preprocessResult = {
        ...preprocessResult,
        text: summarizeResult.summary,
        finalLength: summarizeResult.summaryLength,
        wasTruncated: false,
      };
      wasSummarized = true;
    }
  }

  const provider = createSingleProvider(providerName, config);

  if (!provider) {
    throw new Error(`Provider '${providerName}' is not available`);
  }

  const startTime = Date.now();
  const result = await provider.speak(preprocessResult.text, options?.tts);
  const latencyMs = Date.now() - startTime;
  return {
    ...result,
    attempts: [
      {
        provider: providerName,
        outcome: 'success',
        reasonCode: 'success',
        latencyMs,
      },
    ],
    attemptedProviders: [providerName],
    wasPreprocessed:
      preprocessResult.wasTruncated || preprocessResult.originalLength !== preprocessResult.finalLength,
    ttsText: preprocessResult.text,
    wasSummarized,
  };
}
