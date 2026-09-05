/**
 * speak-core — orchestrates per-call TTS synthesis through the SpeechProviderPlugin chain.
 *
 * Provider invocation goes through `plugin.synthesize` / `plugin.synthesizeStream`.
 * Streaming consumers (Telegram draft etc.) use `speakStream`; providers without
 * `synthesizeStream` automatically fall back to `synthesize` wrapped as a
 * single-chunk ReadableStream (see wrapBufferAsStream).
 *
 * Directive overrides are routed via per-provider buckets (`overrides.openai`,
 * `overrides.minimax`, …). The bucket whose key matches the currently active
 * provider id wins; cross-provider keys are ignored.
 *
 * `cfg: Config` is threaded through `SpeakOptions.appConfig`. The orchestrator
 * does NOT auto-summarize / preprocess for `speakStream` beyond the same path
 * as `speak`; streaming is a transport optimization, not a different semantic.
 */

import type { Config } from '../../config/schema.js';
import { createLogger } from '../../utils/logger.js';

import { parseTtsDirectives } from './directives.js';
import { resolveSpeechProviderChain, resolveSpeechProvider, type ResolvedSpeechProvider } from './factory.js';
import { preprocessText, type PreprocessOptions, type PreprocessResult } from './preprocess.js';
import type {
  SpeechProviderOverrides,
  SpeechSynthesisRequest,
  SpeechSynthesisResult,
  SpeechSynthesisStreamRequest,
  SpeechSynthesisStreamResult,
} from './speech-provider-types.js';
import { summarizeForTts } from './summarize.js';
import type {
  ProviderAttempt,
  ProviderFailureReason,
  TTSConfig,
  TTSModelOverrideConfig,
  TTSOptions,
  TTSProvider,
  TTSResultWithTracking,
  TtsDirectiveOverrides,
} from './types.js';

const log = createLogger('TTS');

export interface SpeakOptions {
  tts?: TTSOptions;
  preprocess?: PreprocessOptions;
  parseDirectives?: boolean;
  modelOverrides?: TTSModelOverrideConfig;
  appConfig?: Config;
  /** Optional caller-supplied cancellation signal. */
  signal?: AbortSignal;
}

export interface SpeakStreamOptions extends SpeakOptions {
  /** Disable provider/model fallback after a realtime route has been selected. */
  allowFallback?: boolean;
}

/** Pulls the override bucket for a given provider id from the directive overrides. */
function pickProviderOverrides(
  overrides: TtsDirectiveOverrides | undefined,
  providerId: TTSProvider,
): SpeechProviderOverrides | undefined {
  if (!overrides) return undefined;
  const bucket = (overrides as Record<string, unknown>)[providerId];
  if (bucket && typeof bucket === 'object') {
    return bucket as SpeechProviderOverrides;
  }
  return undefined;
}

/** Merges TTSOptions (caller-supplied) with directive bucket. Directive wins on overlap. */
function mergeOverrides(
  ttsOptions: TTSOptions | undefined,
  directiveBucket: SpeechProviderOverrides | undefined,
): SpeechProviderOverrides | undefined {
  const merged: Record<string, unknown> = {};
  if (ttsOptions?.voice) merged.voice = ttsOptions.voice;
  if (ttsOptions?.model) merged.model = ttsOptions.model;
  if (ttsOptions?.speed) merged.speed = ttsOptions.speed;
  if (directiveBucket) {
    Object.assign(merged, directiveBucket);
  }
  return Object.keys(merged).length > 0 ? merged : undefined;
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
    if (message.includes('too long') || message.includes('text length') || message.includes('exceeds')) {
      return 'text_too_long';
    }
    return 'provider_error';
  }
  return 'unknown';
}

