/**
 * Pi-AI Provider Adapter
 * 
 * Unified LLM provider for xopcbot.
 * Supports:
 * - OpenAI-compatible APIs (qwen, kimi, deepseek, groq, etc.)
 * - Anthropic-compatible APIs (anthropic, minimax)
 * - Native APIs (google)
 */

import * as PiAI from '@mariozechner/pi-ai';
import type { LLMProvider } from '../types/index.js';
import type { Config } from '../config/schema.js';
import { 
  parseModelId, 
  getApiKey, 
  getApiBase, 
  isOpenAICompatible,
  isAnthropicCompatible 
} from '../config/schema.js';

export { PiAI };
export type { LLMProvider };

// ============================================
// Provider Implementation
// ============================================

export class LLMProviderImpl implements LLMProvider {
  private model: PiAI.Model<PiAI.Api>;
  private modelId: string;

  constructor(config: Config, modelId: string) {
    this.modelId = modelId;
    const { provider, model } = parseModelId(modelId);
    
    const apiKey = getApiKey(config, provider);
    const apiBase = getApiBase(config, provider);
    const isOpenAI = isOpenAICompatible(provider);
    const isAnthropic = isAnthropicCompatible(provider);
    
    let piModel: PiAI.Model<PiAI.Api> | null = null;
    
    // Strategy 1: Anthropic-compatible providers (use minimax provider, not anthropic-messages API)
    if (isAnthropic) {
      piModel = (PiAI.getModel as any)('minimax', model) || 
                (PiAI.getModel as any)('anthropic-messages', model);
    }
    // Strategy 2: OpenAI-compatible providers
    else if (isOpenAI && apiBase) {
      piModel = (PiAI.getModel as any)('openai-responses', model, {
        apiBase,
        apiKey: apiKey || undefined,
      });
    }
    // Strategy 3: Anthropic native
    else if (provider === 'anthropic') {
      piModel = (PiAI.getModel as any)('anthropic-messages', model, {
        apiKey: apiKey || undefined,
      });
    }
    // Strategy 4: Google native
    else if (provider === 'google') {
      piModel = (PiAI.getModel as any)('google-generative-ai', model, {
        apiKey: apiKey || undefined,
      });
    }
    // Strategy 5: Fallback - try all native providers
    if (!piModel) {
      const allProviders = ['openai', 'anthropic', 'google', 'groq', 'mistral', 'minimax'];
      for (const np of allProviders) {
        piModel = (PiAI.getModel as any)(np, model);
        if (piModel) break;
      }
    }
    
    if (!piModel) {
      throw new Error(`Model not found: ${modelId}`);
    }
    
    this.model = piModel;
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
    return this.modelId;
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

export function createProvider(config: Config, modelId: string): LLMProviderImpl {
  return new LLMProviderImpl(config, modelId);
}

export function getAvailableModels(_config: Config) {
  // Return builtin models (custom models would need separate handling)
  return [];
}
