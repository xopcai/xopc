/**
 * Audio transcription entry point.
 *
 * Thin facade over `runCapability({ capability: 'audio' })` that:
 *   1. Builds the per-provider AudioTranscriptionRequest from
 *      `cfg.tools.media.audio`.
 *   2. Resolves the api key / base URL / per-provider model from config + env.
 *   3. Returns a normalized `{ transcript, attempts }` shape so the agent /
 *      channel layer doesn't see the registry plumbing.
 */

import { createLogger } from '../utils/logger.js';

import { runCapability } from './runner.js';
import type {
  AudioTranscriptionRequest,
  CapabilityAttachmentInput,
  MediaUnderstandingDecision,
  MediaUnderstandingProvider,
} from './types.js';
// Re-export to keep callers' import paths short.
export type { AudioTranscriptionRequest, AudioTranscriptionResult } from './types.js';

const log = createLogger('AudioTranscriptionRunner');

export interface AudioProviderResolvedConfig {
  /** Provider id (must match a registered MediaUnderstandingProvider id). */
  id: string;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  language?: string;
  prompt?: string;
  query?: Record<string, string | number | boolean>;
  headers?: Record<string, string>;
  /** Provider-specific extra fields preserved as-is. */
  extra?: Record<string, unknown>;
}

export interface RunAudioTranscriptionOptions {
  /** Pre-resolved provider configs in the order to try them. */
  providers: readonly AudioProviderResolvedConfig[];
  /** Audio buffers to transcribe. */
  attachments: readonly CapabilityAttachmentInput[];
  /** Hard timeout per provider call (ms). */
  timeoutMs: number;
  signal?: AbortSignal;
}

export interface RunAudioTranscriptionResult {
  /** First successful transcript across attachments (joined when multiple). */
  transcript?: string;
  /** Per-attachment outputs (preserves order). */
  outputs: Array<{
    attachmentIndex: number;
    text: string;
    provider: string;
    model?: string;
    language?: string;
    durationSeconds?: number;
  }>;
  decision: MediaUnderstandingDecision;
}

export async function runAudioTranscription(
  options: RunAudioTranscriptionOptions,
): Promise<RunAudioTranscriptionResult> {
  if (options.providers.length === 0) {
    log.warn(
      { attachmentCount: options.attachments.length },
      'No audio providers configured; transcription disabled',
    );
  }

  // Index resolved configs by provider id for quick lookup inside buildRequest.
  const configById = new Map<string, AudioProviderResolvedConfig>();
  for (const cfg of options.providers) {
    configById.set(cfg.id.toLowerCase(), cfg);
  }

  const result = await runCapability({
    capability: 'audio',
    attachments: options.attachments,
    providerOrder: options.providers.map((cfg) => cfg.id),
    signal: options.signal,
    buildRequest: ({ provider, attachment }) =>
      buildAudioRequest({
        provider,
        attachment,
        config: configById.get(provider.id.toLowerCase()),
        timeoutMs: options.timeoutMs,
        signal: options.signal,
      }),
  });

  // Aggregate transcripts by attachment order.
  const outputs = result.outputs.map((entry) => ({
    attachmentIndex: entry.attachmentIndex,
    text: entry.text,
    provider: entry.provider,
    ...(entry.model ? { model: entry.model } : {}),
    ...(entry.language ? { language: entry.language } : {}),
    ...(entry.durationSeconds !== undefined ? { durationSeconds: entry.durationSeconds } : {}),
  }));

  const transcript =
    outputs.length === 0
      ? undefined
      : outputs
          .slice()
          .sort((a, b) => a.attachmentIndex - b.attachmentIndex)
          .map((o) => o.text)
          .join('\n')
          .trim() || undefined;

  return { transcript, outputs, decision: result.decision };
}

function buildAudioRequest(params: {
  provider: MediaUnderstandingProvider;
  attachment: CapabilityAttachmentInput;
  config?: AudioProviderResolvedConfig;
  timeoutMs: number;
  signal?: AbortSignal;
}): AudioTranscriptionRequest | undefined {
  const { provider, attachment, config, timeoutMs, signal } = params;
  if (!config) {
    log.debug(
      { providerId: provider.id, attachmentIndex: attachment.attachmentIndex },
      `No resolved config for provider "${provider.id}"; skipping`,
    );
    return undefined;
  }
  const requiresApiKey = provider.requiresApiKey !== false;
  if (requiresApiKey && !config.apiKey) {
    log.debug(
      { providerId: provider.id, attachmentIndex: attachment.attachmentIndex },
      `Provider "${provider.id}" has no apiKey; skipping`,
    );
    return undefined;
  }
  return {
    buffer: attachment.buffer,
    fileName: attachment.fileName,
    ...(attachment.mime ? { mime: attachment.mime } : {}),
    ...(config.apiKey ? { apiKey: config.apiKey } : {}),
    ...(config.baseUrl ? { baseUrl: config.baseUrl } : {}),
    ...(config.headers ? { headers: config.headers } : {}),
    ...(config.model ?? provider.defaultModels?.audio
      ? { model: config.model ?? provider.defaultModels?.audio }
      : {}),
    ...(config.language ? { language: config.language } : {}),
    ...(config.prompt ? { prompt: config.prompt } : {}),
    ...(config.query ? { query: config.query } : {}),
    timeoutMs,
    ...(signal ? { signal } : {}),
  };
}
