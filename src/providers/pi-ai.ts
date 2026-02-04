/**
 * Pi-AI Provider Adapter
 * 
 * Wraps @mariozechner/pi-ai to work with xopcbot's LLMProvider interface.
 * Supports 20+ LLM providers with unified API.
 * Supports custom providers via models configuration.
 */

import * as PiAI from '@mariozechner/pi-ai';
import type { LLMProvider, LLMMessage, LLMResponse, ProviderConfig } from '../types/index.js';
import type { Config, ModelDefinition } from '../config/schema.js';
import { getApiBase, getApiKey, getApiType, getModelDefinition } from '../config/schema.js';

export { PiAI };
export type { LLMProvider };

// ============================================
// Provider Mapping
// ============================================
// Maps model ID prefixes to pi-ai providers

const MODEL_TO_PROVIDER: Record<string, PiAI.KnownProvider> = {
  // OpenAI
  'gpt-': 'openai',
  'o1-': 'openai',
  'o3-': 'openai',
  'o4-': 'openai',
  
  // Anthropic
  'claude-': 'anthropic',
  'sonnet': 'anthropic',
  'haiku': 'anthropic',
  
  // Google
  'gemini-': 'google',
  'gemma-': 'google',
  
  // Groq (uses OpenAI compatible API)
  'groq/': 'openai',
  'llama-': 'openai',
  
  // DeepSeek (OpenAI compatible)
  'deepseek/': 'openai',
  
  // MiniMax (OpenAI compatible)
  'minimax/': 'openai',
  
  // Qwen (OpenAI compatible)
  'qwen/': 'openai',
  
  // Kimi/Moonshot (OpenAI compatible)
  'kimi/': 'openai',
  'moonshotai/': 'openai',
};

// Known models with correct casing
const KNOWN_MODEL_IDS: Record<string, string> = {
  'minimax-m2.1': 'MiniMax-M2.1',
  'minimax-m2': 'MiniMax-M2',
  'minimax-m1': 'MiniMax-M1',
};

// ============================================
// Utility Functions
// ============================================

function detectProvider(modelId: string): PiAI.KnownProvider {
  for (const [prefix, provider] of Object.entries(MODEL_TO_PROVIDER)) {
    if (modelId.toLowerCase().includes(prefix.toLowerCase())) {
      return provider;
    }
  }
  return 'openai'; // Default to OpenAI
}

function parseModelId(fullModelId: string): { modelId: string; provider: PiAI.KnownProvider; providerPrefix: string } {
  if (fullModelId.includes('/')) {
    const [provider, modelId] = fullModelId.split('/');
    const normalizedModelId = KNOWN_MODEL_IDS[modelId.toLowerCase()] || modelId;
    return { 
      modelId: normalizedModelId, 
      provider: provider as PiAI.KnownProvider,
      providerPrefix: provider.toLowerCase() 
    };
  }
  
  const detectedProvider = detectProvider(fullModelId);
  const normalizedModelId = KNOWN_MODEL_IDS[fullModelId.toLowerCase()] || fullModelId;
  return { 
    modelId: normalizedModelId, 
    provider: detectedProvider,
    providerPrefix: fullModelId.toLowerCase()
  };
}

// ============================================
// Pi-AI Provider Implementation
// ============================================

export class PiAIProvider implements LLMProvider {
  private model: PiAI.Model<PiAI.Api>;
  private modelDefinition: ModelDefinition | null;
  private config: Config;

