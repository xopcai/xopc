import type {
  STTConfig,
  STTOptions,
  STTResultWithTracking,
  STTProviderAttempt,
  STTProviderFailureReason,
} from './types.js';
import { resolveSTTProviderOrder, tryCreateSTTProvider } from './factory.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('STT');

function classifySTTError(error: unknown): STTProviderFailureReason {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    if (message.includes('not configured') || message.includes('api key')) {
      return 'not_configured';
    }
    if (message.includes('timeout') || message.includes('timed out') || message.includes('aborted')) {
      return 'timeout';
    }
    if (message.includes('unsupported') || message.includes('format')) {
      return 'unsupported_format';
    }
    return 'provider_error';
  }
  return 'unknown';
}

export async function transcribe(
  audioBuffer: Buffer,
  config: STTConfig,
  options?: STTOptions,
): Promise<STTResultWithTracking> {
  if (!config.enabled) {
    throw new Error('STT is not enabled');
  }

  const attempts: STTProviderAttempt[] = [];
  const attemptedProviders: string[] = [];
  let lastError: Error | undefined;

  const providerOrder = resolveSTTProviderOrder(config.provider, config.fallback);

  for (const providerName of providerOrder) {
    const startTime = Date.now();
    attemptedProviders.push(providerName);

    const providerConfig: STTConfig = { ...config, provider: providerName };
    const provider = tryCreateSTTProvider(providerConfig);

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
      const result = await provider.transcribe(audioBuffer, options);
      const latencyMs = Date.now() - startTime;

      attempts.push({
        provider: providerName,
        outcome: 'success',
        reasonCode: 'success',
        latencyMs,
      });

      const primaryProvider = providerOrder[0]!;
      const fallbackFrom = providerName !== primaryProvider ? primaryProvider : undefined;

      return {
        ...result,
        attempts,
        fallbackFrom,
        attemptedProviders,
      };
    } catch (error) {
      const latencyMs = Date.now() - startTime;
      const reasonCode = classifySTTError(error);
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
        'STT provider failed, trying next',
      );
    }
  }

  log.error({ attempts, attemptedProviders }, 'All STT providers failed');
  throw lastError || new Error('All STT providers failed');
}
