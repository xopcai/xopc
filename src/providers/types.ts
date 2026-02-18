/**
 * Provider Type Definitions
 * 
 * Strict types for LLM provider interactions
 */

// ============================================
// Tool Types
// ============================================

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

// ============================================
// Content Types
// ============================================

export interface TextContent {
  type: 'text';
  text: string;
}

export interface ImageContent {
  type: 'image';
  data: string;
  mimeType: string;
}

export type ContentPart = TextContent | ImageContent;

// ============================================
// Message Types
// ============================================

export type MessageRole = 'user' | 'assistant' | 'system' | 'toolResult';

export interface BaseMessage {
  role: MessageRole;
  timestamp?: number;
}

export interface UserMessage extends BaseMessage {
  role: 'user';
  content: string | ContentPart[];
}

export interface AssistantMessage extends BaseMessage {
  role: 'assistant';
  content: ContentPart[];
}

export interface SystemMessage extends BaseMessage {
  role: 'system';
  content: string;
}

export interface ToolResultMessage extends BaseMessage {
  role: 'toolResult';
  toolCallId: string;
  toolName: string;
  content: ContentPart[];
  isError: boolean;
}

export type ChatMessage = UserMessage | AssistantMessage | SystemMessage | ToolResultMessage;

// ============================================
// Request/Response Types
// ============================================

export interface ChatOptions {
  maxTokens?: number;
  temperature?: number;
  tools?: ToolDefinition[];
}

export interface TokenUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export type FinishReason = 'stop' | 'error' | 'aborted' | 'max_tokens' | string;

export interface ChatResponse {
  content: string | null;
  tool_calls: ToolCall[];
  finish_reason: FinishReason;
  usage?: TokenUsage;
  error?: string;
}

// ============================================
// API Strategy Types
// ============================================

export type ApiType = 'openai-completions' | 'anthropic-messages' | 'google-generative-ai' | 'github-copilot';

export interface ApiStrategyOptions {
  reasoning?: boolean;
  maxTokens?: number;
  modelMaxTokens: number;
  thinkingFormat?: string;
}

export interface ApiStrategy {
  buildOptions(opts: ApiStrategyOptions): Record<string, unknown>;
}

// ============================================
// Provider Configuration
// ============================================

export interface ProviderBehaviorConfig {
  /** Maximum thinking budget tokens (default: 8192) */
  maxThinkingBudgetTokens: number;
  /** Default temperature (default: 0.7) */
  defaultTemperature: number;
  /** Default max tokens for responses */
  defaultMaxTokens: number;
  /** Ollama base URL */
  ollamaBaseUrl: string;
  /** Ollama API timeout in ms */
  ollamaTimeoutMs: number;
  /** Ollama discovery timeout in ms */
  ollamaDiscoveryTimeoutMs: number;
}
