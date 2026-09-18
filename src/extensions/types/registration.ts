/**
 * Extension registration types.
 * 
 * Provider, flag, and shortcut registration contracts.
 */

// ============================================================================
// Provider Registration
// ============================================================================

export interface ProviderConfig {
  name: string;
  baseUrl?: string;
  apiKey?: string;
  api: ProviderApiType;
  models?: ModelConfig[];
  oauth?: OAuthConfig;
}

export type ProviderApiType = 
  | 'openai-completions'
  | 'anthropic-messages'
  | 'google-generative'
  | 'ollama'
  | 'vllm'
  | 'custom';

export interface ModelConfig {
  id: string;
  name: string;
  contextWindow: number;
  maxTokens?: number;
  cost?: { input: number; output: number };
}

export interface OAuthConfig {
  name: string;
  login: (callbacks: OAuthCallbacks) => Promise<OAuthCredentials>;
  refreshToken: (credentials: OAuthCredentials) => Promise<OAuthCredentials>;
  getApiKey: (credentials: OAuthCredentials) => Promise<string>;
}

export interface OAuthCallbacks {
  onSuccess: (credentials: OAuthCredentials) => void;
  onError: (error: Error) => void;
}

export interface OAuthCredentials {
  access: string;
  refresh?: string;
  expiresAt?: number;
}
