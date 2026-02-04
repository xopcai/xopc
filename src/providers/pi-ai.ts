/**
 * Provider Factory
 * 
 * Uses @mariozechner/pi-ai for unified LLM access.
 * Supports 20+ providers: OpenAI, Anthropic, Google, Qwen, Kimi, MiniMax, etc.
 */

import * as PiAI from '@mariozechner/pi-ai';
import type { LLMProvider } from '../types/index.js';
import type { Config, ProviderConfig } from '../config/schema.js';
import { getProviderConfig, getApiBase, getApiType } from '../config/schema.js';

export { PiAI };
export type { LLMProvider };

// ============================================
// Provider Mapping
// ============================================

const MODEL_TO_PROVIDER: Record<string, PiAI.KnownProvider> = {
  // OpenAI
  'gpt-': 'openai', 'o1-': 'openai', 'o3-': 'openai', 'o4-': 'openai',
  
  // Anthropic
  'claude-': 'anthropic', 'sonnet': 'anthropic', 'haiku': 'anthropic',
  
  // Google
  'gemini-': 'google', 'gemma-': 'google',
  
  // Groq
  'groq/': 'openai', 'llama-': 'openai',
  
  // DeepSeek
  'deepseek/': 'openai',
  
  // MiniMax
  'minimax/': 'openai', 'minimax-': 'openai',
  
  // Qwen
  'qwen/': 'openai', 'qwen-': 'openai', 'qwq-': 'openai',
  
  // Kimi/Moonshot
  'kimi/': 'openai', 'kimi-': 'openai', 'moonshot/': 'openai',
};

// Models that need special casing for pi-ai registry
// Maps user input to the correct pi-ai model ID
const MODEL_ID_NORMALIZATION: Record<string, { provider: string; modelId: string }> = {
  // MiniMax variations
  'minimax/m2.1': { provider: 'minimax', modelId: 'MiniMax-M2.1' },
  'minimax/m2': { provider: 'minimax', modelId: 'MiniMax-M2' },
  'minimax/m1': { provider: 'minimax', modelId: 'MiniMax-M1' },
  'minimax-m2.1': { provider: 'minimax', modelId: 'MiniMax-M2.1' },
  'minimax-m2': { provider: 'minimax', modelId: 'MiniMax-M2' },
  'minimax-m1': { provider: 'minimax', modelId: 'MiniMax-M1' },
};

// ============================================
// Custom Model Factory
// ============================================

interface CustomModelConfig {
  id: string;
  name: string;
  provider: string;
  api: string;
  baseUrl: string;
  cost: { input: number; output: number; cacheRead?: number; cacheWrite?: number };
  contextWindow: number;
  maxTokens: number;
  reasoning: boolean;
  input: string[];
}

function createCustomModel(config: CustomModelConfig): PiAI.Model<PiAI.Api> {
  return {
    id: config.id,
    name: config.name,
    provider: config.provider,
    api: config.api as PiAI.Api,
    baseUrl: config.baseUrl,
    cost: config.cost,
    contextWindow: config.contextWindow,
    maxTokens: config.maxTokens,
    reasoning: config.reasoning,
    input: config.input as ('text' | 'image')[],
  } as PiAI.Model<PiAI.Api>;
}

// ============================================
// Utility Functions
// ============================================

function detectProvider(modelId: string): PiAI.KnownProvider {
  for (const [prefix, provider] of Object.entries(MODEL_TO_PROVIDER)) {
    if (modelId.toLowerCase().includes(prefix.toLowerCase())) {
      return provider;
    }
  }
  return 'openai';
}

function parseModelId(fullModelId: string) {
  // Format: "provider/model-id" - check normalization table first
  const lookup = MODEL_ID_NORMALIZATION[fullModelId.toLowerCase()];
  if (lookup) {
    return { providerPrefix: lookup.provider, modelId: lookup.modelId };
  }
  
  // Format: "provider/model-id"
  if (fullModelId.includes('/')) {
    const [provider, modelId] = fullModelId.split('/');
    const providerLower = provider.toLowerCase();
    
    // Check if modelId needs normalization
    const combinedKey = `${providerLower}/${modelId.toLowerCase()}`;
    const combinedLookup = MODEL_ID_NORMALIZATION[combinedKey];
    if (combinedLookup) {
      return { providerPrefix: combinedLookup.provider, modelId: combinedLookup.modelId };
    }
    
    return { providerPrefix: providerLower, modelId };
  }
  
  // Direct model ID
  const directLookup = MODEL_ID_NORMALIZATION[fullModelId.toLowerCase()];
  if (directLookup) {
    return { providerPrefix: directLookup.provider, modelId: directLookup.modelId };
  }
  
  return { providerPrefix: detectProvider(fullModelId), modelId: fullModelId };
}

