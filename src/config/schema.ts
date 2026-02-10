import { z } from 'zod';

// ============================================
// Provider Configuration (camelCase)
// ============================================

// OpenAI-compatible provider schema
export const OpenAIProviderSchema = z.object({
  apiKey: z.string().default(''),
  baseUrl: z.string().optional(),
  api: z.enum(['openai-completions', 'anthropic-messages', 'google-generative-ai', 'github-copilot']).optional(),
  models: z.array(z.string()).optional(),
});

// Anthropic provider schema
export const AnthropicProviderSchema = z.object({
  apiKey: z.string().default(''),
  models: z.array(z.string()).optional(),
});

// Ollama provider schema
export const OllamaProviderSchema = z.object({
  enabled: z.boolean().default(true),
  baseUrl: z.string().default('http://127.0.0.1:11434/v1'),
  models: z.array(z.string()).optional(),
  autoDiscovery: z.boolean().default(true),
}).strict();

// Unified providers config
export const ProvidersConfigSchema = z.object({
  // OpenAI-compatible providers
  openai: OpenAIProviderSchema.default({}),
  qwen: OpenAIProviderSchema.default({}),
  kimi: OpenAIProviderSchema.default({}),
  moonshot: OpenAIProviderSchema.default({}),
  minimax: OpenAIProviderSchema.default({}),
  'minimax-cn': OpenAIProviderSchema.default({}),
  deepseek: OpenAIProviderSchema.default({}),
  groq: OpenAIProviderSchema.default({}),
  openrouter: OpenAIProviderSchema.default({}),
  xai: OpenAIProviderSchema.default({}),
  bedrock: OpenAIProviderSchema.default({}),
  
  // Native providers
  anthropic: AnthropicProviderSchema.default({}),
  google: AnthropicProviderSchema.default({}),
  
  // Local providers
  ollama: OllamaProviderSchema.default({}),
}).strict();

// ============================================
// Agent Configs (camelCase)
// ============================================

export const AgentDefaultsSchema = z.object({
  workspace: z.string().default('~/.xopcbot/workspace'),
  model: z.string().default('anthropic/claude-sonnet-4-5'),
  maxTokens: z.number().default(8192),
  temperature: z.number().default(0.7),
  maxToolIterations: z.number().default(20),
  compaction: z.object({
    enabled: z.boolean().default(true),
    mode: z.enum(['default', 'safeguard']).default('default'),
    reserveTokens: z.number().default(8000),
    triggerThreshold: z.number().min(0.5).max(0.95).default(0.8),
    minMessagesBeforeCompact: z.number().default(10),
    keepRecentMessages: z.number().default(5),
  }).default({}),
  pruning: z.object({
    enabled: z.boolean().default(true),
    maxToolResultChars: z.number().default(10000),
    headKeepRatio: z.number().default(0.3),
    tailKeepRatio: z.number().default(0.3),
  }).default({}),
});

export const AgentsConfigSchema = z.object({
  defaults: AgentDefaultsSchema.default({}),
});

// ============================================
// Channel Configs (camelCase)
// ============================================

export const TelegramConfigSchema = z.object({
  enabled: z.boolean().default(false),
  token: z.string().default(''),
  allowFrom: z.array(z.string()).default([]),
});

export const WhatsAppConfigSchema = z.object({
  enabled: z.boolean().default(false),
  bridgeUrl: z.string().default('ws://localhost:3001'),
  allowFrom: z.array(z.string()).default([]),
});

export const ChannelsConfigSchema = z.object({
  telegram: TelegramConfigSchema.default({}),
  whatsapp: WhatsAppConfigSchema.default({}),
});

export const WebSearchConfigSchema = z.object({
  apiKey: z.string().default(''),
  maxResults: z.number().default(5),
});

export const WebToolsConfigSchema = z.object({
  search: WebSearchConfigSchema.default({}),
});

export const ToolsConfigSchema = z.object({
  web: WebToolsConfigSchema.default({}),
});

export const HeartbeatConfigSchema = z.object({
  enabled: z.boolean().default(true),
  intervalMs: z.number().default(60000),
});

export const GatewayConfigSchema = z.object({
  host: z.string().default('0.0.0.0'),
  port: z.number().default(18790),
  heartbeat: HeartbeatConfigSchema.default({}),
});

export const CronConfigSchema = z.object({
  enabled: z.boolean().default(true),
  maxConcurrentJobs: z.number().default(5),
  defaultTimezone: z.string().default('UTC'),
  historyRetentionDays: z.number().default(7),
  enableMetrics: z.boolean().default(true),
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
  cron: CronConfigSchema.default({}),
});

