/**
 * Models.json API client
 * 
 * Client for the custom models configuration API
 */

import type { 
  ModelsJsonConfig, 
  ProviderConfig, 
  CustomModel,
  ValidationResult,
} from '../../../src/config/models-json';

export type { ModelsJsonConfig, ProviderConfig, CustomModel };

export interface ModelsJsonStatus {
  config: ModelsJsonConfig;
  path: string;
  exists: boolean;
  loadError?: string;
}

export interface ApiKeyTestResult {
  type: 'literal' | 'env' | 'command';
  resolved?: string;
  error?: string;
}

/**
 * Fetch models.json configuration
 */
export async function fetchModelsJson(token?: string): Promise<ModelsJsonStatus> {
  const response = await fetch(`${window.location.origin}/api/models-json`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch models.json: ${response.status}`);
  }

  const data = await response.json();
  if (!data.ok) {
    throw new Error(data.error || 'Failed to fetch models.json');
  }

  return data.payload;
}

/**
 * Validate models.json configuration
 */
export async function validateModelsJson(
  config: ModelsJsonConfig,
  token?: string
): Promise<ValidationResult> {
  const response = await fetch(`${window.location.origin}/api/models-json/validate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ config }),
  });

  if (!response.ok) {
    throw new Error(`Failed to validate: ${response.status}`);
  }

  const data = await response.json();
  if (!data.ok) {
    throw new Error(data.error || 'Failed to validate');
  }

  return data.payload;
}

/**
 * Save models.json configuration
 */
export async function saveModelsJson(
  config: ModelsJsonConfig,
  token?: string
): Promise<{ saved: boolean; modelCount: number }> {
  const response = await fetch(`${window.location.origin}/api/models-json`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ config }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || `Failed to save: ${response.status}`);
  }

  const data = await response.json();
  if (!data.ok) {
    throw new Error(data.error || 'Failed to save');
  }

  return data.payload;
}

/**
 * Reload models.json configuration
 */
export async function reloadModelsJson(token?: string): Promise<{ 
  modelCount: number; 
  error?: string;
}> {
  const response = await fetch(`${window.location.origin}/api/models-json/reload`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

  if (!response.ok) {
    throw new Error(`Failed to reload: ${response.status}`);
  }

  const data = await response.json();
  if (!data.ok) {
    throw new Error(data.error || 'Failed to reload');
  }

  return data.payload;
}

/**
 * Test API key resolution
 */
export async function testApiKey(
  value: string,
  token?: string
): Promise<ApiKeyTestResult> {
  const response = await fetch(`${window.location.origin}/api/models-json/test-api-key`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ value }),
  });

  if (!response.ok) {
    throw new Error(`Failed to test API key: ${response.status}`);
  }

  const data = await response.json();
  if (!data.ok) {
    throw new Error(data.error || 'Failed to test API key');
  }

  return data.payload;
}

// ============================================
// Helper Functions
// ============================================

/**
 * Create a new custom provider config
 */
export function createCustomProvider(
  baseUrl: string,
  apiKey: string,
  api: string = 'openai-completions'
): ProviderConfig {
  return {
    baseUrl,
    apiKey,
    api,
    models: [],
  };
}

/**
 * Create a new custom model
 */
export function createCustomModel(
  id: string,
  name?: string,
  overrides?: Partial<CustomModel>
): CustomModel {
  return {
    id,
    name: name || id,
    input: ['text'],
    contextWindow: 128000,
    maxTokens: 16384,
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    },
    ...overrides,
  };
}

/**
 * Add a model to a provider
 */
export function addModelToProvider(
  provider: ProviderConfig,
  model: CustomModel
): ProviderConfig {
  return {
    ...provider,
    models: [...(provider.models || []), model],
  };
}

/**
 * Remove a model from a provider
 */
export function removeModelFromProvider(
  provider: ProviderConfig,
  modelId: string
): ProviderConfig {
  return {
    ...provider,
    models: (provider.models || []).filter(m => m.id !== modelId),
  };
}

/**
 * Check if a value is a shell command
 */
export function isShellCommand(value: string): boolean {
  return value.startsWith('!');
}

/**
 * Check if a value looks like an environment variable
 */
export function isEnvVar(value: string): boolean {
  return /^[A-Z][A-Z0-9_]*$/.test(value);
}

/**
 * Get the type of API key value
 */
export function getApiKeyType(value: string): 'shell' | 'env' | 'literal' {
  if (isShellCommand(value)) return 'shell';
  if (isEnvVar(value)) return 'env';
  return 'literal';
}

/**
 * Format API key for display (mask sensitive parts)
 */
export function maskApiKey(value: string): string {
  if (!value) return '';
  if (value.length <= 8) return '••••';
  return value.slice(0, 4) + '••••' + value.slice(-4);
}
