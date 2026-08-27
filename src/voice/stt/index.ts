/**
 * STT (Speech-to-Text) Module
 *
 * Providers implement MediaUnderstandingProvider; orchestration goes through
 * the media-understanding runner. Channel adapters use the public helpers below.
 */

import './providers/index.js'; // side-effect: register built-in STT providers

import type { STTConfig, STTOptions, STTResult } from './types.js';
import { transcribe } from './transcribe-core.js';

export { transcribe } from './transcribe-core.js';
export { STTTranscriptionError } from './transcribe-core.js';
export { isSTTAvailable } from './availability.js';
export { mergeSttConfigFromAppConfig } from './config.js';

/**
 * Single-provider transcription helper. Used by chat-commands /stt so a user
 * can force a specific provider regardless of fallback config.
 */
export async function transcribeWithProvider(
  audioBuffer: Buffer,
  providerName: string,
  config: STTConfig,
  options?: STTOptions,
): Promise<STTResult> {
  // Build a per-call config that pins primary to the requested provider and
  // disables fallback. This routes through the same runner machinery without
  // needing a separate single-provider code path.
  const pinnedConfig: STTConfig = {
    ...config,
    provider: providerName,
    fallback: { enabled: false, order: [providerName] },
  };
  const result = await transcribe(audioBuffer, pinnedConfig, options);
  return {
    text: result.text,
    provider: result.provider,
    ...(result.duration !== undefined ? { duration: result.duration } : {}),
    ...(result.language ? { language: result.language } : {}),
  };
}

export type {
  STTResult,
  STTOptions,
  STTConfig,
  STTResultWithTracking,
  STTProviderAttempt,
  STTProviderFailureReason,
} from './types.js';

export { openAiTranscriptionProvider, alibabaTranscriptionProvider } from './providers/index.js';

export {
  resolveSTTProviderConfig,
  resolveSTTProviderChain,
  resolveSTTProviderOrder,
} from './factory.js';

export { audioPreflightTranscribe, checkMentionInTranscription } from './preflight.js';
