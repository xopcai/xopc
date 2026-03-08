import type { TTSProviderInterface, TTSConfig, TTSProvider } from './types.js';
import { OpenAIProvider, AlibabaProvider, EdgeProvider } from './providers/index.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('TTS:Factory');

export function createSingleProvider(
  provider: TTSProvider,
  config: TTSConfig
): TTSProviderInterface | null {
  switch (provider) {
    case 'openai': {
      const apiKey = config.openai?.apiKey || process.env.OPENAI_API_KEY;
      if (!apiKey) {
        log.debug('OpenAI API key not configured');
        return null;
      }
      return new OpenAIProvider({
        apiKey,
        model: config.openai?.model,
        voice: config.openai?.voice,
        timeoutMs: config.timeoutMs,
        maxTextLength: config.maxTextLength,
      });
    }

    case 'alibaba': {
      const apiKey = config.alibaba?.apiKey || process.env.DASHSCOPE_API_KEY;
      if (!apiKey) {
        log.debug('Alibaba API key not configured');
        return null;
      }
      return new AlibabaProvider({
        apiKey,
        model: config.alibaba?.model,
        voice: config.alibaba?.voice,
        timeoutMs: config.timeoutMs,
        maxTextLength: config.maxTextLength,
      });
    }

    case 'edge': {
      if (config.edge?.enabled === false) {
        log.debug('Edge TTS is disabled');
        return null;
      }
      return new EdgeProvider({
        voice: config.edge?.voice,
        lang: config.edge?.lang,
        outputFormat: config.edge?.outputFormat,
        pitch: config.edge?.pitch,
        rate: config.edge?.rate,
        volume: config.edge?.volume,
        proxy: config.edge?.proxy,
        timeoutMs: config.edge?.timeoutMs || config.timeoutMs,
        maxTextLength: config.maxTextLength,
      });
    }

    default:
      log.warn({ provider }, 'Unknown TTS provider');
      return null;
  }
}

export function resolveProviderOrder(
  primary: TTSProvider,
  fallback?: { enabled: boolean; order: TTSProvider[] }
): TTSProvider[] {
  if (!fallback?.enabled) {
    return [primary];
  }

  const order = [primary];
  for (const provider of fallback.order) {
    if (provider !== primary && !order.includes(provider)) {
      order.push(provider);
    }
  }

  return order;
}

export function createTTSProvider(config: TTSConfig): TTSProviderInterface {
  if (!config.enabled) {
    throw new Error('TTS is not enabled');
  }

  const provider = createSingleProvider(config.provider, config);
  if (!provider) {
    throw new Error(`TTS provider '${config.provider}' is not available`);
  }

  return provider;
}

export function createTTSProviderChain(config: TTSConfig): TTSProviderInterface[] {
  if (!config.enabled) {
    throw new Error('TTS is not enabled');
  }

  const order = resolveProviderOrder(config.provider, config.fallback);
  const providers: TTSProviderInterface[] = [];

  for (const providerName of order) {
    const provider = createSingleProvider(providerName, config);
    if (provider) {
      providers.push(provider);
    }
  }

  if (providers.length === 0) {
    throw new Error('No TTS providers are available');
  }

  log.debug({ 
    primary: config.provider, 
    chain: providers.map(p => p.name) 
  }, 'TTS provider chain created');

  return providers;
}

export function isTTSAvailable(config?: TTSConfig): boolean {
  if (!config?.enabled) {
    return false;
  }

  try {
    const providers = createTTSProviderChain(config);
    return providers.length > 0;
  } catch {
    return false;
  }
}

export function isProviderConfigured(provider: TTSProvider, config: TTSConfig): boolean {
  const p = createSingleProvider(provider, config);
  return p !== null && p.isConfigured();
}

export function getAvailableProviders(config: TTSConfig): TTSProvider[] {
  const available: TTSProvider[] = [];
  const allProviders: TTSProvider[] = ['openai', 'alibaba', 'edge'];

  for (const provider of allProviders) {
    if (isProviderConfigured(provider, config)) {
      available.push(provider);
    }
  }

  return available;
}
