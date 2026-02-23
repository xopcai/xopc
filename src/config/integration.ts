/**
 * Model Config Integration
 * 
 * OpenClaw-style model configuration system.
 * This is the primary and only way to configure models.
 */

import type { ModelsConfig, ModelProviderConfig, ModelDefinitionConfig } from './types.models.js';
import { applyModelDefaults } from './defaults.js';
import type { Config } from './schema.js';

/**
 * Get models config from main config
 */
export function getModelsConfig(config: Config): ModelsConfig | undefined {
  return config.models;
}

/**
 * Apply defaults to models config
 */
export function normalizeModelsConfig(config: { models?: ModelsConfig }): { models?: ModelsConfig } {
  return applyModelDefaults(config);
}

/**
 * Get effective config - returns the models config as-is (no migration)
 */
export function getEffectiveConfig(config: Config): { models?: ModelsConfig } {
  const modelsConfig = config.models;
  if (!modelsConfig) {
    return { models: undefined };
  }
  return normalizeModelsConfig({ models: modelsConfig });
}
