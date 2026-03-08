/**
 * Registry Client for Frontend
 * 
 * Fetches provider/model info from backend API.
 * Replaces the old provider-templates.js and dynamic-providers.js
 */

import type { ModelConfig } from '../pages/SettingsPage.js';

// Define interfaces directly (previously imported from provider-templates.js)
export interface RegistryAuth {
  type: string;
  supportsOAuth: boolean;
  oauthProviderId?: string;
}

export interface RegistryCapabilities {
  streaming: boolean;
  functionCalling: boolean;
  vision: boolean;
  reasoning: boolean;
}

export interface RegistryModel {
  ref: string;
  id: string;
  name: string;
  reasoning: boolean;
  input: string[];
  contextWindow: number;
  maxTokens: number;
  cost: { input: number; output: number };
  recommended: boolean;
  source: string;
}

export interface RegistryProvider {
  id: string;
  name: string;
  baseUrl: string;
  api: string;
  auth: RegistryAuth;
  capabilities: RegistryCapabilities;
  configured: boolean;
  models: RegistryModel[];
}

export interface RegistryResponse {
  version: string;
  providers: RegistryProvider[];
}

// Provider template format for SettingsPage
export interface ProviderTemplate {
  id: string;
  name: string;
  baseUrl: string;
  api: string;
  authType: 'api_key' | 'oauth';
  oauthProviderId?: string;
  models: ModelConfig[];
}

let _cache: RegistryResponse | null = null;

/**
 * Fetch full registry from backend
 */
export async function fetchRegistry(token?: string): Promise<RegistryResponse> {
  if (_cache) return _cache;

  const response = await fetch(`${window.location.origin}/api/registry`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

  if (!response.ok) {
    throw new Error('Failed to load registry');
  }

  const data = await response.json();
  _cache = data.payload;
  return _cache;
}

/**
 * Clear registry cache (call after saving settings)
 */
export function clearRegistryCache(): void {
  _cache = null;
}

/**
 * Get all providers
 */
export async function fetchProviders(token?: string): Promise<RegistryProvider[]> {
  const registry = await fetchRegistry(token);
  return registry.providers;
}

/**
 * Get configured providers only
 */
export async function fetchConfiguredProviders(token?: string): Promise<RegistryProvider[]> {
  const providers = await fetchProviders(token);
  return providers.filter(p => p.configured);
}

/**
 * Get all models as flat list
 */
export async function fetchAllModels(token?: string): Promise<RegistryModel[]> {
  const providers = await fetchProviders(token);
  return providers.flatMap(p => p.models);
}

/**
 * Get configured models only
 */
export async function fetchConfiguredModels(token?: string): Promise<RegistryModel[]> {
  const providers = await fetchConfiguredProviders(token);
  return providers.flatMap(p => p.models);
}

/**
 * Convert registry provider to ProviderTemplate format (for SettingsPage compatibility)
 */
export function toProviderTemplates(providers: RegistryProvider[]): ProviderTemplate[] {
  return providers.map(p => ({
    id: p.id,
    name: p.name,
    baseUrl: p.baseUrl,
    api: p.api,
    authType: p.auth.supportsOAuth ? 'oauth' : 'api_key',
    oauthProviderId: p.auth.oauthProviderId,
    models: p.models.map(m => ({
      id: m.id,
      name: m.name,
      capabilities: {
        text: m.input.includes('text'),
        image: m.input.includes('image'),
        reasoning: m.reasoning,
      },
      contextWindow: m.contextWindow,
      maxTokens: m.maxTokens,
      cost: m.cost,
    })),
  }));
}
