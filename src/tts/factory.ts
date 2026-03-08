/**
 * TTS Provider Factory
 */

import type { TTSProvider, TTSConfig } from './types.js';
import { OpenAIProvider } from './openai.js';
import { AlibabaProvider } from './alibaba.js';

export function createTTSProvider(config: TTSConfig): TTSProvider {
  if (!config.enabled) {
    throw new Error('TTS is not enabled');
  }

  const provider = config.provider;

  switch (provider) {
    case 'openai': {
      const apiKey = config.openai?.apiKey || process.env.OPENAI_API_KEY;
      if (!apiKey) {
        throw new Error('OpenAI API key not configured');
      }
      return new OpenAIProvider({
        apiKey,
        model: config.openai?.model,
        voice: config.openai?.voice,
      });
    }

    case 'alibaba': {
      const apiKey = config.alibaba?.apiKey || process.env.DASHSCOPE_API_KEY;
      if (!apiKey) {
        throw new Error('Alibaba DashScope API key not configured');
      }
      return new AlibabaProvider({
        apiKey,
        model: config.alibaba?.model,
        voice: config.alibaba?.voice,
      });
    }

    default:
      throw new Error(`Unknown TTS provider: ${provider}`);
  }
}

/**
 * Check if TTS is available with current configuration
 */
export function isTTSAvailable(config?: TTSConfig): boolean {
  if (!config?.enabled) {
    return false;
  }

  try {
    const provider = createTTSProvider(config);
    return provider.isConfigured();
  } catch {
    return false;
  }
}