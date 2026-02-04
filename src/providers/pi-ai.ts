/**
 * Pi-AI Provider Adapter
 * 
 * Wraps @mariozechner/pi-ai to work with xopcbot's LLMProvider interface.
 * Supports 20+ LLM providers with unified API.
 * Supports custom providers via models configuration.
 */

import * as PiAI from '@mariozechner/pi-ai';
import type { LLMProvider, LLMMessage, LLMResponse, ProviderConfig, ToolCall } from '../types/index.js';
import type { Config, ModelDefinition } from '../config/schema.js';
import { getApiBase, getApiKey, getApiType, getModelDefinition, BUILTIN_MODELS } from '../config/schema.js';

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
  'minimax-': 'openai',
  
  // Qwen (OpenAI compatible)
  'qwen/': 'openai',
  'qwen-': 'openai',
  'qwq-': 'openai',
  
  // Kimi/Moonshot (OpenAI compatible)
  'kimi/': 'openai',
  'kimi-': 'openai',
  'moonshotai/': 'openai',
};

// Known models with correct casing
const KNOWN_MODEL_IDS: Record<string, string> = {
  'minimax-m2.1': 'MiniMax-M2.1',
  'minimax-m2': 'MiniMax-M2',
  'minimax-m1': 'MiniMax-M1',
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
// Message Conversion
// ============================================

interface PiAIMessage {
  role: 'user' | 'assistant' | 'tool' | 'toolResult';
  content: string | Array<{ type: string; text?: string; id?: string; name?: string; arguments?: Record<string, unknown> }>;
  timestamp: number;
  toolCallId?: string;
  toolName?: string;
  isError?: boolean;
}

function buildPiAIMessages(messages: LLMMessage[]): PiAIMessage[] {
  return messages.map(m => {
    const msg: PiAIMessage = {
      role: m.role as 'user' | 'assistant' | 'tool',
      content: typeof m.content === 'string' ? m.content : '',
      timestamp: Date.now(),
    };

    if (m.role === 'tool' && m.tool_call_id) {
      msg.role = 'toolResult';
      msg.toolCallId = m.tool_call_id;
      msg.toolName = m.name || 'unknown';
      msg.content = typeof m.content === 'string' ? m.content : '';
      msg.isError = false;
    }

    return msg;
  });
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
    const { modelId: parsedModelId, providerPrefix } = parseModelId(modelId);
    
    // Get custom model definition if exists
    this.modelDefinition = getModelDefinition(config, modelId);
    
    // Get configuration
    const apiBase = getApiBase(config, modelId);
    const apiType = getApiType(config, modelId);
    const apiKey = getApiKey(config, providerPrefix);
    
    let model: PiAI.Model<PiAI.Api> | null = null;
    
    // Check if it's a custom provider/model
    const isCustomProvider = config.models?.providers?.[providerPrefix];
    
    if (isCustomProvider && this.modelDefinition) {
      // Create custom model for user-defined models
      model = createCustomModel({
        id: parsedModelId,
        name: this.modelDefinition.name,
        provider: providerPrefix,
        api: apiType === 'anthropic' ? 'anthropic-messages' : 'openai-responses',
        baseUrl: apiBase || '',
        cost: {
          input: this.modelDefinition.cost?.input || 0,
          output: this.modelDefinition.cost?.output || 0,
          cacheRead: this.modelDefinition.cost?.cacheRead,
          cacheWrite: this.modelDefinition.cost?.cacheWrite,
        },
        contextWindow: this.modelDefinition.contextWindow || 131072,
        maxTokens: this.modelDefinition.maxTokens || 4096,
        reasoning: this.modelDefinition.reasoning || false,
        input: this.modelDefinition.input || ['text'],
      });
    } else if (this.modelDefinition) {
      // Built-in model with custom definition
      const providerInfo = detectProvider(modelId);
      model = createCustomModel({
        id: parsedModelId,
        name: this.modelDefinition.name,
        provider: providerPrefix,
        api: apiType === 'anthropic' ? 'anthropic-messages' : 'openai-responses',
        baseUrl: apiBase || '',
        cost: {
          input: this.modelDefinition.cost?.input || 0,
          output: this.modelDefinition.cost?.output || 0,
        },
        contextWindow: this.modelDefinition.contextWindow || 131072,
        maxTokens: this.modelDefinition.maxTokens || 4096,
        reasoning: this.modelDefinition.reasoning || false,
        input: this.modelDefinition.input || ['text'],
      });
    } else {
      // Try to get from pi-ai's registry
      if (apiType === 'openai') {
        if (apiBase) {
          model = (PiAI.getModel as any)('openai-responses', parsedModelId, {
            apiBase,
            apiKey,
          });
        } else {
          model = (PiAI.getModel as any)('openai', parsedModelId);
        }
      } else if (apiType === 'anthropic') {
        model = (PiAI.getModel as any)('anthropic-messages', parsedModelId, {
          apiKey,
        });
      }
      
      // Fallback to detected provider
      if (!model) {
        const detectedProvider = detectProvider(modelId);
        model = (PiAI.getModel as any)(detectedProvider, parsedModelId);
      }
    }
    
    if (!model) {
      throw new Error(`Model not found: ${modelId}`);
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
    // Build pi-ai compatible messages
    const piAiMessages = buildPiAIMessages(messages);

    const context = {
      messages: piAiMessages,
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

      // Extract text content
      const textContent = (result.content || [])
        .filter((c: any) => c.type === 'text')
        .map((c: any) => c.text)
        .join('');

      // Extract tool calls
      const toolCalls: ToolCall[] = (result.content || [])
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

export function listAvailableModels(config: Config) {
  const models: Array<{ id: string; name: string; provider: string }> = [];
  
  // Add custom provider models first
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
