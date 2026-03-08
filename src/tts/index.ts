/**
 * TTS (Text-to-Speech) Module
 * 
 * Unified interface for multiple TTS providers
 */

import type { TTSResult, TTSOptions, TTSConfig } from './types.js';
import { createTTSProvider, isTTSAvailable } from './factory.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('TTS');

/**
 * Check if TTS is available with current configuration
 */
export { isTTSAvailable };

/**
 * Convert text to speech
 */
export async function speak(
  text: string,
  config: TTSConfig,
  options?: TTSOptions
): Promise<TTSResult> {
  if (!config.enabled) {
    throw new Error('TTS is not enabled');
  }

  const provider = createTTSProvider(config);
  
  log.debug({ textLength: text.length, provider: config.provider }, 'Converting text to speech');
  
  return provider.speak(text, options);
}

// Re-export types and functions
export type { TTSResult, TTSOptions, TTSConfig, TTSProvider } from './types.js';
export { OpenAIProvider } from './openai.js';
export { AlibabaProvider } from './alibaba.js';
export { createTTSProvider } from './factory.js';