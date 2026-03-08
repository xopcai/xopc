/**
 * Dynamic Provider Manager
 * 
 * Dynamically loads providers and models from backend API.
 * Falls back to static templates when API is unavailable.
 */

import { getToken } from '../utils/storage.js';

// Helper to get auth headers
function getAuthHeaders(token?: string): Record<string, string> {
  const authToken = token || getToken();
  return authToken ? { 'Authorization': `Bearer ${authToken}` } : {};
}

// Cache for API response to avoid duplicate requests
let _cachedModelsResponse: Array<{
  id: string;
  name: string;
  provider: string;
  contextWindow?: number;
  maxTokens?: number;
  reasoning?: boolean;
  vision?: boolean;
  cost?: { input: number; output: number };
}> | null = null;

// Cache for /api/providers (all pi-ai supported models)
let _cachedAllProvidersResponse: Array<{
  id: string;
  name: string;
  provider: string;
  contextWindow?: number;
  maxTokens?: number;
  reasoning?: boolean;
  vision?: boolean;
  cost?: { input: number; output: number };
}> | null = null;

async function fetchModelsFromApi(token?: string): Promise<Array<{
  id: string;
  name: string;
  provider: string;
  contextWindow?: number;
  maxTokens?: number;
  reasoning?: boolean;
  vision?: boolean;
  cost?: { input: number; output: number };
}>> {
  // Return cached response if available
  if (_cachedModelsResponse) {
    return _cachedModelsResponse;
  }
  
  const url = window.location.origin;
  const response = await fetch(`${url}/api/models`, {
    headers: getAuthHeaders(token),
  });
  
  if (!response.ok) {
    console.warn('Failed to load models from API');
    return [];
  }
  
  const data = await response.json();
  const models = data?.payload?.models || [];
  
  // Cache the response
  _cachedModelsResponse = models;
  return models;
}

function clearModelsCache(): void {
  _cachedModelsResponse = null;
}

function clearAllProvidersCache(): void {
  _cachedAllProvidersResponse = null;
}

/**
 * Clear all caches - call this after saving settings
 */
export function clearProviderCaches(): void {
  clearModelsCache();
  clearAllProvidersCache();
}

// Fetch ALL pi-ai supported models (regardless of configuration)
async function fetchAllProvidersFromApi(token?: string): Promise<Array<{
  id: string;
  name: string;
  provider: string;
  contextWindow?: number;
  maxTokens?: number;
  reasoning?: boolean;
  vision?: boolean;
  cost?: { input: number; output: number };
}>> {
  if (_cachedAllProvidersResponse) {
    return _cachedAllProvidersResponse;
  }
  
  const url = window.location.origin;
  const response = await fetch(`${url}/api/providers`, {
    headers: getAuthHeaders(token),
  });
  
  if (!response.ok) {
    console.warn('Failed to load providers from API');
    return [];
  }
  
  const data = await response.json();
  const models = data?.payload?.models || [];
  _cachedAllProvidersResponse = models;
  return models;
}

import type { ModelConfig } from '../pages/SettingsPage.js';
import type { ProviderTemplate } from './provider-templates.js';
import { PROVIDER_TEMPLATES, getProviderTemplate } from './provider-templates.js';

export interface DynamicProviderInfo {
  id: string;
  name: string;
  baseUrl: string;
  api: string;
  authType: 'api_key' | 'oauth';
  oauthProviderId?: string;
  models: ModelConfig[];
}

/**
 * Map of known provider configurations from pi-ai
 * These are used to provide proper baseUrl and API type for dynamic providers
 */
const KNOWN_PROVIDER_CONFIGS: Record<string, {
  baseUrl: string;
  api: string;
  authType: 'api_key' | 'oauth';
  oauthProviderId?: string;
}> = {
  openai: {
    baseUrl: 'https://api.openai.com/v1',
    api: 'openai-responses',
    authType: 'api_key',
  },
  anthropic: {
    baseUrl: 'https://api.anthropic.com/v1',
    api: 'anthropic-messages',
    authType: 'api_key',
  },
  google: {
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    api: 'google-generative-ai',
    authType: 'api_key',
  },
  'google-vertex': {
    baseUrl: 'https://us-central1-aiplatform.googleapis.com/v1',
    api: 'google-generative-ai',
    authType: 'api_key',
  },
  deepseek: {
    baseUrl: 'https://api.deepseek.com/v1',
    api: 'openai-completions',
    authType: 'api_key',
  },
  qwen: {
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    api: 'openai-completions',
    authType: 'oauth',
    oauthProviderId: 'alibaba-cloud',
  },
  'kimi-coding': {
    baseUrl: 'https://api.moonshot.cn/v1',
    api: 'openai-completions',
    authType: 'oauth',
    oauthProviderId: 'kimi-coding',
  },
  minimax: {
    baseUrl: 'https://api.minimaxi.com/anthropic',
    api: 'anthropic-messages',
    authType: 'oauth',
    oauthProviderId: 'minimax-portal',
  },
  'minimax-cn': {
    baseUrl: 'https://platform.minimax.chat/anthropic',
    api: 'anthropic-messages',
    authType: 'oauth',
    oauthProviderId: 'minimax-cn',
  },
  groq: {
    baseUrl: 'https://api.groq.com/openai/v1',
    api: 'openai-completions',
    authType: 'api_key',
  },
  xai: {
    baseUrl: 'https://api.x.ai/v1',
    api: 'openai-completions',
    authType: 'api_key',
  },
  cerebras: {
    baseUrl: 'https://api.cerebras.ai/v1',
    api: 'openai-completions',
    authType: 'api_key',
  },
  mistral: {
    baseUrl: 'https://api.mistral.ai/v1',
    api: 'openai-completions',
    authType: 'api_key',
  },
  cohere: {
    baseUrl: 'https://api.cohere.ai/v2',
    api: 'openai-completions',
    authType: 'api_key',
  },
  azure: {
    baseUrl: '',
    api: 'openai-completions',
    authType: 'api_key',
  },
  bedrock: {
    baseUrl: '',
    api: 'bedrock-converse-stream',
    authType: 'api_key',
  },
  openrouter: {
    baseUrl: 'https://openrouter.ai/api/v1',
    api: 'openai-completions',
    authType: 'api_key',
  },
  ollama: {
    baseUrl: 'http://localhost:11434/v1',
    api: 'ollama',
    authType: 'api_key',
  },
  zai: {
    baseUrl: 'https://api.zai.dev/v1',
    api: 'openai-completions',
    authType: 'api_key',
  },
};

