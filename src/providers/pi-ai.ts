/**
 * Pi-AI Provider Adapter
 * 
 * Wraps @mariozechner/pi-ai to work with xopcbot's LLMProvider interface.
 * Supports 20+ LLM providers with unified API, model discovery, and cost tracking.
 */

import * as PiAI from '@mariozechner/pi-ai';
import type { LLMProvider, LLMMessage, LLMResponse, ProviderConfig } from '../types/index.js';

export { PiAI };
export type { LLMProvider };

// ============================================================================
// Provider Mapping
// ============================================================================

const MODEL_TO_PROVIDER: Record<string, PiAI.KnownProvider> = {
  'gpt-': 'openai', 'o1-': 'openai', 'o3-': 'openai',
  'claude-': 'anthropic', 'sonnet': 'anthropic', 'haiku': 'anthropic',
  'gemini-': 'google', 'gemma-': 'google',
  'mistral-': 'mistral', 'mixtral-': 'mistral',
  'llama-': 'groq', 'grok-': 'xai',
  'deepseek-': 'openrouter',
  'command-r-': 'cerebras', 'minimax-': 'minimax',
};

// ============================================================================
// Utility Functions
// ============================================================================

function detectProvider(modelId: string): PiAI.KnownProvider {
  for (const [prefix, provider] of Object.entries(MODEL_TO_PROVIDER)) {
    if (modelId.toLowerCase().includes(prefix.toLowerCase())) {
      return provider;
    }
  }
  return 'openai';
}

function parseModelId(fullModelId: string): { modelId: string; provider: PiAI.KnownProvider } {
  if (fullModelId.includes('/')) {
    const [provider, modelId] = fullModelId.split('/');
    return { modelId, provider: provider as PiAI.KnownProvider };
  }
  return { modelId: fullModelId, provider: detectProvider(fullModelId) };
}

// ============================================================================
// Pi-AI Provider Implementation
// ============================================================================

export class PiAIProvider implements LLMProvider {
  private model: PiAI.Model<PiAI.Api>;

  constructor(private config: Record<string, ProviderConfig>, modelId: string) {
    const { modelId: parsedModelId, provider } = parseModelId(modelId);
    const model = (PiAI.getModel as any)(provider, parsedModelId);
    
    if (!model) {
      throw new Error(`Model not found: ${modelId} (provider: ${provider})`);
    }
    this.model = model;
  }

  async chat(
    messages: LLMMessage[],
    tools?: Array<{ name: string; description: string; parameters: Record<string, unknown> }>,
    model?: string,
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

// ============================================================================
// Factory Function
// ============================================================================

export function createPiAIProvider(
  providersConfig: Record<string, ProviderConfig>,
  modelId: string
): PiAIProvider {
  return new PiAIProvider(providersConfig, modelId);
}
