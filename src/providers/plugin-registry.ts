/**
 * Provider Plugin Registry
 * 
 *  Registry for managing plugin-based LLM providers.
 */

import type { ProviderPlugin, ProviderRegistry, ProviderModelDefinition } from '../extensions/types/providers.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('Provider:Registry');

// ============================================================================
// Provider Plugin Registry Implementation
// ============================================================================

export class ProviderPluginRegistry implements ProviderRegistry {
  private providers = new Map<string, ProviderPlugin>();

  /**
   * Register a new provider
   */
  register(provider: ProviderPlugin): void {
    if (this.providers.has(provider.id)) {
      log.warn(`Provider "${provider.id}" already registered, overwriting`);
    }
    
    // Validate provider
    if (!provider.id) {
      throw new Error('Provider must have an id');
    }
    if (!provider.name) {
      throw new Error('Provider must have a name');
    }
    if (!provider.createStream || typeof provider.createStream !== 'function') {
      throw new Error('Provider must implement createStream method');
    }
    
    this.providers.set(provider.id, provider);
    log.info(`Registered provider: ${provider.name} (${provider.id})`);
  }

  /**
   * Get a provider by ID
   */
  get(id: string): ProviderPlugin | undefined {
    return this.providers.get(id);
  }

  /**
   * List all registered providers
   */
  listAll(): ProviderPlugin[] {
    return Array.from(this.providers.values());
  }

  /**
   * Get models for a specific provider
   */
  getModels(providerId: string): ProviderModelDefinition[] {
    const provider = this.providers.get(providerId);
    return provider?.models || [];
  }

  /**
   * Check if a provider is registered
   */
  has(id: string): boolean {
    return this.providers.has(id);
  }

  /**
   * Unregister a provider
   */
  unregister(id: string): boolean {
    const deleted = this.providers.delete(id);
    if (deleted) {
      log.info(`Unregistered provider: ${id}`);
    }
    return deleted;
  }

  /**
   * Get all available model IDs across all providers
   */
  getAllModelIds(): string[] {
    const modelIds: string[] = [];
    for (const provider of this.providers.values()) {
      for (const model of provider.models) {
        modelIds.push(`${provider.id}:${model.id}`);
      }
    }
    return modelIds;
  }

  /**
   * Find a model across all providers
   */
  findModel(modelId: string): { provider: ProviderPlugin; model: ProviderModelDefinition } | undefined {
    // Check if it's prefixed with provider:model
    if (modelId.includes(':')) {
      const [providerId, actualModelId] = modelId.split(':');
      const provider = this.providers.get(providerId);
      if (provider) {
        const model = provider.models.find(m => m.id === actualModelId);
        if (model) {
          return { provider, model };
        }
      }
    }
    
    // Search across all providers
    for (const provider of this.providers.values()) {
      const model = provider.models.find(m => m.id === modelId);
      if (model) {
        return { provider, model };
      }
    }
    
    return undefined;
  }

  /**
   * Get provider by model ID
   */
  getProviderForModel(modelId: string): ProviderPlugin | undefined {
    return this.findModel(modelId)?.provider;
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let globalRegistry: ProviderPluginRegistry | null = null;

export function getProviderRegistry(): ProviderPluginRegistry {
  if (!globalRegistry) {
    globalRegistry = new ProviderPluginRegistry();
  }
  return globalRegistry;
}

export function setProviderRegistry(registry: ProviderPluginRegistry): void {
  globalRegistry = registry;
}
