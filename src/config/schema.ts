import { z } from 'zod';

// ============================================
// Provider Configuration
// ============================================

// OpenAI-compatible provider schema
export const OpenAIProviderSchema = z.object({
  api_key: z.string().default(''),
  api_base: z.string().optional(),
}).strict();

// Anthropic provider schema
export const AnthropicProviderSchema = z.object({
  api_key: z.string().default(''),
}).strict();

// Unified providers config
export const ProvidersConfigSchema = z.object({
  // OpenAI-compatible providers
  openai: OpenAIProviderSchema.default({}),
  qwen: OpenAIProviderSchema.default({}),
  kimi: OpenAIProviderSchema.default({}),
  moonshot: OpenAIProviderSchema.default({}),
  minimax: OpenAIProviderSchema.default({}),
  deepseek: OpenAIProviderSchema.default({}),
  groq: OpenAIProviderSchema.default({}),
  openrouter: OpenAIProviderSchema.default({}),
  xai: OpenAIProviderSchema.default({}),
  
  // Native providers
  anthropic: AnthropicProviderSchema.default({}),
  google: AnthropicProviderSchema.default({}),
}).strict();

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

export const AgentsConfigSchema = z.object({
  defaults: AgentDefaultsSchema.default({}),
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
  gateway: GatewayConfigSchema.default({}),
  tools: ToolsConfigSchema.default({}),
});

export type Config = z.infer<typeof ConfigSchema>;
export type AgentDefaults = z.infer<typeof AgentDefaultsSchema>;
export type OpenAIProviderConfig = z.infer<typeof OpenAIProviderSchema>;
export type AnthropicProviderConfig = z.infer<typeof AnthropicProviderSchema>;
export type TelegramConfig = z.infer<typeof TelegramConfigSchema>;
export type WhatsAppConfig = z.infer<typeof WhatsAppConfigSchema>;

// ============================================
// Provider Defaults
// ============================================

// OpenAI-compatible providers (use openai-responses API)
const OPENAI_COMPATIBLE_PROVIDERS: Record<string, { api_base: string; env_key: string[] }> = {
  'openai': { api_base: 'https://api.openai.com/v1', env_key: ['OPENAI_API_KEY'] },
  'qwen': { api_base: 'https://dashscope.aliyuncs.com/compatible-mode/v1', env_key: ['QWEN_API_KEY', 'DASHSCOPE_API_KEY'] },
  'kimi': { api_base: 'https://api.moonshot.cn/v1', env_key: ['KIMI_API_KEY', 'MOONSHOT_API_KEY'] },
  'moonshot': { api_base: 'https://api.moonshot.ai/v1', env_key: ['MOONSHOT_API_KEY'] },
  'deepseek': { api_base: 'https://api.deepseek.com/v1', env_key: ['DEEPSEEK_API_KEY'] },
  'groq': { api_base: 'https://api.groq.com/openai/v1', env_key: ['GROQ_API_KEY'] },
  'openrouter': { api_base: 'https://openrouter.ai/api/v1', env_key: ['OPENROUTER_API_KEY'] },
  'xai': { api_base: 'https://api.x.ai/v1', env_key: ['XAI_API_KEY'] },
};

// Anthropic-compatible providers (use anthropic-messages API)
const ANTHROPIC_COMPATIBLE_PROVIDERS: Record<string, { api_base: string; env_key: string[] }> = {
  'minimax': { api_base: 'https://api.minimax.io/anthropic', env_key: ['MINIMAX_API_KEY'] },
};

// Native providers (use their own APIs)
const NATIVE_PROVIDERS: Record<string, { env_key: string[] }> = {
  'anthropic': { env_key: ['ANTHROPIC_API_KEY'] },
  'google': { env_key: ['GOOGLE_API_KEY', 'GEMINI_API_KEY'] },
};

// ============================================
// Helper Functions
// ============================================

/**
 * Get API key from config or environment
 */
export function getApiKey(config: Config, provider: string): string | null {
  // Check config first
  const configKey = (config.providers as any)?.[provider]?.api_key;
  if (configKey) return configKey;
  
  // Check Anthropic-compatible first (they have special API)
  if (ANTHROPIC_COMPATIBLE_PROVIDERS[provider]) {
    for (const envKey of ANTHROPIC_COMPATIBLE_PROVIDERS[provider].env_key) {
      if (process.env[envKey]) return process.env[envKey]!;
    }
  }
  
  // Check OpenAI-compatible
  if (OPENAI_COMPATIBLE_PROVIDERS[provider]) {
    for (const envKey of OPENAI_COMPATIBLE_PROVIDERS[provider].env_key) {
      if (process.env[envKey]) return process.env[envKey]!;
    }
  }
  
  // Check native providers
  if (NATIVE_PROVIDERS[provider]) {
    for (const envKey of NATIVE_PROVIDERS[provider].env_key) {
      if (process.env[envKey]) return process.env[envKey]!;
    }
  }
  
  return null;
}

