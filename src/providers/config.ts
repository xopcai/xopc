/**
 * Provider Configuration
 * 
 * Centralized configuration for provider behavior and defaults
 */

export interface ProviderBehaviorConfig {
  /** Maximum thinking budget tokens (default: 8192) */
  maxThinkingBudgetTokens: number;
  /** Default temperature (default: 0.7) */
  defaultTemperature: number;
  /** Default max tokens for responses */
  defaultMaxTokens: number;
  /** Ollama base URL */
  ollamaBaseUrl: string;
  /** Ollama API timeout in ms */
  ollamaTimeoutMs: number;
  /** Ollama discovery timeout in ms */
  ollamaDiscoveryTimeoutMs: number;
}

/** Default provider configuration */
export const DEFAULT_PROVIDER_CONFIG: ProviderBehaviorConfig = {
  maxThinkingBudgetTokens: 8192,
  defaultTemperature: 0.7,
  defaultMaxTokens: 4096,
  ollamaBaseUrl: 'http://127.0.0.1:11434',
  ollamaTimeoutMs: 5000,
  ollamaDiscoveryTimeoutMs: 2000,
};

/** Provider config from environment variables */
export function loadProviderConfigFromEnv(): Partial<ProviderBehaviorConfig> {
  return {
    maxThinkingBudgetTokens: envToNumber('XOPCBOT_MAX_THINKING_TOKENS'),
    defaultTemperature: envToNumber('XOPCBOT_DEFAULT_TEMPERATURE'),
    defaultMaxTokens: envToNumber('XOPCBOT_DEFAULT_MAX_TOKENS'),
    ollamaBaseUrl: process.env.OLLAMA_BASE_URL,
    ollamaTimeoutMs: envToNumber('OLLAMA_TIMEOUT_MS'),
    ollamaDiscoveryTimeoutMs: envToNumber('OLLAMA_DISCOVERY_TIMEOUT_MS'),
  };
}

/** Merge config with defaults */
export function createProviderConfig(
  overrides: Partial<ProviderBehaviorConfig> = {}
): ProviderBehaviorConfig {
  const envConfig = loadProviderConfigFromEnv();
  
  return {
    ...DEFAULT_PROVIDER_CONFIG,
    ...envConfig,
    ...overrides,
  };
}

function envToNumber(key: string): number | undefined {
  const value = process.env[key];
  if (!value) return undefined;
  const num = parseInt(value, 10);
  return isNaN(num) ? undefined : num;
}