/**
 * Load dynamic providers from backend API (uses cache)
 * @param token Optional auth token
 */
export async function loadDynamicProviders(token?: string): Promise<DynamicProviderInfo[]> {
  try {
    const models = await fetchModelsFromApi(token);
    if (models.length === 0) {
      return getTemplateProviders();
    }
    
    // Group models by provider
    const providerMap = new Map<string, DynamicProviderInfo>();
    
    for (const model of models) {
      const providerId = model.provider;
      if (!providerMap.has(providerId)) {
        const knownConfig = KNOWN_PROVIDER_CONFIGS[providerId] || {
          baseUrl: '',
          api: 'openai-completions',
          authType: 'api_key',
        };
        
        providerMap.set(providerId, {
          id: providerId,
          name: formatProviderName(providerId),
          baseUrl: knownConfig.baseUrl,
          api: knownConfig.api,
          authType: knownConfig.authType,
          oauthProviderId: knownConfig.oauthProviderId,
          models: [],
        });
      }
      
      const provider = providerMap.get(providerId)!;
      provider.models.push({
        id: model.id.replace(`${providerId}/`, ''),
        name: model.name || model.id,
        capabilities: {
          text: true,
          image: model.id.includes('vision') || model.id.includes('vl') || model.id.includes('image'),
          reasoning: model.id.includes('reasoning') || model.id.includes('r1') || model.id.includes('thinking'),
        },
        contextWindow: 128000, // Default, will be updated when needed
        maxTokens: 8192,
      });
    }
    
    // Sort providers by name and models by name
    const providers = Array.from(providerMap.values());
    providers.sort((a, b) => a.name.localeCompare(b.name));
    for (const provider of providers) {
      provider.models.sort((a, b) => a.name.localeCompare(b.name));
    }
    
    return providers;
  } catch (err) {
    console.error('Error loading dynamic providers:', err);
    return getTemplateProviders();
  }
}

/**
 * Get providers from static templates (fallback)
 */
function getTemplateProviders(): DynamicProviderInfo[] {
  return PROVIDER_TEMPLATES.map(template => ({
    id: template.id,
    name: template.name,
    baseUrl: template.baseUrl,
    api: template.api,
    authType: template.authType,
    oauthProviderId: template.oauthProviderId,
    models: template.models.map(m => ({
      id: m.id,
      name: m.name,
      capabilities: {
        text: m.capabilities.text,
        image: m.capabilities.image,
        reasoning: m.capabilities.reasoning,
      },
      contextWindow: m.contextWindow,
      maxTokens: m.maxTokens,
    })),
  }));
}

/**
 * Convert DynamicProviderInfo to ProviderTemplate for UI
 */
export function toProviderTemplate(provider: DynamicProviderInfo): ProviderTemplate {
  return {
    id: provider.id,
    name: provider.name,
    authType: provider.authType,
    oauthProviderId: provider.oauthProviderId,
    baseUrl: provider.baseUrl,
    api: provider.api,
    models: provider.models.map(m => ({
      id: m.id,
      name: m.name,
      capabilities: m.capabilities,
      contextWindow: m.contextWindow,
      maxTokens: m.maxTokens,
    })),
  };
}

/**
 * Format provider ID to readable name
 */
function formatProviderName(providerId: string): string {
  // Check if we have a template with a nicer name
  const template = getProviderTemplate(providerId);
  if (template) {
    return template.name;
  }
  
  // Format the ID
  return providerId
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Get all available provider templates (static + dynamic)
 * This is used when user wants to add a new provider
 * @param token Optional auth token
 */
export async function getAllProviderTemplates(token?: string): Promise<ProviderTemplate[]> {
  try {
    // Use /api/providers to get ALL pi-ai supported models
    const models = await fetchAllProvidersFromApi(token);
    
    if (models.length > 0) {
      // Get all unique providers from the response
      const providerSet = new Set<string>();
      for (const model of models) {
        providerSet.add(model.provider);
      }
      
      // Convert to ProviderTemplate format
      const templates: ProviderTemplate[] = [];
      for (const providerId of Array.from(providerSet).sort()) {
        const knownConfig = KNOWN_PROVIDER_CONFIGS[providerId];
        if (knownConfig) {
          templates.push({
            id: providerId,
            name: formatProviderName(providerId),
            authType: knownConfig.authType,
            oauthProviderId: knownConfig.oauthProviderId,
            baseUrl: knownConfig.baseUrl,
            api: knownConfig.api,
            models: [],
          });
        }
      }
      
      if (templates.length > 0) {
        return templates;
      }
    }
  } catch (err) {
    console.warn('Failed to load provider templates from API:', err);
  }
  
  // Fallback to static templates
  return PROVIDER_TEMPLATES;
}