/**
 * Get API base URL for a provider
 */
export function getApiBase(config: Config, provider: string): string | null {
  const configBase = (config.providers as any)?.[provider]?.api_base;
  if (configBase) return configBase;
  
  // Check Anthropic-compatible first
  if (ANTHROPIC_COMPATIBLE_PROVIDERS[provider]) {
    return ANTHROPIC_COMPATIBLE_PROVIDERS[provider].api_base;
  }
  
  // Check OpenAI-compatible
  if (OPENAI_COMPATIBLE_PROVIDERS[provider]) {
    return OPENAI_COMPATIBLE_PROVIDERS[provider].api_base;
  }
  
  return null;
}

/**
 * Check if provider uses OpenAI-compatible API
 */
export function isOpenAICompatible(provider: string): boolean {
  return provider in OPENAI_COMPATIBLE_PROVIDERS;
}

/**
 * Check if provider uses Anthropic-compatible API
 */
export function isAnthropicCompatible(provider: string): boolean {
  return provider in ANTHROPIC_COMPATIBLE_PROVIDERS;
}

/**
 * Model ID normalization table
 * Maps user input to the format expected by pi-ai
 */
const MODEL_NAME_NORMALIZATION: Record<string, string> = {
  // MiniMax (full ID format)
  'minimax/m2.1': 'MiniMax-M2.1',
  'minimax/m2': 'MiniMax-M2',
  'minimax/m1': 'MiniMax-M1',
  // MiniMax (short format)
  'minimax-m2.1': 'MiniMax-M2.1',
  'minimax-m2': 'MiniMax-M2',
  'minimax-m1': 'MiniMax-M1',
};

/**
 * Parse model ID and return provider + model
 */
export function parseModelId(modelId: string): { provider: string; model: string } {
  // First check if the entire model ID needs normalization (e.g., "minimax/m2.1" -> "minimax/MiniMax-M2.1")
  const normalizedFullId = MODEL_NAME_NORMALIZATION[modelId.toLowerCase()] || modelId;
  if (normalizedFullId !== modelId) {
    // The full ID was normalized
    return parseModelId(normalizedFullId);
  }
  
  if (modelId.includes('/')) {
    const [provider, model] = modelId.split('/');
    const normalizedModel = MODEL_NAME_NORMALIZATION[model.toLowerCase()] || model;
    return { provider: provider.toLowerCase(), model: normalizedModel };
  }
  
  // Auto-detect provider from model name
  const modelLower = normalizedFullId.toLowerCase();
  
  if (modelLower.startsWith('gpt-') || modelLower.startsWith('o1') || modelLower.startsWith('o3')) {
    return { provider: 'openai', model: normalizedFullId };
  }
  if (modelLower.startsWith('claude-') || modelLower.includes('sonnet') || modelLower.includes('haiku')) {
    return { provider: 'anthropic', model: normalizedFullId };
  }
  if (modelLower.startsWith('gemini-') || modelLower.startsWith('gemma-')) {
    return { provider: 'google', model: normalizedFullId };
  }
  if (modelLower.startsWith('qwen') || modelLower.startsWith('qwq')) {
    return { provider: 'qwen', model: normalizedFullId };
  }
  if (modelLower.startsWith('kimi')) {
    return { provider: 'kimi', model: normalizedFullId };
  }
  if (modelLower.startsWith('minimax')) {
    return { provider: 'minimax', model: normalizedFullId };
  }
  if (modelLower.startsWith('deepseek') || modelLower.startsWith('r1')) {
    return { provider: 'deepseek', model: normalizedFullId };
  }
  if (modelLower.startsWith('llama') || modelLower.startsWith('mixtral')) {
    return { provider: 'groq', model: normalizedFullId };
  }
  
  // Default to openai
  return { provider: 'openai', model: normalizedFullId };
}

/**
 * Check if provider is configured
 */
export function isProviderConfigured(config: Config, provider: string): boolean {
  return !!getApiKey(config, provider);
}

/**
 * List all configured providers
 */
export function listConfiguredProviders(config: Config): string[] {
  const configured: string[] = [];
  
  // Check all providers
  const allProviders = { ...OPENAI_COMPATIBLE_PROVIDERS, ...NATIVE_PROVIDERS };
  
  for (const provider of Object.keys(allProviders)) {
    if (isProviderConfigured(config, provider)) {
      configured.push(provider);
    }
  }
  
  return configured;
}

/**
 * Get workspace path
 */
export function getWorkspacePath(config: Config): string {
  return config.agents.defaults.workspace;
}

// ============================================
// Built-in Model Catalog
// ============================================

export interface BuiltinModel {
  id: string;
  name: string;
  provider: string;
}

