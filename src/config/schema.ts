import { z } from 'zod';

// ============================================
// Provider Configuration
// ============================================

export const ProviderConfigSchema = z.object({
  api_key: z.string().default(''),
  api_base: z.string().optional(),
  api_type: z.enum(['openai', 'anthropic']).default('openai'),
}).strict();

export const ProvidersConfigSchema = z.record(z.string(), ProviderConfigSchema).default({});

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
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;
export type TelegramConfig = z.infer<typeof TelegramConfigSchema>;
export type WhatsAppConfig = z.infer<typeof WhatsAppConfigSchema>;

// ============================================
// Built-in Provider Catalog
// ============================================

// Environment variable mappings for each provider
const PROVIDER_ENVVARS: Record<string, string[]> = {
  'openai': ['OPENAI_API_KEY'],
  'anthropic': ['ANTHROPIC_API_KEY'],
  'google': ['GOOGLE_API_KEY', 'GEMINI_API_KEY'],
  'qwen': ['QWEN_API_KEY', 'DASHSCOPE_API_KEY'],
  'kimi': ['KIMI_API_KEY', 'MOONSHOT_API_KEY'],
  'moonshot': ['MOONSHOT_API_KEY', 'KIMI_API_KEY'],
  'minimax': ['MINIMAX_API_KEY'],
  'deepseek': ['DEEPSEEK_API_KEY'],
  'groq': ['GROQ_API_KEY'],
  'openrouter': ['OPENROUTER_API_KEY'],
};

// Default API bases for known providers
const PROVIDER_DEFAULTS: Record<string, { api_base?: string; api_type: 'openai' | 'anthropic' }> = {
  'openai': { api_base: 'https://api.openai.com/v1', api_type: 'openai' },
  'anthropic': { api_base: '', api_type: 'anthropic' },
  'google': { api_base: '', api_type: 'openai' },
  'qwen': { api_base: 'https://dashscope.aliyuncs.com/compatible-mode/v1', api_type: 'openai' },
  'kimi': { api_base: 'https://api.moonshot.cn/v1', api_type: 'openai' },
  'moonshot': { api_base: 'https://api.moonshot.ai/v1', api_type: 'openai' },
  'minimax': { api_base: 'https://api.minimax.chat/v1', api_type: 'openai' },
  'deepseek': { api_base: 'https://api.deepseek.com/v1', api_type: 'openai' },
  'groq': { api_base: 'https://api.groq.com/openai/v1', api_type: 'openai' },
  'openrouter': { api_base: 'https://openrouter.ai/api/v1', api_type: 'openai' },
};

// ============================================
// Helper Functions
// ============================================

/**
 * Read API key from environment variables
 */
function readApiKeyFromEnv(provider: string): string | null {
  const envVars = PROVIDER_ENVVARS[provider] || [];
  for (const envVar of envVars) {
    const value = process.env[envVar];
    if (value) return value;
  }
  return null;
}

/**
 * Get merged provider config (env > config file)
 */
export function getProviderConfig(config: Config, provider: string): ProviderConfig {
  // Get from config
  const configProvider = config.providers?.[provider];
  
  // Read API key from environment if not in config
  let apiKey = configProvider?.api_key || '';
  if (!apiKey) {
    apiKey = readApiKeyFromEnv(provider) || '';
  }
  
  // Use config's api_base, or default, or empty (for Anthropic/Google)
  const apiBase = configProvider?.api_base || PROVIDER_DEFAULTS[provider]?.api_base || '';
  const apiType = configProvider?.api_type || PROVIDER_DEFAULTS[provider]?.api_type || 'openai';
  
  return {
    api_key: apiKey,
    api_base: apiBase,
    api_type: apiType,
  };
}

/**
 * Get API key for a provider
 */
export function getApiKey(config: Config, provider?: string): string | null {
  if (provider) {
    const providerConfig = getProviderConfig(config, provider);
    if (providerConfig.api_key) return providerConfig.api_key;
  }
  
  // Priority order from env vars
  const priorityProviders = ['openai', 'anthropic', 'google', 'qwen', 'kimi', 'minimax', 'deepseek', 'groq'];
  for (const p of priorityProviders) {
    const key = readApiKeyFromEnv(p);
    if (key) return key;
  }
  
  // Fall back to config
  return config.providers?.openai?.api_key || 
         config.providers?.anthropic?.api_key ||
         config.providers?.google?.api_key ||
         null;
}

/**
 * Get API base URL for a model
 */
