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
const DIRECT_MODEL_LOOKUP: Record<string, { provider: string; modelId: string }> = {
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
  // Format: "provider/model-id"
  if (fullModelId.includes('/')) {
    const [provider, modelId] = fullModelId.split('/');
    return { providerPrefix: provider.toLowerCase(), modelId };
  }
  
  // Direct model ID
  const lookup = DIRECT_MODEL_LOOKUP[fullModelId.toLowerCase()];
  if (lookup) {
    return { providerPrefix: lookup.provider, modelId: lookup.modelId };
  }
  
  return { providerPrefix: detectProvider(fullModelId), modelId: fullModelId };
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
    
    // Build model based on api type
    if (this.providerConfig.api_type === 'openai') {
      if (this.providerConfig.api_base) {
        // Custom OpenAI-compatible API
        model = (PiAI.getModel as any)('openai-responses', parsedModelId, {
          apiBase: this.providerConfig.api_base,
          apiKey: this.providerConfig.api_key || undefined,
        });
      } else {
        // Standard OpenAI
        model = (PiAI.getModel as any)('openai', parsedModelId);
      }
    } else if (this.providerConfig.api_type === 'anthropic') {
      // Anthropic
      model = (PiAI.getModel as any)('anthropic-messages', parsedModelId, {
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