export const BUILTIN_MODELS: BuiltinModel[] = [
  // OpenAI
  { id: 'openai/gpt-4o', name: 'GPT-4o', provider: 'openai' },
  { id: 'openai/gpt-4o-mini', name: 'GPT-4o Mini', provider: 'openai' },
  { id: 'openai/gpt-4.1', name: 'GPT-4.1', provider: 'openai' },
  { id: 'openai/gpt-5', name: 'GPT-5', provider: 'openai' },
  { id: 'openai/o1', name: 'o1', provider: 'openai' },
  { id: 'openai/o3', name: 'o3', provider: 'openai' },
  
  // Anthropic
  { id: 'anthropic/claude-sonnet-4-5', name: 'Claude Sonnet 4.5', provider: 'anthropic' },
  { id: 'anthropic/claude-haiku-4-5', name: 'Claude Haiku 4.5', provider: 'anthropic' },
  { id: 'anthropic/claude-opus-4-5', name: 'Claude Opus 4.5', provider: 'anthropic' },
  
  // Google
  { id: 'google/gemini-2.5-pro', name: 'Gemini 2.5 Pro', provider: 'google' },
  { id: 'google/gemini-2.5-flash', name: 'Gemini 2.5 Flash', provider: 'google' },
  
  // Qwen (OpenAI-compatible)
  { id: 'qwen/qwen-plus', name: 'Qwen Plus', provider: 'qwen' },
  { id: 'qwen/qwen-max', name: 'Qwen Max', provider: 'qwen' },
  { id: 'qwen/qwen3-235b', name: 'Qwen3 235B', provider: 'qwen' },
  
  // Kimi (OpenAI-compatible)
  { id: 'kimi/kimi-k2.5', name: 'Kimi K2.5', provider: 'kimi' },
  { id: 'kimi/kimi-k2-thinking', name: 'Kimi K2 Thinking', provider: 'kimi' },
  
  // MiniMax (OpenAI-compatible)
  { id: 'minimax/minimax-m2.1', name: 'MiniMax M2.1', provider: 'minimax' },
  { id: 'minimax/minimax-m2', name: 'MiniMax M2', provider: 'minimax' },
  
  // DeepSeek (OpenAI-compatible)
  { id: 'deepseek/deepseek-chat', name: 'DeepSeek Chat', provider: 'deepseek' },
  { id: 'deepseek/deepseek-reasoner', name: 'DeepSeek Reasoner', provider: 'deepseek' },
  
  // Groq
  { id: 'groq/llama-3.3-70b', name: 'Llama 3.3 70B', provider: 'groq' },
  
  // OpenRouter
  { id: 'openrouter/openai/gpt-4o', name: 'GPT-4o (OpenRouter)', provider: 'openrouter' },
];

export function listBuiltinModels(): BuiltinModel[] {
  return BUILTIN_MODELS;
}

/**
 * Get provider display name
 */
export const PROVIDER_NAMES: Record<string, string> = {
  'openai': 'OpenAI',
  'anthropic': 'Anthropic',
  'google': 'Google',
  'qwen': 'Qwen (通义千问)',
  'kimi': 'Kimi (月之暗面)',
  'moonshot': 'Moonshot AI',
  'minimax': 'MiniMax',
  'deepseek': 'DeepSeek',
  'groq': 'Groq',
  'openrouter': 'OpenRouter',
  'xai': 'xAI (Grok)',
};

/**
 * Provider options for CLI selection
 */
export interface ProviderOption {
  name: string;
  value: string;
  envKey: string;
  models: string[];
}

export const PROVIDER_OPTIONS: ProviderOption[] = [
  { name: 'OpenAI (GPT-4, o1)', value: 'openai', envKey: 'OPENAI_API_KEY', models: ['gpt-4o', 'gpt-4o-mini', 'gpt-5', 'o1', 'o3'] },
  { name: 'Anthropic (Claude)', value: 'anthropic', envKey: 'ANTHROPIC_API_KEY', models: ['claude-sonnet-4-5', 'claude-haiku-4-5', 'claude-opus-4-5'] },
  { name: 'Google (Gemini)', value: 'google', envKey: 'GOOGLE_API_KEY', models: ['gemini-2.5-pro', 'gemini-2.5-flash'] },
  { name: 'Qwen (通义千问)', value: 'qwen', envKey: 'QWEN_API_KEY', models: ['qwen-plus', 'qwen-max', 'qwen3-235b'] },
  { name: 'Kimi (月之暗面)', value: 'kimi', envKey: 'KIMI_API_KEY', models: ['kimi-k2.5', 'kimi-k2-thinking'] },
  { name: 'MiniMax', value: 'minimax', envKey: 'MINIMAX_API_KEY', models: ['minimax-m2.1', 'minimax-m2'] },
  { name: 'DeepSeek', value: 'deepseek', envKey: 'DEEPSEEK_API_KEY', models: ['deepseek-chat', 'deepseek-reasoner'] },
  { name: 'Groq', value: 'groq', envKey: 'GROQ_API_KEY', models: ['llama-3.3-70b'] },
];
