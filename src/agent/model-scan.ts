/**
 * Model Scan
 * 
 * Scans and discovers models from provider configurations.
 */

import type { ModelProviderConfig, ModelDefinitionConfig, ModelsConfig } from '../config/types.models.js';
import { parseModelRef, normalizeProviderId } from './model-selection.js';

export interface ScanResult {
  provider: string;
  models: ModelDefinitionConfig[];
  errors: string[];
}

/**
 * Scan all providers from config and return discovered models
 */
export function scanProviders(config: { models?: ModelsConfig }): ScanResult[] {
  const results: ScanResult[] = [];
  const providers = config.models?.providers;

  if (!providers) {
    return results;
  }

  for (const [providerId, providerConfig] of Object.entries(providers)) {
    const result = scanProvider(providerId, providerConfig);
    results.push(result);
  }

  return results;
}

/**
 * Scan a single provider and return its models
 */
export function scanProvider(
  providerId: string,
  providerConfig: ModelProviderConfig,
): ScanResult {
  const errors: string[] = [];
  const models: ModelDefinitionConfig[] = [];

  // Validate provider config
  if (!providerConfig.baseUrl) {
    errors.push(`Provider ${providerId}: missing baseUrl`);
  }

  if (!providerConfig.models || providerConfig.models.length === 0) {
    errors.push(`Provider ${providerId}: no models defined`);
  }

  // Process each model
  for (const model of providerConfig.models || []) {
    const validated = validateModelDefinition(providerId, model);
    if (validated.errors.length > 0) {
      errors.push(...validated.errors.map(e => `Model ${model.id}: ${e}`));
    }
    if (validated.model) {
      models.push(validated.model);
    }
  }

  return {
    provider: normalizeProviderId(providerId),
    models,
    errors,
  };
}

/**
 * Validate and normalize a model definition
 */
export function validateModelDefinition(
  providerId: string,
  model: ModelDefinitionConfig,
): { model: ModelDefinitionConfig | null; errors: string[] } {
  const errors: string[] = [];

  // Validate required fields
  if (!model.id || model.id.trim() === '') {
    errors.push('missing id');
  }

  if (!model.name || model.name.trim() === '') {
    errors.push('missing name');
  }

  // Validate API type if provided
  if (model.api) {
    const validApis = [
      'openai-completions',
      'openai-responses',
      'anthropic-messages',
      'google-generative-ai',
      'github-copilot',
      'bedrock-converse-stream',
      'ollama',
    ];
    if (!validApis.includes(model.api)) {
      errors.push(`invalid api type: ${model.api}`);
    }
  }

  // Validate context window if provided
  if (model.contextWindow !== undefined) {
    if (!Number.isFinite(model.contextWindow) || model.contextWindow <= 0) {
      errors.push('contextWindow must be a positive number');
    }
  }

  // Validate maxTokens if provided
  if (model.maxTokens !== undefined) {
    if (!Number.isFinite(model.maxTokens) || model.maxTokens <= 0) {
      errors.push('maxTokens must be a positive number');
    }
  }

  // Validate cost fields if provided
  if (model.cost) {
    const costFields = ['input', 'output', 'cacheRead', 'cacheWrite'] as const;
    for (const field of costFields) {
      if (model.cost[field] !== undefined) {
        if (typeof model.cost[field] !== 'number' || model.cost[field]! < 0) {
          errors.push(`cost.${field} must be a non-negative number`);
        }
      }
    }
  }

  // Validate input types if provided
  if (model.input) {
    const validInputs = ['text', 'image'];
    for (const inputType of model.input) {
      if (!validInputs.includes(inputType)) {
        errors.push(`invalid input type: ${inputType}`);
      }
    }
  }

  if (errors.length > 0) {
    return { model: null, errors };
  }

  // Normalize and enrich model
  const normalized: ModelDefinitionConfig = {
    id: model.id,
    name: model.name,
    api: model.api,
    reasoning: model.reasoning ?? false,
    input: model.input ?? ['text'],
    cost: model.cost ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: model.contextWindow ?? 128000,
    maxTokens: model.maxTokens ?? Math.min(8192, model.contextWindow ?? 128000),
    headers: model.headers,
    compat: model.compat,
  };

  return { model: normalized, errors: [] };
}

/**
 * Build a map of all available models by ID
 */
export function buildModelMap(config: { models?: ModelsConfig }): Map<string, ModelDefinitionConfig> {
  const modelMap = new Map<string, ModelDefinitionConfig>();
  const results = scanProviders(config);

  for (const result of results) {
    for (const model of result.models) {
      const key = `${result.provider}/${model.id}`;
      modelMap.set(key, model);
      // Also set by just model ID for convenience
      if (!modelMap.has(model.id)) {
        modelMap.set(model.id, model);
      }
    }
  }

  return modelMap;
}

/**
 * Check if a model reference is valid
 */
export function isValidModelRef(
  config: { models?: ModelsConfig },
  modelRef: string,
): boolean {
  const modelMap = buildModelMap(config);
  
  // Try parsing as provider/model
  const parsed = parseModelRef(modelRef);
  if (parsed) {
    const key = `${parsed.provider}/${parsed.model}`;
    return modelMap.has(key);
  }
  
  // Try as direct model ID
  return modelMap.has(modelRef);
}

/**
 * Get model definition by reference
 */
export function getModelByRef(
  config: { models?: ModelsConfig },
  modelRef: string,
): ModelDefinitionConfig | null {
  const modelMap = buildModelMap(config);
  
  // Try direct ID first
  if (modelMap.has(modelRef)) {
    return modelMap.get(modelRef) ?? null;
  }
  
  // Try parsing as provider/model
  const parsed = parseModelRef(modelRef);
  if (parsed) {
    const key = `${parsed.provider}/${parsed.model}`;
    return modelMap.get(key) ?? null;
  }
  
  return null;
}
