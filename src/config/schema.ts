import { z } from 'zod';

// ============================================
// Model Configuration (OpenClaw-inspired)
// ============================================

export const ModelDefinitionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  cost: z.object({
    input: z.number().optional(),
    output: z.number().optional(),
    cacheRead: z.number().optional(),
    cacheWrite: z.number().optional(),
  }).optional(),
  contextWindow: z.number().optional(),
  maxTokens: z.number().optional(),
  reasoning: z.boolean().optional(),
  input: z.array(z.enum(['text', 'image'])).optional(),
}).strict();

export const ModelProviderSchema = z.object({
  baseUrl: z.string().min(1),
  apiKey: z.string().optional(),
  apiType: z.enum(['openai', 'anthropic']).default('openai'),
  headers: z.record(z.string(), z.string()).optional(),
  models: z.array(ModelDefinitionSchema).default([]),
}).strict();

export const ModelsConfigSchema = z.object({
  mode: z.enum(['merge', 'replace']).default('merge'),
  providers: z.record(z.string(), ModelProviderSchema).default({}),
}).strict().optional();

// ============================================
// Provider Configuration
// ============================================

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

// Providers Config (legacy, still used for simple API key storage)
export const ProvidersConfigSchema = z.object({
  openai: OpenAIConfigSchema.default({}),
  anthropic: AnthropicConfigSchema.default({}),
  google: GoogleConfigSchema.default({}),
});

// ============================================
// Channel Configs
// ============================================

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

// ============================================
// Agent Configs
// ============================================

export const AgentDefaultsSchema = z.object({
  workspace: z.string().default('~/.xopcbot/workspace'),
  model: z.string().default('anthropic/claude-sonnet-4-5'),
  max_tokens: z.number().default(8192),
  temperature: z.number().default(0.7),
  max_tool_iterations: z.number().default(20),
});

export const AgentModelConfigSchema = z.object({
  alias: z.string().optional(),
  params: z.record(z.unknown()).optional(),
}).strict();

export const AgentsConfigSchema = z.object({
  defaults: AgentDefaultsSchema.default({}),
  models: z.record(z.string(), AgentModelConfigSchema).optional(),
});

// ============================================
// Tools Config
// ============================================

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

// ============================================
// Gateway
// ============================================

export const GatewayConfigSchema = z.object({
  host: z.string().default('0.0.0.0'),
  port: z.number().default(18790),
});

// ============================================
// Root Config
// ============================================

export const ConfigSchema = z.object({
  agents: AgentsConfigSchema.default({}),
  channels: ChannelsConfigSchema.default({}),
  providers: ProvidersConfigSchema.default({}),
  models: ModelsConfigSchema,
  gateway: GatewayConfigSchema.default({}),
  tools: ToolsConfigSchema.default({}),
});

export type Config = z.infer<typeof ConfigSchema>;
export type AgentDefaults = z.infer<typeof AgentDefaultsSchema>;
export type ProviderConfig = z.infer<typeof OpenAIConfigSchema>;
export type ModelDefinition = z.infer<typeof ModelDefinitionSchema>;
export type ModelProvider = z.infer<typeof ModelProviderSchema>;
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

// Built-in providers with their default base URLs
const BUILTIN_PROVIDERS: Record<string, { baseUrl: string; apiType: 'openai' | 'anthropic' }> = {
  'anthropic': { baseUrl: '', apiType: 'anthropic' },
  'openai': { baseUrl: 'https://api.openai.com/v1', apiType: 'openai' },
  'google': { baseUrl: '', apiType: 'openai' },
};

export function getApiKey(config: Config, provider?: string): string | null {
  if (provider) {
    // Check custom provider first
    if (config.models?.providers?.[provider]?.apiKey) {
      return config.models.providers[provider].apiKey || null;
    }
    // Fall back to legacy providers
    const legacyKey = (config.providers as any)?.[provider]?.api_key;
    if (legacyKey) return legacyKey;
  }
  
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
  const prefix = modelId.includes('/') 
    ? modelId.split('/')[0].toLowerCase() 
    : modelId.toLowerCase();
  
  // Check custom providers (models.providers.<prefix>)
  if (config.models?.providers?.[prefix]) {
    return config.models.providers[prefix].baseUrl;
  }
  
  // Check built-in providers
  if (BUILTIN_PROVIDERS[prefix]) {
    return BUILTIN_PROVIDERS[prefix].baseUrl || null;
  }
  
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

export function getApiType(config: Config, modelId: string): 'openai' | 'anthropic' {
  const prefix = modelId.includes('/') 
    ? modelId.split('/')[0].toLowerCase() 
    : modelId.toLowerCase();
  
  // Check custom providers
  if (config.models?.providers?.[prefix]) {
    return config.models.providers[prefix].apiType;
  }
  
  // Check built-in providers
  if (BUILTIN_PROVIDERS[prefix]) {
    return BUILTIN_PROVIDERS[prefix].apiType;
  }
  
  // Default to openai
  return 'openai';
}

export function getModelDefinition(config: Config, modelId: string): ModelDefinition | null {
  // Extract provider prefix
  const prefix = modelId.includes('/') 
    ? modelId.split('/')[0].toLowerCase() 
    : modelId.toLowerCase();
  
  // Check custom provider's models list
  const provider = config.models?.providers?.[prefix];
  if (provider) {
    // Try to find by full model ID or just the model part
    const modelPart = modelId.includes('/') ? modelId.split('/')[1] : modelId;
    return provider.models.find(m => m.id === modelId || m.id === modelPart) || null;
  }
  
  return null;
}

export function getWorkspacePath(config: Config): string {
  return config.agents.defaults.workspace;
}

export function getModelAlias(config: Config, modelId: string): string | null {
  return config.agents.models?.[modelId]?.alias || null;
}