export type Config = z.infer<typeof ConfigSchema>;
export type AgentDefaults = z.infer<typeof AgentDefaultsSchema>;
export type OpenAIProviderConfig = z.infer<typeof OpenAIProviderSchema>;
export type AnthropicProviderConfig = z.infer<typeof AnthropicProviderSchema>;
export type TelegramConfig = z.infer<typeof TelegramConfigSchema>;
export type WhatsAppConfig = z.infer<typeof WhatsAppConfigSchema>;

const OPENAI_COMPATIBLE_PROVIDERS: Record<string, { baseUrl: string; envKey: string[] }> = {
  'openai': { baseUrl: 'https://api.openai.com/v1', envKey: ['OPENAI_API_KEY'] },
  'qwen': { baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', envKey: ['QWEN_API_KEY', 'DASHSCOPE_API_KEY'] },
  'kimi': { baseUrl: 'https://api.moonshot.cn/v1', envKey: ['KIMI_API_KEY', 'MOONSHOT_API_KEY'] },
  'moonshot': { baseUrl: 'https://api.moonshot.ai/v1', envKey: ['MOONSHOT_API_KEY'] },
  'deepseek': { baseUrl: 'https://api.deepseek.com/v1', envKey: ['DEEPSEEK_API_KEY'] },
  'groq': { baseUrl: 'https://api.groq.com/openai/v1', envKey: ['GROQ_API_KEY'] },
  'openrouter': { baseUrl: 'https://openrouter.ai/api/v1', envKey: ['OPENROUTER_API_KEY'] },
  'xai': { baseUrl: 'https://api.x.ai/v1', envKey: ['XAI_API_KEY'] },
  'bedrock': { baseUrl: '', envKey: ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'] },
};

const ANTHROPIC_COMPATIBLE_PROVIDERS: Record<string, { baseUrl: string; envKey: string[] }> = {
  'minimax': { baseUrl: 'https://api.minimax.io/anthropic', envKey: ['MINIMAX_API_KEY'] },
  'minimax-cn': { baseUrl: 'https://api.minimaxi.com/anthropic', envKey: ['MINIMAX_CN_API_KEY', 'MINIMAX_API_KEY'] },
};

const NATIVE_PROVIDERS: Record<string, { envKey: string[] }> = {
  'anthropic': { envKey: ['ANTHROPIC_API_KEY'] },
  'google': { envKey: ['GOOGLE_API_KEY', 'GEMINI_API_KEY'] },
};

// ============================================
// Helper Functions
// ============================================

export function getApiKey(config: Config, provider: string): string | null {
  const configKey = (config.providers as any)?.[provider]?.apiKey;
  if (configKey) return configKey;
  
  if (ANTHROPIC_COMPATIBLE_PROVIDERS[provider]) {
    for (const envKey of ANTHROPIC_COMPATIBLE_PROVIDERS[provider].envKey) {
      if (process.env[envKey]) return process.env[envKey]!;
    }
  }
  
  if (OPENAI_COMPATIBLE_PROVIDERS[provider]) {
    for (const envKey of OPENAI_COMPATIBLE_PROVIDERS[provider].envKey) {
      if (process.env[envKey]) return process.env[envKey]!;
    }
  }
  
  if (NATIVE_PROVIDERS[provider]) {
    for (const envKey of NATIVE_PROVIDERS[provider].envKey) {
      if (process.env[envKey]) return process.env[envKey]!;
    }
  }
  
  return null;
}

export function getApiBase(config: Config, provider: string): string | null {
  const configBase = (config.providers as any)?.[provider]?.baseUrl;
  if (configBase) return configBase;
  
  if (ANTHROPIC_COMPATIBLE_PROVIDERS[provider]) {
    return ANTHROPIC_COMPATIBLE_PROVIDERS[provider].baseUrl;
  }
  
  if (OPENAI_COMPATIBLE_PROVIDERS[provider]) {
    return OPENAI_COMPATIBLE_PROVIDERS[provider].baseUrl;
  }
  
  return null;
}

export function isOpenAICompatible(provider: string): boolean {
  return provider in OPENAI_COMPATIBLE_PROVIDERS;
}

export function isAnthropicCompatible(provider: string): boolean {
  return provider in ANTHROPIC_COMPATIBLE_PROVIDERS;
}

export interface ParsedModelRef {
  provider: string;
  model: string;
}

export function parseModelId(modelId: string): ParsedModelRef {
  // Check for provider/model format
  if (modelId.includes('/')) {
    const [provider, model] = modelId.split('/');
    
    if (provider.toLowerCase() === 'minimax-cn') {
      return { provider: 'minimax-cn', model: model };
    }
    
    return { provider: provider.toLowerCase(), model: model };
  }
  
  const modelLower = modelId.toLowerCase();
  const providerPrefix = modelLower.split('.')[0];
  const bedrockProviders = ['anthropic', 'moonshot', 'qwen', 'minimax'];
  
  if (bedrockProviders.includes(providerPrefix) && modelLower.includes('.')) {
    return { provider: providerPrefix, model: modelId };
  }
  
  if (modelLower.startsWith('minimax-cn') || modelLower.startsWith('minimaxi')) {
    return { provider: 'minimax-cn', model: modelId };
  }
  
  if (modelLower.startsWith('gpt-') || modelLower.startsWith('o1') || modelLower.startsWith('o3') || modelLower.startsWith('o4')) {
    return { provider: 'openai', model: modelId };
  }
  if (modelLower.startsWith('claude-') || modelLower.includes('sonnet') || modelLower.includes('haiku') || modelLower.includes('opus')) {
    return { provider: 'anthropic', model: modelId };
  }
  if (modelLower.startsWith('gemini-') || modelLower.startsWith('gemma-')) {
    return { provider: 'google', model: modelId };
  }
  if (modelLower.startsWith('qwen') || modelLower.startsWith('qwq')) {
    return { provider: 'qwen', model: modelId };
  }
  if (modelLower.startsWith('kimi')) {
    return { provider: 'kimi', model: modelId };
  }
  if (modelLower.startsWith('moonshot')) {
    return { provider: 'moonshot', model: modelId };
  }
  if (modelLower.startsWith('minimax')) {
    return { provider: 'minimax', model: modelId };
  }
  if (modelLower.startsWith('deepseek') || modelLower.startsWith('r1')) {
    return { provider: 'deepseek', model: modelId };
  }
  if (modelLower.startsWith('llama') || modelLower.startsWith('mixtral') || modelLower.startsWith('gemma')) {
    return { provider: 'groq', model: modelId };
  }
  
  return { provider: 'openai', model: modelId };
}

export function isProviderConfigured(config: Config, provider: string): boolean {
  return !!getApiKey(config, provider);
}

export function listConfiguredProviders(config: Config): string[] {
  const configured: string[] = [];
  const allProviders = { ...OPENAI_COMPATIBLE_PROVIDERS, ...NATIVE_PROVIDERS };
  
  for (const provider of Object.keys(allProviders)) {
    if (isProviderConfigured(config, provider)) {
      configured.push(provider);
    }
  }
  
  return configured;
}

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
  { id: 'openai/gpt-4o', name: 'GPT-4o', provider: 'openai' },
  { id: 'openai/gpt-4o-mini', name: 'GPT-4o Mini', provider: 'openai' },
  { id: 'openai/gpt-4.1', name: 'GPT-4.1', provider: 'openai' },
  { id: 'openai/gpt-5', name: 'GPT-5', provider: 'openai' },
  { id: 'openai/o1', name: 'o1', provider: 'openai' },
  { id: 'openai/o3', name: 'o3', provider: 'openai' },
  { id: 'anthropic/claude-sonnet-4-5', name: 'Claude Sonnet 4.5', provider: 'anthropic' },
  { id: 'anthropic/claude-haiku-4-5', name: 'Claude Haiku 4.5', provider: 'anthropic' },
  { id: 'anthropic/claude-opus-4-5', name: 'Claude Opus 4.5', provider: 'anthropic' },
  { id: 'google/gemini-2.5-pro', name: 'Gemini 2.5 Pro', provider: 'google' },
  { id: 'google/gemini-2.5-flash', name: 'Gemini 2.5 Flash', provider: 'google' },
  { id: 'qwen/qwen-plus', name: 'Qwen Plus', provider: 'qwen' },
  { id: 'qwen/qwen-max', name: 'Qwen Max', provider: 'qwen' },
  { id: 'qwen/qwen3-235b', name: 'Qwen3 235B', provider: 'qwen' },
  { id: 'kimi/kimi-k2.5', name: 'Kimi K2.5', provider: 'kimi' },
  { id: 'kimi/kimi-k2-thinking', name: 'Kimi K2 Thinking', provider: 'kimi' },
  { id: 'minimax/minimax-m2.1', name: 'MiniMax M2.1', provider: 'minimax' },
  { id: 'minimax/minimax-m2', name: 'MiniMax M2', provider: 'minimax' },
  { id: 'deepseek/deepseek-chat', name: 'DeepSeek Chat', provider: 'deepseek' },
  { id: 'deepseek/deepseek-reasoner', name: 'DeepSeek Reasoner', provider: 'deepseek' },
  { id: 'groq/llama-3.3-70b', name: 'Llama 3.3 70B', provider: 'groq' },
  { id: 'openrouter/openai/gpt-4o', name: 'GPT-4o (OpenRouter)', provider: 'openrouter' },
];

export function listBuiltinModels(): BuiltinModel[] {
  return BUILTIN_MODELS;
}

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
