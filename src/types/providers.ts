/**
 * Provider Types
 * 
 * Type definitions for LLM providers, models, and registry.
 */

// ============================================
// Provider Types
// ============================================

export type ProviderType = 'openai-completions' | 'anthropic-messages' | 'google-generative-ai' | 'bedrock-converse-stream';

export interface ProviderInfo {
  name: string;
  type: ProviderType;
  baseUrl: string;
  authType: 'api-key' | 'oauth' | 'token' | 'aws-sdk' | 'none';
  envKey?: string;
  models: ModelInfo[];
}

export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  contextWindow: number;
  maxTokens: number;
  reasoning: boolean;
  input: ('text' | 'image')[];
  cost: CostInfo;
  api: ProviderType;
}

export interface CostInfo {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

// ============================================
// Registry Types
// ============================================

export interface ModelRegistryOptions {
  configPath?: string;
  enableDiscovery?: boolean;
}

export interface ModelSearchOptions {
  provider?: string;
  reasoning?: boolean;
  input?: ('text' | 'image')[];
  minContextWindow?: number;
}

// ============================================
// LLM Provider Types
// ============================================

export interface ChatOptions {
  maxTokens?: number;
  temperature?: number;
  thinkingEnabled?: boolean;
  thinkingBudgetTokens?: number;
}

export interface ChatResult {
  content: string | null;
  tool_calls: ToolCall[];
  finish_reason: string;
  usage?: TokenUsage;
  error?: string;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface TokenUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}