// Known providers that have native pi-ai support
// These providers exist in pi-ai's registry
const NATIVE_PROVIDERS = ['openai', 'anthropic', 'google', 'minimax', 'groq', 'mistral', 'openrouter'];

function isNativeProvider(provider: string): boolean {
  return NATIVE_PROVIDERS.includes(provider.toLowerCase());
}

// ============================================
// Pi-AI Provider Implementation
// ============================================

export class PiAIProvider implements LLMProvider {
  private model: PiAI.Model<PiAI.Api>;
  private providerConfig: ProviderConfig;
  private config: Config;

  constructor(config: Config, modelId: string) {
    this.config = config;
    const { providerPrefix, modelId: parsedModelId } = parseModelId(modelId);
    
    // Get provider config (merged from config + env vars)
    this.providerConfig = getProviderConfig(config, providerPrefix);
    
    let model: PiAI.Model<PiAI.Api> | null = null;
    
    // Try native pi-ai providers first
    if (isNativeProvider(providerPrefix)) {
      const native = providerPrefix.toLowerCase();
      
      if (native === 'anthropic') {
        model = (PiAI.getModel as any)('anthropic-messages', parsedModelId, {
          apiKey: this.providerConfig.api_key || undefined,
        });
      } else if (native === 'minimax') {
        model = (PiAI.getModel as any)('minimax', parsedModelId, {
          apiKey: this.providerConfig.api_key || undefined,
        });
      } else if (native === 'openai') {
        model = (PiAI.getModel as any)('openai', parsedModelId);
      } else if (native === 'google') {
        model = (PiAI.getModel as any)('google', parsedModelId);
      } else if (native === 'groq') {
        model = (PiAI.getModel as any)('groq', parsedModelId, {
          apiKey: this.providerConfig.api_key || undefined,
        });
      } else if (native === 'mistral') {
        model = (PiAI.getModel as any)('mistral', parsedModelId, {
          apiKey: this.providerConfig.api_key || undefined,
        });
      } else if (native === 'openrouter') {
        model = (PiAI.getModel as any)('openrouter', parsedModelId, {
          apiKey: this.providerConfig.api_key || undefined,
        });
      }
    }
    
    // If not found or has custom api_base, try OpenAI-compatible
    if (!model && this.providerConfig.api_base) {
      model = (PiAI.getModel as any)('openai-responses', parsedModelId, {
        apiBase: this.providerConfig.api_base,
        apiKey: this.providerConfig.api_key || undefined,
      });
    }
    
    // Fallback to detected provider
    if (!model) {
      const detected = detectProvider(parsedModelId);
      model = (PiAI.getModel as any)(detected, parsedModelId);
    }
    
    if (!model) {
      throw new Error(`Model not found: ${modelId}`);
    }
    
    this.model = model;
  }

  async chat(
    messages: any[],
    tools?: any[],
    _model?: string,
    maxTokens?: number,
    temperature?: number
  ): Promise<any> {
    const context = {
      messages: messages.map((m: any) => ({
        role: m.role,
        content: typeof m.content === 'string' ? m.content : '',
        timestamp: Date.now(),
      })),
      tools: tools?.map((t: any) => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      })),
    };

    try {
      const result = await (PiAI.complete as any)(this.model, context, {
        maxTokens,
        temperature: temperature ?? 0.7,
      });

      const textContent = (result.content || [])
        .filter((c: any) => c.type === 'text')
        .map((c: any) => c.text)
        .join('');

      const toolCalls = (result.content || [])
        .filter((c: any) => c.type === 'toolCall')
        .map((tc: any) => ({
          id: tc.id || '',
          type: 'function' as const,
          function: { 
            name: tc.name || '', 
            arguments: typeof tc.arguments === 'string' 
              ? tc.arguments 
              : JSON.stringify(tc.arguments || {}) 
          },
        }));

      return {
        content: textContent || null,
        tool_calls: toolCalls,
        finish_reason: result.stopReason || 'stop',
        usage: result.usage ? {
          prompt_tokens: result.usage.input || 0,
          completion_tokens: result.usage.output || 0,
          total_tokens: result.usage.totalTokens || 0,
        } : undefined,
      };
    } catch (error) {
      return {
        content: `Error: ${error instanceof Error ? error.message : String(error)}`,
        tool_calls: [],
        finish_reason: 'error',
      };
    }
  }

  getDefaultModel(): string {
    return this.model.id;
  }

  calculateCost(usage: { input: number; output: number; cacheRead?: number; cacheWrite?: number }): number {
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
// Factory
// ============================================

export function createProvider(config: Config, modelId: string): PiAIProvider {
  return new PiAIProvider(config, modelId);
}

export function getAvailableModels(config: Config) {
  const models: any[] = [];
  
  // Add custom providers' models if any
  // (Simplified - just returns builtin models for now)
  
  return models;
}
