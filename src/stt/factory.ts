/**
 * STT Provider Factory
 */

import type { STTProvider, STTConfig } from './types.js';
import { OpenAIProvider } from './openai.js';
import { AlibabaProvider } from './alibaba.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('STT:Factory');

export function createSTTProvider(config: STTConfig): STTProvider {
  if (!config.enabled) {
    throw new Error('STT is not enabled');
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
      });
    }

    default:
      throw new Error(`Unknown STT provider: ${provider}`);
  }
}

/**
 * Create providers for fallback chain
 */
export function createFallbackProviders(config: STTConfig): STTProvider[] {
  if (!config.enabled) {
    return [];
  }

  const providers: STTProvider[] = [];
  const order = config.fallback?.order || [config.provider];

  for (const providerName of order) {
    try {
      const providerConfig: STTConfig = {
        ...config,
        provider: providerName,
      };
      providers.push(createSTTProvider(providerConfig));
    } catch (error) {
      log.warn({ provider: providerName, error }, 'Failed to create provider for fallback');
    }
  }

  return providers;
}