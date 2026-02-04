/**
 * Pi-AI Provider Adapter
 * 
 * Wraps @mariozechner/pi-ai to work with xopcbot's LLMProvider interface.
 * Supports 20+ LLM providers with unified API.
 */

import * as PiAI from '@mariozechner/pi-ai';
import type { LLMProvider, LLMMessage, LLMResponse, ProviderConfig } from '../types/index.js';
import { getApiBase } from '../config/schema.js';

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

function parseModelId(fullModelId: string): { modelId: string; provider: PiAI.KnownProvider } {
  if (fullModelId.includes('/')) {
    const [provider, modelId] = fullModelId.split('/');
    const normalizedModelId = KNOWN_MODEL_IDS[modelId.toLowerCase()] || modelId;
    return { modelId: normalizedModelId, provider: provider as PiAI.KnownProvider };
  }
  
  const detectedProvider = detectProvider(fullModelId);
  const normalizedModelId = KNOWN_MODEL_IDS[fullModelId.toLowerCase()] || fullModelId;
  return { modelId: normalizedModelId, provider: detectedProvider };
}

// ============================================
// Pi-AI Provider Implementation
// ============================================

export class PiAIProvider implements LLMProvider {
  private model: PiAI.Model<PiAI.Api>;
  private config: Record<string, ProviderConfig>;

  constructor(config: Record<string, ProviderConfig>, modelId: string) {
    this.config = config;
    const { modelId: parsedModelId, provider } = parseModelId(modelId);
    
    // Get API base URL for OpenAI-compatible providers
    const apiBase = getApiBase({ providers: config } as any, modelId);
    
    // Build model with custom API base if needed
    let model: PiAI.Model<PiAI.Api> | null = null;
    
    if (apiBase && provider === 'openai') {
      // Create OpenAI-compatible model with custom base URL
      model = (PiAI.getModel as any)('openai', parsedModelId, {
        apiBase,
      });
    }
    
    if (!model) {
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
        maxTokens,
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
  providersConfig: Record<string, ProviderConfig>,
  modelId: string
): PiAIProvider {
  return new PiAIProvider(providersConfig, modelId);
}
