/**
 * STT (Speech-to-Text) Module
 *
 * Unified interface for multiple STT providers
 */

import type { STTResult, STTOptions, STTConfig } from './types.js';
import { createSTTProvider } from './factory.js';

export { transcribe } from './transcribe-core.js';
export { isSTTAvailable } from './availability.js';

/**
 * Transcribe with specific provider
 */
export async function transcribeWithProvider(
  audioBuffer: Buffer,
  providerName: 'alibaba' | 'openai',
  config: STTConfig,
  options?: STTOptions,
): Promise<STTResult> {
  const providerConfig: STTConfig = {
    ...config,
    provider: providerName,
  };
  const provider = createSTTProvider(providerConfig);
  return provider.transcribe(audioBuffer, options);
}

export type {
  STTProvider,
  STTResult,
  STTOptions,
  STTConfig,
  STTResultWithTracking,
  STTProviderAttempt,
  STTProviderFailureReason,
} from './types.js';
export { OpenAIProvider, type OpenAIConfig } from './openai.js';
export { AlibabaProvider, type AlibabaConfig } from './alibaba.js';
export {
  createSTTProvider,
  createFallbackProviders,
  resolveSTTProviderOrder,
  tryCreateSTTProvider,
} from './factory.js';
export { audioPreflightTranscribe, checkMentionInTranscription } from './preflight.js';
