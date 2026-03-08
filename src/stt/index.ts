/**
 * STT (Speech-to-Text) Module
 * 
 * Unified interface for multiple STT providers
 */

import type { STTResult, STTOptions, STTConfig } from './types.js';
import { createSTTProvider, createFallbackProviders } from './factory.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('STT');

/**
 * Transcribe audio using the configured provider
 */
export async function transcribe(
  audioBuffer: Buffer,
  config: STTConfig,
  options?: STTOptions
): Promise<STTResult> {
  if (!config.enabled) {
    throw new Error('STT is not enabled');
  }

  // Try primary provider first
  const primaryProvider = createSTTProvider(config);
  
  try {
    return await primaryProvider.transcribe(audioBuffer, options);
  } catch (error) {
    log.error({ provider: config.provider, error }, 'Primary STT provider failed');

    // Try fallback providers if enabled
    if (config.fallback?.enabled && config.fallback.order.length > 1) {
      const fallbackProviders = createFallbackProviders(config).filter(
        (p) => p.name !== config.provider
      );

      for (const provider of fallbackProviders) {
        try {
          log.info({ provider: provider.name }, 'Trying fallback provider');
          const result = await provider.transcribe(audioBuffer, options);
          log.info({ provider: provider.name }, 'Fallback provider succeeded');
          return result;
        } catch (fallbackError) {
          log.error({ provider: provider.name, error: fallbackError }, 'Fallback provider failed');
        }
      }
    }

    // All providers failed
    throw error;
  }
}

/**
 * Check if STT is available with current configuration
 */
export function isSTTAvailable(config?: STTConfig): boolean {
  if (!config?.enabled) {
    return false;
  }

  try {
    const provider = createSTTProvider(config);
    return provider.isConfigured();
  } catch {
    return false;
  }
}

/**
 * Transcribe with specific provider
 */
export async function transcribeWithProvider(
  audioBuffer: Buffer,
  providerName: 'alibaba' | 'openai',
  config: STTConfig,
  options?: STTOptions
): Promise<STTResult> {
  const providerConfig: STTConfig = {
    ...config,
    provider: providerName,
  };
  const provider = createSTTProvider(providerConfig);
  return provider.transcribe(audioBuffer, options);
}

// Re-export types
export type { STTProvider, STTResult, STTOptions, STTConfig } from './types.js';
export { OpenAIProvider, type OpenAIConfig } from './openai.js';
export { AlibabaProvider, type AlibabaConfig } from './alibaba.js';
export { createSTTProvider, createFallbackProviders } from './factory.js';