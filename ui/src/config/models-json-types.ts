// Local type definitions for models.json configuration
// These mirror the types from the root src/config/models-json.ts

export interface ModelCost {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
}

export interface CustomModel {
  id: string;
  name?: string;
  input?: string[];
  contextWindow?: number;
  maxTokens?: number;
  cost?: ModelCost;
  reasoning?: boolean;
  headers?: Record<string, string>;
  compat?: Record<string, unknown>;
  overrides?: {
    baseUrl?: string;
    apiKey?: string;
    api?: string;
  };
}

export type ApiType = 
  | 'openai-completions'
  | 'openai-responses'
  | 'anthropic-messages'
  | 'google-generative-ai'
  | 'azure-openai-responses'
  | 'bedrock-converse-stream'
  | 'openai-codex-responses'
  | 'google-gemini-cli'
  | 'google-vertex';

export interface ProviderConfig {
  baseUrl?: string;
  apiKey?: string;
  api?: ApiType;
  models?: CustomModel[];
  authHeader?: boolean;
  headers?: Record<string, string>;
  modelOverrides?: Record<string, unknown>;
}

export interface ModelsJsonConfig {
  providers: Record<string, ProviderConfig>;
}

export interface ValidationError {
  path: string;
  message: string;
  severity: 'error' | 'warning';
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}


