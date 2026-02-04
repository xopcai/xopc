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
// Built-in Model Catalog
// ============================================

interface BuiltinModelInfo {
  name: string;
  contextWindow: number;
  reasoning: boolean;
}

interface BuiltinModelCatalog {
  [provider: string]: {
    [modelId: string]: BuiltinModelInfo;
  };
}

export const BUILTIN_MODELS: BuiltinModelCatalog = {
  // OpenAI - https://api.openai.com/v1
  openai: {
    'gpt-4o': { name: 'GPT-4o', contextWindow: 128000, reasoning: false },
    'gpt-4o-mini': { name: 'GPT-4o Mini', contextWindow: 128000, reasoning: false },
    'gpt-4.1': { name: 'GPT-4.1', contextWindow: 1000000, reasoning: false },
    'gpt-4.1-mini': { name: 'GPT-4.1 Mini', contextWindow: 1000000, reasoning: false },
    'gpt-4.1-nano': { name: 'GPT-4.1 Nano', contextWindow: 1000000, reasoning: false },
    'gpt-5': { name: 'GPT-5', contextWindow: 400000, reasoning: true },
    'gpt-5-mini': { name: 'GPT-5 Mini', contextWindow: 400000, reasoning: true },
    'gpt-5-nano': { name: 'GPT-5 Nano', contextWindow: 400000, reasoning: true },
    'gpt-5-thinking': { name: 'GPT-5 Thinking', contextWindow: 400000, reasoning: true },
    'gpt-5.2': { name: 'GPT-5.2', contextWindow: 400000, reasoning: true },
    'o1': { name: 'o1', contextWindow: 200000, reasoning: true },
    'o1-mini': { name: 'o1-mini', contextWindow: 200000, reasoning: true },
    'o3': { name: 'o3', contextWindow: 200000, reasoning: true },
    'o3-mini': { name: 'o3-mini', contextWindow: 200000, reasoning: true },
    'o4': { name: 'o4', contextWindow: 200000, reasoning: true },
  },
  
  // Anthropic - api.anthropic.com
  anthropic: {
    'claude-sonnet-4-5': { name: 'Claude Sonnet 4.5', contextWindow: 200000, reasoning: true },
    'claude-haiku-4-5': { name: 'Claude Haiku 4.5', contextWindow: 200000, reasoning: true },
    'claude-opus-4-5': { name: 'Claude Opus 4.5', contextWindow: 200000, reasoning: true },
    'claude-sonnet-4-5-20250929-thinking': { name: 'Claude Sonnet 4.5 Thinking', contextWindow: 200000, reasoning: true },
    'claude-opus-4-5-20251101': { name: 'Claude Opus 4.5', contextWindow: 200000, reasoning: true },
  },
  
  // Google - generativelanguage.googleapis.com
  google: {
    'gemini-2.5-pro': { name: 'Gemini 2.5 Pro', contextWindow: 1048576, reasoning: true },
    'gemini-2.5-flash': { name: 'Gemini 2.5 Flash', contextWindow: 1048576, reasoning: true },
    'gemini-3-pro-preview': { name: 'Gemini 3 Pro Preview', contextWindow: 1000000, reasoning: true },
    'gemini-3-flash-preview': { name: 'Gemini 3 Flash Preview', contextWindow: 1000000, reasoning: true },
    'gemini-2.0-flash-lite': { name: 'Gemini 2.0 Flash Lite', contextWindow: 2000000, reasoning: false },
    'gemini-2.5-flash-image': { name: 'Gemini 2.5 Flash Image', contextWindow: 32768, reasoning: false },
  },
  
  // Qwen (China) - dashscope.aliyuncs.com/compatible-mode/v1
  qwen: {
    'qwen-plus': { name: 'Qwen Plus', contextWindow: 1000000, reasoning: false },
    'qwen-max': { name: 'Qwen Max', contextWindow: 131072, reasoning: false },
    'qwen3-235b-a22b-instruct-2507': { name: 'Qwen3 235B A22B', contextWindow: 128000, reasoning: false },
    'qwen3-max-2025-09-23': { name: 'Qwen3 Max', contextWindow: 258048, reasoning: false },
    'qwen3-coder-30b-a3b': { name: 'Qwen3 Coder 30B', contextWindow: 128000, reasoning: false },
    'qwen3-32b': { name: 'Qwen3 32B', contextWindow: 128000, reasoning: true },
    'qwen3-235b-a22b': { name: 'Qwen3 235B A22B', contextWindow: 128000, reasoning: true },
    'qwq-plus': { name: 'QwQ Plus', contextWindow: 131072, reasoning: true },
  },
  
  // Kimi/Moonshot (China) - api.moonshot.cn/v1
  kimi: {
    'kimi-k2.5': { name: 'Kimi K2.5', contextWindow: 262144, reasoning: true },
    'kimi-k2-thinking': { name: 'Kimi K2 Thinking', contextWindow: 262144, reasoning: true },
    'kimi-k2-thinking-turbo': { name: 'Kimi K2 Thinking Turbo', contextWindow: 262144, reasoning: true },
    'kimi-k2-turbo-preview': { name: 'Kimi K2 Turbo', contextWindow: 262144, reasoning: false },
    'kimi-k2-0711-preview': { name: 'Kimi K2 0711', contextWindow: 131072, reasoning: false },
    'kimi-k2-0905-preview': { name: 'Kimi K2 0905', contextWindow: 262144, reasoning: false },
    'kimi-k2-turbo': { name: 'Kimi K2 Turbo', contextWindow: 262144, reasoning: false },
  },
  
  // Kimi/Moonshot (International) - api.moonshot.ai/v1
  moonshotai: {
    'kimi-k2.5': { name: 'Kimi K2.5', contextWindow: 262144, reasoning: true },
    'kimi-k2-thinking': { name: 'Kimi K2 Thinking', contextWindow: 262144, reasoning: true },
    'kimi-k2-thinking-turbo': { name: 'Kimi K2 Thinking Turbo', contextWindow: 262144, reasoning: true },
    'kimi-k2-turbo-preview': { name: 'Kimi K2 Turbo', contextWindow: 262144, reasoning: false },
  },
  
  // MiniMax - api.minimax.chat/v1
  minimax: {
    'minimax-m2.1': { name: 'MiniMax M2.1', contextWindow: 1000000, reasoning: false },
    'minimax-m2': { name: 'MiniMax M2', contextWindow: 1000000, reasoning: false },
    'minimax-m1': { name: 'MiniMax M1', contextWindow: 1000000, reasoning: false },
    'MiniMax-M2': { name: 'MiniMax M2', contextWindow: 1000000, reasoning: false },
  },
  
  // DeepSeek - api.deepseek.com/v1
  deepseek: {
    'deepseek-chat': { name: 'DeepSeek Chat', contextWindow: 128000, reasoning: false },
    'deepseek-reasoner': { name: 'DeepSeek Reasoner', contextWindow: 128000, reasoning: true },
    'deepseek-v3': { name: 'DeepSeek V3', contextWindow: 128000, reasoning: false },
    'deepseek-v3.2-thinking': { name: 'DeepSeek V3.2 Thinking', contextWindow: 128000, reasoning: true },
  },
  
  // Groq - api.groq.com/openai/v1
  groq: {
    'llama-3.3-70b-versatile': { name: 'Llama 3.3 70B', contextWindow: 128000, reasoning: false },
    'llama-3.1-70b-instruct': { name: 'Llama 3.1 70B', contextWindow: 128000, reasoning: false },
    'llama-3.1-8b-instruct': { name: 'Llama 3.1 8B', contextWindow: 128000, reasoning: false },
    'mixtral-8x7b-32768': { name: 'Mixtral 8x7B', contextWindow: 32768, reasoning: false },
  },
  
  // OpenRouter - openrouter.ai/api/v1
  openrouter: {
    'anthropic/claude-sonnet-4-5': { name: 'Claude Sonnet 4.5 (OpenRouter)', contextWindow: 200000, reasoning: true },
    'openai/gpt-4o': { name: 'GPT-4o (OpenRouter)', contextWindow: 128000, reasoning: false },
    'google/gemini-2.5-pro': { name: 'Gemini 2.5 Pro (OpenRouter)', contextWindow: 1048576, reasoning: true },
  },
};