  constructor(config: Config, modelId: string) {
    this.config = config;
    const { modelId: parsedModelId, provider, providerPrefix } = parseModelId(modelId);
    
    // Get custom model definition if exists
    this.modelDefinition = getModelDefinition(config, modelId);
    
    // Get API base URL for OpenAI-compatible providers
    const apiBase = getApiBase(config, modelId);
    const apiType = getApiType(config, modelId);
    
    // Get API key
    const apiKey = getApiKey(config, providerPrefix);
    
    // Build model with custom API base if needed
    let model: PiAI.Model<PiAI.Api> | null = null;
    
    if (apiBase && apiType === 'openai') {
      // Create OpenAI-compatible model with custom base URL
      model = (PiAI.getModel as any)('openai', parsedModelId, {
        apiBase,
        apiKey,
      });
    }
    
    if (!model && apiType === 'anthropic') {
      // Anthropic provider
      model = (PiAI.getModel as any)('anthropic-messages', parsedModelId, {
        apiKey,
      });
    }
    
    if (!model) {
      // Try without custom base
      model = (PiAI.getModel as any)(provider, parsedModelId);
    }
    
    if (!model) {
      throw new Error(`Model not found: ${modelId} (provider: ${provider})`);
    }
    
    this.model = model;
  }

  async chat(
    messages: LLMMessage[],
    tools?: Array<{ name: string; description: string; parameters: Record<string, unknown> }>,
    _model?: string,
    maxTokens?: number,
    temperature?: number
  ): Promise<LLMResponse> {
    const context = {
      messages: messages.map(m => ({
        role: m.role as 'user' | 'assistant' | 'tool',
        content: typeof m.content === 'string' ? m.content : '',
        timestamp: Date.now(),
      })),
      tools: tools?.map(t => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      })),
    };

    try {
      const result = await (PiAI.complete as any)(this.model, context, {
        maxTokens: maxTokens || this.modelDefinition?.maxTokens,
        temperature: temperature ?? 0.7,
      });

      return {
        content: (result.content || [])
          .filter((c: any) => c.type === 'text')
          .map((c: any) => c.text)
          .join('') || null,
        tool_calls: (result.content || [])
          .filter((c: any) => c.type === 'toolCall')
          .map((tc: any) => ({
            id: tc.id,
            type: 'function' as const,
            function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
          })),
        finish_reason: result.stopReason,
        usage: result.usage ? {
          prompt_tokens: result.usage.input,
          completion_tokens: result.usage.output,
          total_tokens: result.usage.totalTokens,
        } : undefined,
      };
    } catch (error) {
      return {
        content: `Error calling LLM: ${error instanceof Error ? error.message : String(error)}`,
        tool_calls: [],
        finish_reason: 'error',
      };
    }
  }

  getDefaultModel(): string {
    return this.model.id;
  }

  calculateCost(usage: { input: number; output: number; cacheRead?: number; cacheWrite?: number }): number {
    // If custom cost is defined, use it
    if (this.modelDefinition?.cost) {
      const { input, output, cacheRead, cacheWrite } = this.modelDefinition.cost;
      const inputCost = (usage.input / 1000000) * (input || 0);
      const outputCost = (usage.output / 1000000) * (output || 0);
      const cacheReadCost = ((usage.cacheRead || 0) / 1000000) * (cacheRead || 0);
      const cacheWriteCost = ((usage.cacheWrite || 0) / 1000000) * (cacheWrite || 0);
      return inputCost + outputCost + cacheReadCost + cacheWriteCost;
    }
    
    // Fall back to pi-ai's cost calculation
    const cost = PiAI.calculateCost(this.model, {
      input: usage.input,
      output: usage.output,
      cacheRead: usage.cacheRead || 0,
      cacheWrite: usage.cacheWrite || 0,
      totalTokens: usage.input + usage.output,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    });
    return cost.total;
  }
}

// ============================================
// Factory Function
// ============================================

export function createPiAIProvider(
  config: Config,
  modelId: string
): PiAIProvider {
  return new PiAIProvider(config, modelId);
}

// ============================================
// Helper: List available models
// ============================================

export function listAvailableModels(config: Config): Array<{ id: string; name: string; provider: string }> {
  const models: Array<{ id: string; name: string; provider: string }> = [];
  
  // Add custom provider models
  if (config.models?.providers) {
    for (const [providerName, provider] of Object.entries(config.models.providers)) {
      for (const model of provider.models) {
        models.push({
          id: `${providerName}/${model.id}`,
          name: model.name,
          provider: providerName,
        });
      }
    }
  }
  
  return models;
}
