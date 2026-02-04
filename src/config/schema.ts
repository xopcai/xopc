import { z } from 'zod';

// ============================================
// Simplified Provider Configuration
// ============================================
// All OpenAI-compatible APIs use the same config structure
// The model ID determines which actual provider is used

export const OpenAIConfigSchema = z.object({
  api_key: z.string().default(''),
  api_base: z.string().optional(),
});

export const AnthropicConfigSchema = z.object({
  api_key: z.string().default(''),
});

export const GoogleConfigSchema = z.object({
  api_key: z.string().default(''),
});

// Providers Config
export const ProvidersConfigSchema = z.object({
  openai: OpenAIConfigSchema.default({}),
  anthropic: AnthropicConfigSchema.default({}),
  google: GoogleConfigSchema.default({}),
});

// Channel Configs
export const TelegramConfigSchema = z.object({
  enabled: z.boolean().default(false),
  token: z.string().default(''),
  allow_from: z.array(z.string()).default([]),
});

export const WhatsAppConfigSchema = z.object({
  enabled: z.boolean().default(false),
  bridge_url: z.string().default('ws://localhost:3001'),
  allow_from: z.array(z.string()).default([]),
});

export const ChannelsConfigSchema = z.object({
  telegram: TelegramConfigSchema.default({}),
  whatsapp: WhatsAppConfigSchema.default({}),
});

// Agent Defaults
export const AgentDefaultsSchema = z.object({
  workspace: z.string().default('~/.xopcbot/workspace'),
  model: z.string().default('anthropic/claude-sonnet-4-5'),
  max_tokens: z.number().default(8192),
  temperature: z.number().default(0.7),
  max_tool_iterations: z.number().default(20),
});

export const AgentsConfigSchema = z.object({
  defaults: AgentDefaultsSchema.default({}),
});

// Tools Config
export const WebSearchConfigSchema = z.object({
  api_key: z.string().default(''),
  max_results: z.number().default(5),
});

export const WebToolsConfigSchema = z.object({
  search: WebSearchConfigSchema.default({}),
});

export const ToolsConfigSchema = z.object({
  web: WebToolsConfigSchema.default({}),
});

// Gateway
export const GatewayConfigSchema = z.object({
  host: z.string().default('0.0.0.0'),
  port: z.number().default(18790),
});

// Root Config
export const ConfigSchema = z.object({
  agents: AgentsConfigSchema.default({}),
  channels: ChannelsConfigSchema.default({}),
  providers: ProvidersConfigSchema.default({}),
  gateway: GatewayConfigSchema.default({}),
  tools: ToolsConfigSchema.default({}),
});

export type Config = z.infer<typeof ConfigSchema>;
export type AgentDefaults = z.infer<typeof AgentDefaultsSchema>;
export type ProviderConfig = z.infer<typeof OpenAIConfigSchema>;
export type TelegramConfig = z.infer<typeof TelegramConfigSchema>;
export type WhatsAppConfig = z.infer<typeof WhatsAppConfigSchema>;

// ============================================
// Helper Functions
// ============================================

// Known API base URLs for OpenAI-compatible providers
const OPENAI_COMPATIBLE_BASES: Record<string, string> = {
  'deepseek': 'https://api.deepseek.com/v1',
  'minimax': 'https://api.minimax.chat/v1',
  'qwen': 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  'kimi': 'https://api.moonshot.cn/v1',
  'openrouter': 'https://openrouter.ai/api/v1',
  'groq': 'https://api.groq.com/openai/v1',
  'vllm': 'http://localhost:8000/v1',
};

export function getApiKey(config: Config): string | null {
  // Priority: anthropic > openai > google
  return (
    config.providers.anthropic?.api_key ||
    config.providers.openai?.api_key ||
    config.providers.google?.api_key ||
    null
  );
}

export function getApiBase(config: Config, modelId: string): string | null {
  // Extract provider prefix from model ID (e.g., "qwen/qwen-plus" -> "qwen")
  const prefix = modelId.split('/')[0].toLowerCase();
  
  // Check if it's an OpenAI-compatible provider
  if (OPENAI_COMPATIBLE_BASES[prefix]) {
    return OPENAI_COMPATIBLE_BASES[prefix];
  }
  
  // Default to OpenAI if using gpt-* models
  if (prefix.includes('gpt-')) {
    return 'https://api.openai.com/v1';
  }
  
  return null;
}

export function getWorkspacePath(config: Config): string {
  return config.agents.defaults.workspace;
}
