/**
 * Pi-AI Provider Adapter
 * 
 * Unified LLM provider for xopcbot.
 * Supports:
 * - Native models: OpenAI, Anthropic, Google, MiniMax (via minimax provider), Groq, etc.
 * - OpenAI-compatible APIs: Qwen, Kimi, DeepSeek via direct API
 * - Bedrock models: Qwen, Kimi, MiniMax via Amazon Bedrock
 */

import * as PiAI from '@mariozechner/pi-ai';
import type { LLMProvider } from '../types/index.js';
import type { Config } from '../config/schema.js';
import { 
  parseModelId, 
  getApiKey, 
  getApiBase 
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
    
    // Try to get native model first
    let piModel = this.tryGetNativeModel(provider, model);
    
    // If no native model and API base is provided, create custom model
    if (!piModel && apiBase) {
      piModel = this.createCustomModel(provider, model, apiBase, apiKey);
    }
    
    if (!piModel) {
      throw new Error(`Model not found: ${modelId}`);
    }
    
    this.model = piModel;
  }

  /**
   * Try to get a natively supported model from pi-ai registry
   */
  private tryGetNativeModel(provider: string, model: string): PiAI.Model<PiAI.Api> | null {
    // Native MiniMax (via minimax provider with anthropic-messages API)
    if (provider === 'minimax') {
      return (PiAI.getModel as any)('minimax', model) || null;
    }
    
    // Native MiniMax China (via minimax-cn provider)
    if (provider === 'minimax-cn') {
      return (PiAI.getModel as any)('minimax-cn', model) || null;
    }
    
    // Native Anthropic (via anthropic provider)
    if (provider === 'anthropic') {
      return (PiAI.getModel as any)('anthropic', model) || null;
    }
    
    // Native OpenAI (via openai provider)
    if (provider === 'openai') {
      return (PiAI.getModel as any)('openai', model) || null;
    }
    
    // Native Google
    if (provider === 'google') {
      return (PiAI.getModel as any)('google', model) || null;
    }
    
    // Native Groq (includes some Qwen/Kimi models)
    if (provider === 'groq') {
      return (PiAI.getModel as any)('groq', model) || null;
    }
    
    // Native OpenRouter (includes Qwen3 Coder Plus)
    if (provider === 'openrouter') {
      return (PiAI.getModel as any)('openrouter', model) || null;
    }
    
    // Amazon Bedrock models (Qwen, Kimi, MiniMax via Bedrock)
    // Map provider prefixes to amazon-bedrock
    const bedrockProviders = ['qwen', 'moonshot', 'minimax'];
    if (bedrockProviders.includes(provider) && model.includes('.')) {
      // This is likely a Bedrock model ID
      return (PiAI.getModel as any)('amazon-bedrock', model) || null;
    }
    
    return null;
  }

  /**
   * Create a custom model for OpenAI-compatible APIs
   */
  private createCustomModel(
    provider: string, 
    model: string, 
    apiBase: string, 
    apiKey: string | null
  ): PiAI.Model<'openai-completions'> {
    // Determine OpenAI compat settings based on provider
    const compat = this.getOpenAICompat(provider);
    
    return {
      id: `${provider}/${model}`,
      name: `${this.formatProviderName(provider)} ${model}`,
      api: 'openai-completions',
      provider: provider,
      baseUrl: apiBase,
      reasoning: model.toLowerCase().includes('qwq') || model.toLowerCase().includes('thinking'),
      input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, // Unknown for custom endpoints
      contextWindow: 128000, // Default
      maxTokens: 16384, // Default
      compat,
      headers: apiKey ? { 'Authorization': `Bearer ${apiKey}` } : undefined,
    } as PiAI.Model<'openai-completions'>;
  }

  /**
   * Get OpenAI compatibility settings for specific providers
   */
  private getOpenAICompat(provider: string): PiAI.Model<'openai-completions'>['compat'] {
    switch (provider) {
      case 'qwen':
        return {
          thinkingFormat: 'qwen', // Qwen uses enable_thinking: boolean
          supportsDeveloperRole: false, // Qwen doesn't support developer role
        };
      case 'kimi':
      case 'moonshot':
        return {
          // Kimi uses standard OpenAI format but may have limitations
          supportsDeveloperRole: true,
        };
      case 'deepseek':
        return {
          // DeepSeek R1 supports reasoning - handled in chat method
        };
      default:
        return {};
    }
  }

  /**
   * Format provider name for display
   */
  private formatProviderName(provider: string): string {
    const names: Record<string, string> = {
      'qwen': 'Qwen',
      'kimi': 'Kimi',
      'moonshot': 'Moonshot',
      'deepseek': 'DeepSeek',
      'minimax': 'MiniMax',
      'minimax-cn': 'MiniMax (中国)',
      'anthropic': 'Anthropic',
      'openai': 'OpenAI',
      'google': 'Google',
      'groq': 'Groq',
      'openrouter': 'OpenRouter',
    };
    return names[provider] || provider.charAt(0).toUpperCase() + provider.slice(1);
  }

  async chat(
    messages: any[],
    tools?: any[],
    _model?: string,
    maxTokens?: number,
    temperature?: number
  ): Promise<any> {
    const context: any = {
      messages: messages.map((m: any) => {
        // Handle toolResult messages
        if (m.role === 'toolResult') {
          return {
            role: 'toolResult',
            toolCallId: m.tool_call_id || m.toolCallId || m.tool_call_id$,
            toolName: m.toolName || m.tool_call_id,
            content: m.content ? (
              typeof m.content === 'string' 
                ? [{ type: 'text', text: m.content }]
                : m.content
            ) : [{ type: 'text', text: String(m.content) }],
            isError: m.isError || false,
            timestamp: m.timestamp || Date.now(),
          };
        }
        
        // Handle regular messages
        let content: any[] = [];
        
        if (typeof m.content === 'string') {
          content = [{ type: 'text', text: m.content }];
        } else if (Array.isArray(m.content)) {
          // Handle multi-modal content (text + images)
          content = m.content.map((c: any) => {
            if (c.type === 'text') {
              return { type: 'text', text: c.text };
            } else if (c.type === 'image_url' || c.image_url) {
              // Handle image content
              const imageData = c.image_url?.data || c.data;
              const mimeType = c.image_url?.mime_type || c.mime_type || 'image/png';
              return { type: 'image', data: imageData, mimeType };
            }
            return { type: 'text', text: JSON.stringify(c) };
          });
        } else {
          content = [{ type: 'text', text: String(m.content) }];
        }
        
        return {
          role: m.role,
          content,
          timestamp: m.timestamp || Date.now(),
        };
      }),
      tools: tools?.map((t: any) => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      })),
    };

    try {
      const options: any = {
        maxTokens,
        temperature: temperature ?? 0.7,
      };

      // Add provider-specific options based on API type
      if (this.model.api === 'anthropic-messages') {
        options.thinkingEnabled = this.model.reasoning;
        options.thinkingBudgetTokens = maxTokens ? Math.min(maxTokens, 8192) : 8192;
      } else if (this.model.api === 'google-generative-ai') {
        options.thinking = {
          enabled: this.model.reasoning,
          budgetTokens: maxTokens ? Math.min(maxTokens, 8192) : 8192,
        };
      } else if (this.model.api === 'openai-completions' && this.model.reasoning) {
        // For models with reasoning support (like Qwen QwQ, DeepSeek R1)
        const compat = this.model.compat as any;
        if (compat?.thinkingFormat === 'qwen') {
          options.enableThinking = true;
        } else {
          options.reasoningEffort = 'medium';
        }
      }

      const result = await (PiAI.complete as any)(this.model, context, options);

      // Handle errors from the model response
      if (result.stopReason === 'error' || result.stopReason === 'aborted') {
        return {
          content: null,
          tool_calls: [],
          finish_reason: result.stopReason,
          error: result.errorMessage || 'Unknown error',
        };
      }

      // Ensure content is an array before processing
      const contentArray = Array.isArray(result.content) ? result.content : [];
      
      const textContent = contentArray
        .filter((c: any) => c.type === 'text')
        .map((c: any) => c.text)
        .join('');

      const toolCalls = contentArray
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
        content: null,
        tool_calls: [],
        finish_reason: 'error',
        error: error instanceof Error ? error.message : String(error),
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
