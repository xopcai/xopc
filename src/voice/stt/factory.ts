/**
 * STT Provider Factory
 */

import type { STTProvider, STTConfig } from './types.js';
import { OpenAIProvider } from './openai.js';
import { AlibabaProvider } from './alibaba.js';
import { createLogger } from '../../utils/logger.js';

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

export function resolveSTTProviderOrder(
  primary: STTConfig['provider'],
  fallback?: STTConfig['fallback'],
): STTConfig['provider'][] {
  if (!fallback?.enabled) {
    return [primary];
  }
  const order: STTConfig['provider'][] = [primary];
  for (const p of fallback.order) {
    if (p !== primary && !order.includes(p)) {
      order.push(p);
    }
  }
  return order;
}

export function tryCreateSTTProvider(config: STTConfig): STTProvider | null {
  try {
    return createSTTProvider(config);
  } catch {
    return null;
  }
}