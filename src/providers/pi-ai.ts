/**
 * Pi-AI Provider Adapter (Refactored)
 * 
 * Unified LLM provider for xopcbot.
 * Now uses ModelRegistry for dynamic model loading.
 * 
 * Supports:
 * - Native models: OpenAI, Anthropic, Google, MiniMax, Groq, OpenRouter, xAI, etc.
 * - OpenAI-compatible APIs: Qwen, Kimi, DeepSeek via direct API
 * - Custom providers via models.json
 */

import * as PiAI from '@mariozechner/pi-ai';
import type { Model, Api } from '@mariozechner/pi-ai';
import type { LLMProvider } from '../types/index.js';
import type { Config } from '../config/schema.js';
import { getApiKey } from '../config/schema.js';
import { ModelRegistry } from './registry.js';
import { createProviderConfig } from './config.js';
import { buildProviderOptions } from './api-strategies.js';
import type {
  ChatMessage,
  ChatResponse,
  ToolCall,
  ContentPart,
  ToolDefinition,
} from './types.js';

export { PiAI };
export type { LLMProvider };

/** Provider configuration instance */
const providerConfig = createProviderConfig();

/** Pi-AI result type for completion */
interface PiAIResult {
  stopReason?: string;
  errorMessage?: string;
  content?: Array<{ type: string; text?: string; id?: string; name?: string; arguments?: unknown }>;
  usage?: {
    input?: number;
    output?: number;
    totalTokens?: number;
  };
}

export class LLMProviderImpl implements LLMProvider {
  private model: Model<Api>;
  private modelId: string;
  private registry: ModelRegistry;
  private config: Config;

  constructor(config: Config, modelId: string) {
    this.config = config;
    this.modelId = modelId;
    this.registry = new ModelRegistry(config);

    const model = this.registry.findByRef(modelId);

    if (!model) {
      throw new Error(`Model not found: ${modelId}. Run 'xopcbot models list' to see available models.`);
    }

    this.model = model;
  }

  private getApiKey(): string | undefined {
    return getApiKey(this.config, this.model.provider);
  }

  async chat(
    messages: ChatMessage[],
    tools?: ToolDefinition[],
    _model?: string,
    maxTokens?: number,
    temperature?: number
  ): Promise<ChatResponse> {
    const apiKey = this.getApiKey();
    const context = this.buildContext(messages, tools);

    try {
      // Base options
      const options: Record<string, unknown> = {
        apiKey,
        maxTokens,
        temperature: temperature ?? providerConfig.defaultTemperature,
      };

      // Apply provider-specific strategy options
      const providerOptions = buildProviderOptions(this.model.api, {
        reasoning: this.model.reasoning,
        maxTokens,
        modelMaxTokens: Math.min(this.model.maxTokens, providerConfig.maxThinkingBudgetTokens),
        thinkingFormat: (this.model.compat as { thinkingFormat?: string })?.thinkingFormat,
      });

      Object.assign(options, providerOptions);

      const result = await PiAI.complete(this.model, context as unknown as Parameters<typeof PiAI.complete>[1], options as unknown as Parameters<typeof PiAI.complete>[2]) as PiAIResult;

      if (result.stopReason === 'error' || result.stopReason === 'aborted') {
        return {
          content: null,
          tool_calls: [],
          finish_reason: result.stopReason,
          error: result.errorMessage || 'Unknown error',
        };
      }

      // Parse response
      const contentArray = Array.isArray(result.content) ? result.content : [];
      const textContent = contentArray
        .filter((c): c is { type: 'text'; text: string } => c.type === 'text' && typeof c.text === 'string')
        .map((c) => c.text)
        .join('');

      const toolCalls: ToolCall[] = contentArray
        .filter((c) => c.type === 'toolCall')
        .map((tc) => ({
          id: tc.id || '',
          type: 'function' as const,
          function: {
            name: tc.name || '',
            arguments: typeof tc.arguments === 'string'
              ? tc.arguments
              : JSON.stringify(tc.arguments || {}),
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
        content: null,
        tool_calls: [],
        finish_reason: 'error',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private buildContext(messages: ChatMessage[], tools?: ToolDefinition[]) {
    return {
      messages: messages.map((m) => this.normalizeMessage(m)),
      tools: tools?.map((t) => this.normalizeTool(t)),
    };
  }

  private normalizeMessage(m: ChatMessage): Record<string, unknown> {
    // Handle toolResult messages
    if (m.role === 'toolResult') {
      return {
        role: 'toolResult',
        toolCallId: m.toolCallId,
        toolName: m.toolName,
        content: m.content,
        isError: m.isError,
        timestamp: m.timestamp ?? Date.now(),
      };
    }

    // Handle regular messages
    let content: ContentPart[] = [];

    if (typeof m.content === 'string') {
      content = [{ type: 'text', text: m.content }];
    } else if (Array.isArray(m.content)) {
      content = m.content.map((c: ContentPart): ContentPart => {
        if (c.type === 'text') {
          return { type: 'text', text: c.text };
        } else if (c.type === 'image') {
          return { type: 'image', data: c.data, mimeType: c.mimeType };
        }
        return { type: 'text', text: JSON.stringify(c) };
      });
    } else {
      content = [{ type: 'text', text: String(m.content) }];
    }

    return {
      role: m.role,
      content,
      timestamp: m.timestamp ?? Date.now(),
    };
  }

  private normalizeTool(t: ToolDefinition): Record<string, unknown> {
    return {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    };
  }

  getDefaultModel(): string {
    return this.modelId;
  }

  getModelInfo(): { id: string; provider: string; contextWindow: number; maxTokens: number } {
    return {
      id: this.model.id,
      provider: this.model.provider,
      contextWindow: this.model.contextWindow,
      maxTokens: this.model.maxTokens,
    };
  }

  calculateCost(usage: { input: number; output: number; cacheRead?: number; cacheWrite?: number }): number {
    const cost = PiAI.calculateCost(this.model, {
      input: usage.input,
      output: usage.output,
      cacheRead: usage.cacheRead ?? 0,
      cacheWrite: usage.cacheWrite ?? 0,
      totalTokens: usage.input + usage.output,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    });
    return cost.total;
  }
}

// ============================================
// Factory Functions
// ============================================

/**
 * Create a provider instance
 */
export function createProvider(config: Config, modelId: string): LLMProviderImpl {
  return new LLMProviderImpl(config, modelId);
}

/**
 * Get list of available models
 */
export function getAvailableModels(config: Config) {
  const registry = new ModelRegistry(config);
  const models = registry.getAll();

  // Filter to only models with configured auth
  const available = models.filter((m) => {
    const apiKey = getApiKey(config, m.provider);
    return !!apiKey || m.provider === 'ollama';
  });

  return available.map((m) => ({
    id: `${m.provider}/${m.id}`,
    name: m.name,
    provider: m.provider,
    contextWindow: m.contextWindow,
    maxTokens: m.maxTokens,
    reasoning: m.reasoning,
    input: m.input,
  }));
}

/**
 * List all models (including unavailable ones)
 */
export function listAllModels(config: Config) {
  const registry = new ModelRegistry(config);
  const models = registry.getAll();

  // Group by provider
  const byProvider = new Map<string, typeof models>();
  for (const model of models) {
    const list = byProvider.get(model.provider) ?? [];
    list.push(model);
    byProvider.set(model.provider, list);
  }

  return byProvider;
}