export function getApiBase(config: Config, modelId: string): string | null {
  const prefix = modelId.includes('/') 
    ? modelId.split('/')[0].toLowerCase() 
    : modelId.toLowerCase();
  
  // Check known providers first
  if (PROVIDER_DEFAULTS[prefix]) {
    const providerConfig = getProviderConfig(config, prefix);
    return providerConfig.api_base || null;
  }
  
  // Check config.providers
  if (config.providers?.[prefix]) {
    const providerConfig = getProviderConfig(config, prefix);
    return providerConfig.api_base || null;
  }
  
  return null;
}

/**
 * Get API type for a model
 */
export function getApiType(config: Config, modelId: string): 'openai' | 'anthropic' {
  const prefix = modelId.includes('/') 
    ? modelId.split('/')[0].toLowerCase() 
    : modelId.toLowerCase();
  
  const providerConfig = getProviderConfig(config, prefix);
  return providerConfig.api_type;
}

/**
 * Check if a provider is configured
 */
export function isProviderConfigured(config: Config, provider: string): boolean {
  const providerConfig = getProviderConfig(config, provider);
  return !!providerConfig.api_key;
}

/**
 * List all configured providers
 */
export function listConfiguredProviders(config: Config): string[] {
  const configured: string[] = [];
  
  for (const [name, providerConfig] of Object.entries(config.providers || {})) {
    if (providerConfig.api_key) {
      configured.push(name);
    }
  }
  
  // Check environment variables
  for (const [name, envVars] of Object.entries(PROVIDER_ENVVARS)) {
    for (const envVar of envVars) {
      if (process.env[envVar] && !configured.includes(name)) {
        configured.push(name);
        break;
      }
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

/**
 * Built-in model catalog (lightweight - just IDs and providers)
 */
export const BUILTIN_MODELS = [
  // OpenAI
  { id: 'openai/gpt-4o', name: 'GPT-4o', provider: 'openai' },
  { id: 'openai/gpt-4o-mini', name: 'GPT-4o Mini', provider: 'openai' },
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
  
  // Qwen
  { id: 'qwen/qwen-plus', name: 'Qwen Plus', provider: 'qwen' },
  { id: 'qwen/qwen-max', name: 'Qwen Max', provider: 'qwen' },
  { id: 'qwen/qwen3-235b-a22b', name: 'Qwen3 235B', provider: 'qwen' },
  
  // Kimi
  { id: 'kimi/kimi-k2.5', name: 'Kimi K2.5', provider: 'kimi' },
  { id: 'kimi/kimi-k2-thinking', name: 'Kimi K2 Thinking', provider: 'kimi' },
  
  // MiniMax
  { id: 'minimax/minimax-m2.1', name: 'MiniMax M2.1', provider: 'minimax' },
  { id: 'minimax/minimax-m2', name: 'MiniMax M2', provider: 'minimax' },
  
  // DeepSeek
  { id: 'deepseek/deepseek-chat', name: 'DeepSeek Chat', provider: 'deepseek' },
  { id: 'deepseek/deepseek-reasoner', name: 'DeepSeek Reasoner', provider: 'deepseek' },
  
  // Groq
  { id: 'groq/llama-3.3-70b-versatile', name: 'Llama 3.3 70B', provider: 'groq' },
];

/**
 * List built-in models
 */
export function listBuiltinModels() {
  return BUILTIN_MODELS;
}

/**
 * Provider display names
 */
export const PROVIDER_NAMES: Record<string, string> = {
  'openai': 'OpenAI',
  'anthropic': 'Anthropic',
  'google': 'Google Gemini',
  'qwen': 'Qwen (通义千问)',
  'kimi': 'Kimi (月之暗面)',
  'minimax': 'MiniMax',
  'deepseek': 'DeepSeek',
  'groq': 'Groq',
  'openrouter': 'OpenRouter',
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
  { name: 'Qwen (通义千问)', value: 'qwen', envKey: 'QWEN_API_KEY', models: ['qwen-plus', 'qwen-max', 'qwen3-235b-a22b'] },
  { name: 'Kimi (月之暗面)', value: 'kimi', envKey: 'KIMI_API_KEY', models: ['kimi-k2.5', 'kimi-k2-thinking'] },
  { name: 'MiniMax', value: 'minimax', envKey: 'MINIMAX_API_KEY', models: ['minimax-m2.1', 'minimax-m2'] },
  { name: 'DeepSeek', value: 'deepseek', envKey: 'DEEPSEEK_API_KEY', models: ['deepseek-chat', 'deepseek-reasoner'] },
  { name: 'Groq', value: 'groq', envKey: 'GROQ_API_KEY', models: ['llama-3.3-70b-versatile'] },
];
