/**
 * STT orchestrator — `transcribe()` is the single entry point used by channel
 * adapters (telegram, webchat) and the preflight router.
 *
 * Internally delegates to `runAudioTranscription` from the media-understanding
 * runner. The runner returns a `MediaUnderstandingDecision`; we translate each
 * `decision.attachments[0].attempts[]` entry into the `STTProviderAttempt`
 * shape consumed by downstream telemetry.
 *
 * One-attachment fast path: `transcribe()` is 1-buffer-in / 1-text-out, so we
 * wrap the input as a single CapabilityAttachmentInput and unpack the first
 * output. Multi-attachment cases go through `runAudioTranscription` directly.
 */

import { createLogger } from '../../utils/logger.js';

import { runAudioTranscription } from '../../media-understanding/audio-transcription-runner.js';
import type {
  MediaUnderstandingAttachmentDecision,
  MediaUnderstandingModelDecision,
} from '../../media-understanding/types.js';
import { resolveSTTProviderChain } from './factory.js';
import type {
  STTConfig,
  STTOptions,
  STTProviderAttempt,
  STTProviderFailureReason,
  STTResultWithTracking,
} from './types.js';

const log = createLogger('STT');

function classifyFailureReason(reason: string | undefined): STTProviderFailureReason {
  if (!reason) return 'unknown';
  const lower = reason.toLowerCase();
  if (lower.includes('not configured') || lower.includes('api key') || lower.includes('missing')) {
    return 'not_configured';
  }
  if (lower.includes('timeout') || lower.includes('timed out') || lower.includes('aborted')) {
    return 'timeout';
  }
  if (lower.includes('unsupported') || lower.includes('format')) {
    return 'unsupported_format';
  }
  return 'provider_error';
}

function toAttempt(attempt: MediaUnderstandingModelDecision): STTProviderAttempt {
  return {
    provider: attempt.provider ?? 'unknown',
    outcome: attempt.outcome,
    reasonCode: attempt.outcome === 'success' ? 'success' : classifyFailureReason(attempt.reason),
    // Latency is not tracked at the runner level today (deferred to future
    // observability pass); we report 0 to keep the field shape stable.
    latencyMs: 0,
    ...(attempt.reason ? { error: attempt.reason } : {}),
  };
}

export async function transcribe(
  audioBuffer: Buffer,
  config: STTConfig,
  options?: STTOptions,
): Promise<STTResultWithTracking> {
  if (!config.enabled) {
    throw new Error('STT is not enabled');
  }
  const providers = resolveSTTProviderChain(config);
  if (providers.length === 0) {
    throw new Error('No STT providers configured');
  }

  // Apply caller-supplied language hint to each provider's resolved config.
  // (We don't bake it into resolveSTTProviderChain because it is per-call.)
  const providersWithLanguage = options?.language
    ? providers.map((p) => ({ ...p, language: options.language }))
    : providers;

  const result = await runAudioTranscription({
    providers: providersWithLanguage,
    attachments: [
      {
        attachmentIndex: 0,
        buffer: audioBuffer,
        fileName: `audio-${Date.now()}.ogg`,
        // mime is informational for OpenAI's multipart blob; alibaba uses base64 data URL.
        mime: 'audio/ogg',
      },
    ],
    timeoutMs: config.timeoutMs ?? 60_000,
  });

  const attachmentDecision: MediaUnderstandingAttachmentDecision | undefined =
    result.decision.attachments[0];
  const attempts = (attachmentDecision?.attempts ?? []).map(toAttempt);
  const attemptedProviders = attempts.map((a) => a.provider);

  if (!attachmentDecision?.chosen) {
    log.error({ attempts, attemptedProviders }, 'All STT providers failed');
    const lastError = attempts.find((a) => a.outcome === 'failed')?.error;
    throw new Error(lastError ?? 'All STT providers failed');
  }

  const chosen = attachmentDecision.chosen;
  const output = result.outputs[0];
  if (!output) {
    throw new Error('STT runner returned chosen attempt but no output text');
  }
  const primaryProvider = providersWithLanguage[0]!.id;
  const fallbackFrom =
    chosen.provider && chosen.provider !== primaryProvider ? primaryProvider : undefined;

  return {
    text: output.text,
    provider: chosen.provider ?? 'unknown',
    ...(chosen.model ? { language: options?.language } : {}),
    attempts,
    ...(fallbackFrom ? { fallbackFrom } : {}),
    attemptedProviders,
  };
}
