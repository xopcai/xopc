/**
 * Config Integration
 * 
 * Placeholder for backward compatibility.
 * Provider configuration is now directly in config.providers.
 */

import type { Config } from './schema.js';

/**
 * Get effective config - returns the config as-is
 * @deprecated Config is now flat, no need for normalization
 */
export function getEffectiveConfig(config: Config): Config {
  return config;
}