/** Common pre-flight: directive parse → preprocess → optional summarize. */
async function prepareTextForSynthesis(
  text: string,
  config: TTSConfig,
  options: SpeakOptions | undefined,
): Promise<{
  text: string;
  wasPreprocessed: boolean;
  wasSummarized: boolean;
  ttsOptions: TTSOptions | undefined;
  directiveOverrides: TtsDirectiveOverrides | undefined;
  selectedProvider: TTSProvider;
}> {
  let ttsText = text;
  let ttsOptions = options?.tts;
  let directiveOverrides: TtsDirectiveOverrides | undefined;
  let selectedProvider: TTSProvider = config.provider;

  if (options?.parseDirectives !== false && config.modelOverrides?.enabled) {
    const directiveResult = parseTtsDirectives(text, config.modelOverrides);
    ttsText = directiveResult.ttsText || directiveResult.cleanedText;
    directiveOverrides = directiveResult.overrides;
    if (directiveResult.overrides?.provider) {
      selectedProvider = directiveResult.overrides.provider;
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
  const wasPreprocessed =
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

  return {
    text: preprocessResult.text,
    wasPreprocessed,
    wasSummarized,
    ttsOptions,
    directiveOverrides,
    selectedProvider,
  };
}

/** Build the SpeechSynthesisRequest from a resolved provider + prepared text. */
function buildSynthesisRequest(
  resolved: ResolvedSpeechProvider,
  preparedText: string,
  ttsOptions: TTSOptions | undefined,
  directiveOverrides: TtsDirectiveOverrides | undefined,
  appConfig: Config | undefined,
  target: 'audio-file' | 'voice-note',
  signal?: AbortSignal,
): SpeechSynthesisRequest {
  const directiveBucket = pickProviderOverrides(directiveOverrides, resolved.providerId);
  const providerOverrides = mergeOverrides(ttsOptions, directiveBucket);
  const callTimeoutMs = ttsOptions?.timeoutMs ?? resolved.timeoutMs;
  return {
    text: preparedText,
    cfg: appConfig as Config,
    providerConfig: resolved.providerConfig,
    target,
    timeoutMs: callTimeoutMs,
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(callTimeoutMs)])
      : AbortSignal.timeout(callTimeoutMs),
    ...(providerOverrides ? { providerOverrides } : {}),
  };
}

/** Convert SpeechSynthesisResult → TTSResult shape (audio/format/provider). */
function toTtsResult(
  resolved: ResolvedSpeechProvider,
  result: SpeechSynthesisResult,
  durationSeconds: number | undefined,
): { audio: Buffer; format: string; provider: string; duration?: number } {
  return {
    audio: result.audioBuffer,
    format: result.outputFormat,
    provider: resolved.providerId,
    ...(durationSeconds !== undefined ? { duration: durationSeconds } : {}),
  };
}

// ---- Public API ---------------------------------------------------------

/**
 * Run the TTS chain (primary → fallback) and return the first successful result.
 */
