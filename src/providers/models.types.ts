/**
 * Unified Model Registry Types
 * 
 * Single source of truth for all provider and model definitions.
 */

export interface ModelCost {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
}

export interface ModelCompat {
  supportsStore?: boolean;
  supportsDeveloperRole?: boolean;
  supportsReasoningEffort?: boolean;
  supportsUsageInStreaming?: boolean;
  supportsStrictMode?: boolean;
  maxTokensField?: 'max_completion_tokens' | 'max_tokens';
  thinkingFormat?: 'openai' | 'zai' | 'qwen';
  requiresToolResultName?: boolean;
  requiresAssistantAfterToolResult?: boolean;
  requiresThinkingAsText?: boolean;
  requiresMistralToolIds?: boolean;
}

export interface ModelEntry {
  id: string;
  name: string;
  reasoning?: boolean;
  input?: Array<'text' | 'image'>;
  contextWindow?: number;
  maxTokens?: number;
  cost?: ModelCost;
  compat?: ModelCompat;
  headers?: Record<string, string>;
  recommended?: boolean;
  deprecated?: boolean;
}

export interface ProviderAuth {
  type: 'api_key' | 'oauth' | 'token' | 'aws-sdk' | 'none';
  envKeys: string[];
  headerPrefix?: string;
  supportsOAuth?: boolean;
  oauthProviderId?: string;
}

export interface ProviderCapabilities {
  streaming: boolean;
  functionCalling: boolean;
  vision: boolean;
  reasoning: boolean;
}

export type ApiStrategy =
  | 'openai-completions'
  | 'openai-responses'
  | 'anthropic-messages'
  | 'google-generative-ai'
  | 'github-copilot'
  | 'bedrock-converse-stream'
  | 'ollama';

export interface ProviderEntry {
  name: string;
  baseUrl: string;
  api: ApiStrategy;
  auth: ProviderAuth;
  capabilities: ProviderCapabilities;
  modelPrefixes?: string[];
  models: ModelEntry[];
}

export interface ModelsManifest {
  version: string;
  lastUpdated: string;
  providers: Record<string, ProviderEntry>;
}

export interface ResolvedModel {
  ref: string;
  id: string;
  name: string;
  provider: string;
  providerName: string;
  api: ApiStrategy;
  baseUrl: string;
  reasoning: boolean;
  input: Array<'text' | 'image'>;
  contextWindow: number;
  maxTokens: number;
  cost: ModelCost;
  compat?: ModelCompat;
  headers?: Record<string, string>;
  recommended: boolean;
  deprecated: boolean;
  source: 'builtin' | 'pi-ai' | 'user' | 'ollama';
}

export interface ResolvedProvider {
  id: string;
  name: string;
  baseUrl: string;
  api: ApiStrategy;
  auth: ProviderAuth;
  capabilities: ProviderCapabilities;
  modelPrefixes: string[];
  configured: boolean;
  models: ResolvedModel[];
}
