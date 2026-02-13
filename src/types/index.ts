export interface InboundMessage {
  channel: string;
  sender_id: string;
  chat_id: string;
  content: string;
  media?: string[];
  metadata?: Record<string, unknown>;
}

export interface OutboundMessage {
  channel: string;
  chat_id: string;
  content?: string;
  type?: 'message' | 'typing_on' | 'typing_off';
  mediaUrl?: string;
  mediaType?: 'photo' | 'video' | 'audio' | 'document' | 'animation';
}

export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool' | 'toolResult';
  content: string;
  timestamp?: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
  tool_call_id$?: string; // pi-ai format
  toolName?: string; // pi-ai format
  isError?: boolean; // pi-ai format
  name?: string;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface ToolSchema {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ToolParameters {
  type: 'object';
  properties: Record<string, {
    type: string;
    description: string;
  }>;
  required?: string[];
}

export interface LLMProvider {
  chat(
    messages: LLMMessage[],
    tools?: Array<{
      name: string;
      description: string;
      parameters: Record<string, unknown>;
    }>,
    model?: string,
    maxTokens?: number,
    temperature?: number
  ): Promise<LLMResponse>;
  getDefaultModel(): string;
}

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool' | 'toolResult';
  content: string | null | Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  toolCallId?: string; // pi-ai format
  toolName?: string;
  isError?: boolean;
  name?: string;
  timestamp?: number;
}

export interface LLMResponse {
  content: string | null;
  tool_calls: ToolCall[];
  finish_reason: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface Session {
  key: string;
  messages: Message[];
  created_at: string;
  updated_at: string;
  metadata?: Record<string, unknown>;
}

export interface SessionInfo {
  key: string;
  created_at: string;
  updated_at: string;
  path: string;
}

export interface Config {
  agents?: AgentsConfig;
  channels?: ChannelsConfig;
  providers?: ProvidersConfig;
  gateway?: GatewayConfig;
  tools?: ToolsConfig;
}

export interface AgentsConfig {
  defaults?: AgentDefaults;
}

export interface AgentDefaults {
  workspace?: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  max_tool_iterations?: number;
}

export interface ChannelsConfig {
  telegram?: TelegramConfig;
  whatsapp?: WhatsAppConfig;
}

export interface TelegramConfig {
  enabled?: boolean;
  token?: string;
  allowFrom?: string[];
}

export interface WhatsAppConfig {
  enabled?: boolean;
  bridgeUrl?: string;
  allowFrom?: string[];
}

export interface ProvidersConfig {
  anthropic?: ProviderConfig;
  openai?: ProviderConfig;
  openrouter?: ProviderConfig;
  groq?: ProviderConfig;
  zhipu?: ProviderConfig;
  vllm?: ProviderConfig;
  gemini?: ProviderConfig;
}

export interface ProviderConfig {
  apiKey?: string;
  apiBase?: string;
}

export interface GatewayConfig {
  host?: string;
  port?: number;
}

export interface ToolsConfig {
  web?: WebToolsConfig;
}

export interface WebToolsConfig {
  search?: WebSearchConfig;
}

export interface WebSearchConfig {
  apiKey?: string;
  maxResults?: number;
}

export interface CronJob {
  id: string;
  name?: string;
  schedule: string;
  message: string;
  enabled: boolean;
  created_at: string;
}

export interface SubagentResult {
  task_id: string;
  label: string;
  task: string;
  result: string;
  status: 'ok' | 'error';
}

// Re-export provider types
export * from './providers.js';
