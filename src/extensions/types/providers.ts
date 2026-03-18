/**
 * Extension System - Provider Plugin Types
 * 
 *  Provider plugin system for customizable LLM backends.
 */

import type { AgentMessage } from '@mariozechner/pi-agent-core';

// ============================================================================
// Provider Plugin Interface
// ============================================================================

export interface ProviderPlugin {
  /** Unique provider identifier */
  id: string;
  /** Human-readable name */
  name: string;
  /** Provider description */
  description?: string;
  /** Supported model definitions */
  models: ProviderModelDefinition[];
  /** Create a streaming response */
  createStream(params: ProviderStreamParams): AsyncIterable<ProviderStreamChunk>;
  /** Check if the provider is properly configured */
  isConfigured?(config: Record<string, unknown>): boolean;
  /** Get required environment variables */
  requiredEnvVars?(): string[];
  /** Get default model */
  defaultModel?: string;
  /** Supported capabilities */
  capabilities?: ProviderCapabilities;
}

export interface ProviderModelDefinition {
  /** Model ID */
  id: string;
  /** Display name */
  name: string;
  /** Context window size in tokens */
  contextWindow?: number;
  /** Maximum output tokens */
  maxOutputTokens?: number;
  /** Supports image input */
  supportsImages?: boolean;
  /** Supports tool/function calling */
  supportsTools?: boolean;
  /** Supports streaming */
  supportsStreaming?: boolean;
  /** Supports JSON mode */
  supportsJson?: boolean;
  /** Pricing info */
  pricing?: {
    input: number;  // per 1M tokens
    output: number;
  };
}

export interface ProviderCapabilities {
  /** Supports multimodal input */
  multimodal?: boolean;
  /** Supports function calling */
  functionCalling?: boolean;
  /** Supports JSON output */
  json?: boolean;
  /** Supports system prompts */
  systemPrompt?: boolean;
  /** Supports temperature control */
  temperature?: boolean;
  /** Supports max tokens control */
  maxTokens?: boolean;
  /** Supports vision/image input */
  vision?: boolean;
  /** Supports streaming */
  streaming?: boolean;
}

export interface ProviderStreamParams {
  /** Model ID */
  model: string;
  /** Chat messages */
  messages: Array<AgentMessage>;
  /** Temperature (0-2) */
  temperature?: number;
  /** Maximum tokens to generate */
  maxTokens?: number;
  /** Tools/function definitions */
  tools?: unknown[];
  /** Stop sequences */
  stop?: string[];
  /** Presence penalty */
  presencePenalty?: number;
  /** Frequency penalty */
  frequencyPenalty?: number;
  /** Top-p nucleus sampling */
  topP?: number;
  /** Abort signal */
  signal?: AbortSignal;
  /** Additional provider-specific params */
  extra?: Record<string, unknown>;
}

export interface ProviderStreamChunk {
  /** Chunk type */
  type: 'text' | 'tool_call' | 'usage' | 'done' | 'error';
  /** Text content */
  text?: string;
  /** Tool call (function calling) */
  toolCall?: {
    id: string;
    name: string;
    arguments: string;  // JSON string
  };
  /** Token usage */
  usage?: {
    input: number;
    output: number;
    total?: number;
  };
  /** Error message */
  error?: string;
  /** Finish reason */
  finishReason?: 'stop' | 'length' | 'content_filter' | 'tool_calls' | null;
}

// ============================================================================
// Non-Streaming Provider (for simple providers)
// ============================================================================

export interface ProviderCompleteParams extends ProviderStreamParams {
  /** Wait for complete response instead of streaming */
  stream?: false;
}

export interface ProviderResponse {
  /** Response content */
  content: string;
  /** Tool calls */
  toolCalls?: Array<{
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  }>;
  /** Token usage */
  usage?: {
    input: number;
    output: number;
    total: number;
  };
  /** Finish reason */
  finishReason: 'stop' | 'length' | 'content_filter' | 'tool_calls';
  /** Model used */
  model: string;
  /** Provider ID */
  provider: string;
}

// ============================================================================
// Provider Registry
// ============================================================================

export interface ProviderRegistry {
  /** Register a provider */
  register(provider: ProviderPlugin): void;
  /** Get a provider by ID */
  get(id: string): ProviderPlugin | undefined;
  /** List all providers */
  listAll(): ProviderPlugin[];
  /** Get models for a provider */
  getModels(providerId: string): ProviderModelDefinition[];
  /** Check if a provider is registered */
  has(id: string): boolean;
  /** Remove a provider */
  unregister(id: string): boolean;
}

// ============================================================================
// Built-in Provider IDs
// ============================================================================

export const BUILTIN_PROVIDERS = {
  OPENAI: 'openai',
  ANTHROPIC: 'anthropic',
  GEMINI: 'gemini',
  OLLAMA: 'ollama',
  CUSTOM: 'custom',
} as const;

export type BuiltinProviderId = typeof BUILTIN_PROVIDERS[keyof typeof BUILTIN_PROVIDERS];