export async function speak(
  text: string,
  config: TTSConfig,
  options?: SpeakOptions,
): Promise<TTSResultWithTracking> {
  if (!config.enabled) {
    throw new Error('TTS is not enabled');
  }
  if (config.trigger === 'tagged' && !/\[\[tts/.test(text)) {
    throw new Error('TTS trigger is tagged but no [[tts]] directive found');
  }

  const prepared = await prepareTextForSynthesis(text, config, options);
  const chain = resolveSpeechProviderChain(config);

  // Reorder so the directive-selected provider (if registered + configured) goes first.
  const orderedChain = (() => {
    const idx = chain.findIndex((c) => c.providerId === prepared.selectedProvider);
    if (idx <= 0) return chain;
    const reordered = [...chain];
    const [picked] = reordered.splice(idx, 1);
    if (picked) {
      reordered.unshift(picked);
    }
    return reordered;
  })();

  const attempts: ProviderAttempt[] = [];
  const attemptedProviders: string[] = [];
  let lastError: Error | undefined;

  for (const resolved of orderedChain) {
    const startTime = Date.now();
    attemptedProviders.push(resolved.providerId);

    if (typeof resolved.plugin.synthesize !== 'function') {
      attempts.push({
        provider: resolved.providerId,
        task: 'skipped',
        reasonCode: 'not_configured',
        latencyMs: Date.now() - startTime,
        error: `Provider "${resolved.providerId}" does not implement synthesize()`,
      });
      continue;
    }

    try {
      log.debug(
        { textLength: prepared.text.length, provider: resolved.providerId },
        'Converting text to speech',
      );
      const request = buildSynthesisRequest(
        resolved,
        prepared.text,
        prepared.ttsOptions,
        prepared.directiveOverrides,
        options?.appConfig,
        'audio-file',
        options?.signal,
      );
      const result = await resolved.plugin.synthesize(request);
      const durationSeconds = (Date.now() - startTime) / 1000;
      attempts.push({
        provider: resolved.providerId,
        task: 'success',
        reasonCode: 'success',
        latencyMs: Date.now() - startTime,
      });

      const primaryProvider = orderedChain[0]!.providerId;
      const fallbackFrom = resolved.providerId !== primaryProvider ? primaryProvider : undefined;
      if (fallbackFrom) {
        log.info(
          { primaryProvider: fallbackFrom, actualProvider: resolved.providerId, attempts },
          'TTS used fallback provider',
        );
      } else {
        log.info(
          { provider: resolved.providerId, format: result.outputFormat, size: result.audioBuffer.length },
          'TTS succeeded',
        );
      }

      return {
        ...toTtsResult(resolved, result, durationSeconds),
        attempts,
        ...(fallbackFrom ? { fallbackFrom } : {}),
        attemptedProviders,
        wasPreprocessed: prepared.wasPreprocessed,
        ttsText: prepared.text,
        wasSummarized: prepared.wasSummarized,
      };
    } catch (error) {
      const latencyMs = Date.now() - startTime;
      const reasonCode = classifyError(error);
      const errorMsg = error instanceof Error ? error.message : String(error);
      attempts.push({
        provider: resolved.providerId,
        task: 'failed',
        reasonCode,
        latencyMs,
        error: errorMsg,
      });
      lastError = error instanceof Error ? error : new Error(String(error));
      log.warn(
        { provider: resolved.providerId, errorMessage: errorMsg, reasonCode, latencyMs },
        'TTS provider failed, trying next',
      );
    }
  }

  log.error({ attempts, attemptedProviders }, 'All TTS providers failed');
  throw (
    lastError ?? new Error(`All TTS providers failed: ${attempts.map((a) => a.error).join('; ')}`)
  );
}

/** Single-provider variant; bypasses the fallback chain. */
export async function speakWithProvider(
  text: string,
  config: TTSConfig,
  providerName: TTSProvider,
  options?: SpeakOptions,
): Promise<TTSResultWithTracking> {
  if (!config.enabled) {
    throw new Error('TTS is not enabled');
  }
  const resolved = resolveSpeechProvider(providerName, config);
  if (!resolved) {
    throw new Error(`Provider '${providerName}' is not available`);
  }
  if (typeof resolved.plugin.synthesize !== 'function') {
    throw new Error(`Provider '${providerName}' does not implement synthesize()`);
  }

  const prepared = await prepareTextForSynthesis(text, config, options);
  const startTime = Date.now();
  const request = buildSynthesisRequest(
    resolved,
    prepared.text,
    prepared.ttsOptions,
    prepared.directiveOverrides,
    options?.appConfig,
    'audio-file',
    options?.signal,
  );
  const result = await resolved.plugin.synthesize(request);
  const durationSeconds = (Date.now() - startTime) / 1000;

  return {
    ...toTtsResult(resolved, result, durationSeconds),
    attempts: [
      {
        provider: providerName,
        task: 'success',
        reasonCode: 'success',
        latencyMs: Date.now() - startTime,
      },
    ],
    attemptedProviders: [providerName],
    wasPreprocessed: prepared.wasPreprocessed,
    ttsText: prepared.text,
    wasSummarized: prepared.wasSummarized,
  };
}

// ---- Streaming surface --------------------------------------------------

export interface SpeakStreamResult {
  /** Audio chunks. Caller is responsible for consuming the stream. */
  audioStream: ReadableStream<Uint8Array>;
  outputFormat: string;
  fileExtension: string;
  voiceCompatible: boolean;
  /** Provider id that produced this stream. */
  provider: TTSProvider;
  /** Cleanup hook (close sockets etc.). Always defined; no-op when nothing to release. */
  release: () => Promise<void>;
  /** Pre-flight metadata (after directive parse / preprocess / summarize). */
  ttsText: string;
  wasPreprocessed: boolean;
  wasSummarized: boolean;
}

/**
 * Streaming TTS — tries the chain and returns the first provider's stream.
 * Providers without `synthesizeStream` are wrapped via wrapBufferAsStream.
 */
export async function speakStream(
  text: string,
  config: TTSConfig,
  options?: SpeakStreamOptions,
): Promise<SpeakStreamResult> {
  if (!config.enabled) {
    throw new Error('TTS is not enabled');
  }
  if (config.trigger === 'tagged' && !/\[\[tts/.test(text)) {
    throw new Error('TTS trigger is tagged but no [[tts]] directive found');
  }

  const prepared = await prepareTextForSynthesis(text, config, options);
  const chain = options?.allowFallback === false
    ? [resolveSpeechProvider(prepared.selectedProvider, config)].filter(
        (provider): provider is ResolvedSpeechProvider => provider !== null,
      )
    : resolveSpeechProviderChain(config);
  if (chain.length === 0) {
    throw new Error(`TTS provider "${prepared.selectedProvider}" is not available`);
  }

  let lastError: Error | undefined;
  for (const resolved of chain) {
    try {
      const baseRequest: SpeechSynthesisStreamRequest = buildSynthesisRequest(
        resolved,
        prepared.text,
        prepared.ttsOptions,
        prepared.directiveOverrides,
        options?.appConfig,
        'voice-note',
        options?.signal,
      );

      let streamResult: SpeechSynthesisStreamResult;
      if (typeof resolved.plugin.synthesizeStream === 'function') {
        streamResult = await resolved.plugin.synthesizeStream(baseRequest);
      } else if (typeof resolved.plugin.synthesize === 'function') {
        // Fallback: buffer-then-wrap. Documented behavior: callers see a
        // single-chunk stream with the same outputFormat.
        const bufferResult = await resolved.plugin.synthesize(baseRequest);
        streamResult = wrapBufferAsStream(bufferResult);
      } else {
        throw new Error(
          `Provider "${resolved.providerId}" implements neither synthesize nor synthesizeStream`,
        );
      }

      log.info(
        {
          provider: resolved.providerId,
          outputFormat: streamResult.outputFormat,
          voiceCompatible: streamResult.voiceCompatible,
          streamed: typeof resolved.plugin.synthesizeStream === 'function',
        },
        'TTS stream ready',
      );

      const release = streamResult.release ?? (async () => {});
      return {
        audioStream: streamResult.audioStream,
        outputFormat: streamResult.outputFormat,
        fileExtension: streamResult.fileExtension,
        voiceCompatible: streamResult.voiceCompatible,
        provider: resolved.providerId,
        release,
        ttsText: prepared.text,
        wasPreprocessed: prepared.wasPreprocessed,
        wasSummarized: prepared.wasSummarized,
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      log.warn(
        { err: lastError, provider: resolved.providerId },
        `TTS stream provider "${resolved.providerId}" failed, trying next`,
      );
    }
  }
  throw lastError ?? new Error('All TTS providers failed (streaming)');
}

/** Wrap a one-shot synthesis result into a single-chunk stream (no-op release). */
function wrapBufferAsStream(result: SpeechSynthesisResult): SpeechSynthesisStreamResult {
  const { audioBuffer } = result;
  const audioStream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(audioBuffer));
      controller.close();
    },
  });
  return {
    audioStream,
    outputFormat: result.outputFormat,
    fileExtension: result.fileExtension,
    voiceCompatible: result.voiceCompatible,
  };
}