// ============================================
// Helper Functions
// ============================================

// Known API base URLs for OpenAI-compatible providers
const OPENAI_COMPATIBLE_BASES: Record<string, string> = {
  'deepseek': 'https://api.deepseek.com/v1',
  'minimax': 'https://api.minimax.chat/v1',
  'qwen': 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  'kimi': 'https://api.moonshot.cn/v1',
  'moonshotai': 'https://api.moonshot.ai/v1',
  'openrouter': 'https://openrouter.ai/api/v1',
  'groq': 'https://api.groq.com/openai/v1',
  'vllm': 'http://localhost:8000/v1',
  '302ai': 'https://api.302.ai/v1',
};

// Built-in providers with their default base URLs and API types
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
    const modelPart = modelId.includes('/') ? modelId.split('/')[1] : modelId;
    return provider.models.find(m => m.id === modelId || m.id === modelPart) || null;
  }
  
  // Check built-in models
  if (BUILTIN_MODELS[prefix as keyof typeof BUILTIN_MODELS]) {
    const builtin = BUILTIN_MODELS[prefix as keyof typeof BUILTIN_MODELS];
    const modelPart = modelId.includes('/') ? modelId.split('/')[1] : modelId;
    if (builtin[modelPart as keyof typeof builtin]) {
      const info = builtin[modelPart as keyof typeof builtin];
      return {
        id: modelPart,
        name: info.name,
        contextWindow: info.contextWindow,
        reasoning: info.reasoning,
        input: ['text', 'image'],
      };
    }
  }
  
  return null;
}

export function getWorkspacePath(config: Config): string {
  return config.agents.defaults.workspace;
}

export function getModelAlias(config: Config, modelId: string): string | null {
  return config.agents.models?.[modelId]?.alias || null;
}

// Helper to list all available built-in models
export function listBuiltinModels(): Array<{ id: string; name: string; provider: string }> {
  const models: Array<{ id: string; name: string; provider: string }> = [];
  
  for (const [provider, modelsMap] of Object.entries(BUILTIN_MODELS)) {
    for (const [modelId, info] of Object.entries(modelsMap)) {
      models.push({
        id: `${provider}/${modelId}`,
        name: info.name,
        provider,
      });
    }
  }
  
  return models;
}
