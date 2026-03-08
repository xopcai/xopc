import { z } from 'zod';
import { homedir } from 'os';

// ============================================
// Provider Configuration (merged from models.json)
// ============================================

// OpenAI Compatibility Settings
export const OpenRouterRoutingSchema = z.object({
  only: z.array(z.string()).optional(),
  order: z.array(z.string()).optional(),
});

export const VercelGatewayRoutingSchema = z.object({
  only: z.array(z.string()).optional(),
  order: z.array(z.string()).optional(),
});

export const OpenAICompletionsCompatSchema = z.object({
  supportsStore: z.boolean().optional(),
  supportsDeveloperRole: z.boolean().optional(),
  supportsReasoningEffort: z.boolean().optional(),
  supportsUsageInStreaming: z.boolean().optional(),
  maxTokensField: z.enum(['max_completion_tokens', 'max_tokens']).optional(),
  requiresToolResultName: z.boolean().optional(),
  requiresAssistantAfterToolResult: z.boolean().optional(),
  requiresThinkingAsText: z.boolean().optional(),
  requiresMistralToolIds: z.boolean().optional(),
  thinkingFormat: z.enum(['openai', 'zai', 'qwen']).optional(),
  openRouterRouting: OpenRouterRoutingSchema.optional(),
  vercelGatewayRouting: VercelGatewayRoutingSchema.optional(),
  supportsStrictMode: z.boolean().optional(),
});

export const OpenAIResponsesCompatSchema = z.object({});

export const OpenAICompatSchema = z.union([
  OpenAICompletionsCompatSchema,
  OpenAIResponsesCompatSchema,
]);

// Model Definition
export const CustomModelSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).optional(),
  api: z.enum([
    'openai-completions',
    'openai-responses',
    'anthropic-messages',
    'google-generative-ai',
    'azure-openai-responses',
    'bedrock-converse-stream',
    'openai-codex-responses',
    'google-gemini-cli',
    'google-vertex',
  ]).optional(),
  reasoning: z.boolean().optional(),
  input: z.array(z.enum(['text', 'image'])).optional(),
  contextWindow: z.number().positive().optional(),
  maxTokens: z.number().positive().optional(),
  cost: z.object({
    input: z.number(),
    output: z.number(),
    cacheRead: z.number(),
    cacheWrite: z.number(),
  }).optional(),
  headers: z.record(z.string(), z.string()).optional(),
  compat: OpenAICompatSchema.optional(),
});

// Model Override (for built-in models)
export const ModelOverrideSchema = z.object({
  name: z.string().min(1).optional(),
  reasoning: z.boolean().optional(),
  input: z.array(z.enum(['text', 'image'])).optional(),
  contextWindow: z.number().positive().optional(),
  maxTokens: z.number().positive().optional(),
  cost: z.object({
    input: z.number().optional(),
    output: z.number().optional(),
    cacheRead: z.number().optional(),
    cacheWrite: z.number().optional(),
  }).optional(),
  headers: z.record(z.string(), z.string()).optional(),
  compat: OpenAICompatSchema.optional(),
});

// Rich Provider Configuration (object format)
export const RichProviderConfigSchema = z.object({
  baseUrl: z.string().url().optional(),
  apiKey: z.string().optional(),
  api: z.enum([
    'openai-completions',
    'openai-responses',
    'anthropic-messages',
    'google-generative-ai',
    'azure-openai-responses',
    'bedrock-converse-stream',
    'openai-codex-responses',
    'google-gemini-cli',
    'google-vertex',
  ]).optional(),
  headers: z.record(z.string(), z.string()).optional(),
  authHeader: z.boolean().optional(),
  models: z.array(CustomModelSchema).optional(),
  modelOverrides: z.record(z.string(), ModelOverrideSchema).optional(),
});

// Provider config: simple string (API key) or rich object
export const ProviderConfigSchema = z.union([
  z.string(), // API key only
  RichProviderConfigSchema,
]);

// Providers config: record of provider name -> config
export const ProvidersConfigSchema = z.record(z.string(), ProviderConfigSchema).default({});

// ============================================
// Agent Configs
// ============================================

export const AgentDefaultsSchema = z.object({
  workspace: z.string().default('~/.xopcbot/workspace'),
  model: z.union([
    z.string(),
    z.object({
      primary: z.string().optional(),
      fallbacks: z.array(z.string()).optional(),
    }).strict(),
  ]).default('anthropic/claude-sonnet-4-5'),
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
  }).optional(),
  pruning: z.object({
    enabled: z.boolean().default(true),
    maxToolResultChars: z.number().default(10000),
    headKeepRatio: z.number().default(0.3),
    tailKeepRatio: z.number().default(0.3),
  }).optional(),
});

export const AgentsConfigSchema = z.object({
  defaults: AgentDefaultsSchema.optional(),
}).default({
  defaults: {
    workspace: '~/.xopcbot/workspace',
    model: 'anthropic/claude-sonnet-4-5',
    maxTokens: 8192,
    temperature: 0.7,
    maxToolIterations: 20,
    compaction: {
      enabled: true,
      mode: 'default',
      reserveTokens: 8000,
      triggerThreshold: 0.8,
      minMessagesBeforeCompact: 10,
      keepRecentMessages: 5,
    },
    pruning: {
      enabled: true,
      maxToolResultChars: 10000,
      headKeepRatio: 0.3,
      tailKeepRatio: 0.3,
    },
  },
});

// ============================================
// Channel Configs
// ============================================

export const TelegramTopicConfigSchema = z.object({
  topicId: z.string(),
  requireMention: z.boolean().optional(),
  enabled: z.boolean().optional(),
  allowFrom: z.array(z.union([z.string(), z.number()])).optional(),
  systemPrompt: z.string().optional(),
});

export const TelegramGroupConfigSchema = z.object({
  groupId: z.string(),
  requireMention: z.boolean().optional(),
  enabled: z.boolean().optional(),
  allowFrom: z.array(z.union([z.string(), z.number()])).optional(),
  systemPrompt: z.string().optional(),
  topics: z.record(z.string(), TelegramTopicConfigSchema).optional(),
});

export const TelegramAccountConfigSchema = z.object({
  accountId: z.string(),
  name: z.string().optional(),
  enabled: z.boolean().default(true),
  token: z.string().default(''),
  tokenFile: z.string().optional(),
  allowFrom: z.array(z.union([z.string(), z.number()])).default([]),
  groupAllowFrom: z.array(z.union([z.string(), z.number()])).optional(),
  dmPolicy: z.enum(['pairing', 'allowlist', 'open', 'disabled']).default('pairing'),
  groupPolicy: z.enum(['open', 'disabled', 'allowlist']).default('open'),
  replyToMode: z.enum(['off', 'first', 'all']).default('off'),
  groups: z.record(z.string(), TelegramGroupConfigSchema).optional(),
  historyLimit: z.number().default(50),
  textChunkLimit: z.number().default(4000),
  streamMode: z.enum(['off', 'partial', 'block']).default('partial'),
  proxy: z.string().optional(),
  apiRoot: z.string().optional(),
});

export const TelegramConfigSchema = z.object({
  enabled: z.boolean().default(false),
  token: z.string().default(''),
  allowFrom: z.array(z.union([z.string(), z.number()])).default([]),
  apiRoot: z.string().optional(),
  debug: z.boolean().default(false),
  accounts: z.record(z.string(), TelegramAccountConfigSchema).optional(),
  dmPolicy: z.enum(['pairing', 'allowlist', 'open', 'disabled']).default('pairing'),
  groupPolicy: z.enum(['open', 'disabled', 'allowlist']).default('open'),
});

export const WhatsAppConfigSchema = z.object({
  enabled: z.boolean().default(false),
  bridgeUrl: z.string().default('ws://localhost:3001'),
  allowFrom: z.array(z.string()).default([]),
});

export const ChannelsConfigSchema = z.object({
  telegram: TelegramConfigSchema.optional(),
  whatsapp: WhatsAppConfigSchema.optional(),
}).default({
  telegram: {
    enabled: false,
    token: '',
    allowFrom: [],
    debug: false,
    dmPolicy: 'pairing' as const,
    groupPolicy: 'open' as const,
  },
  whatsapp: {
    enabled: false,
    bridgeUrl: 'ws://localhost:3001',
    allowFrom: [],
  },
});

export const WebSearchConfigSchema = z.object({
  apiKey: z.string(),
  maxResults: z.number(),
}).default({
  apiKey: '',
  maxResults: 5,
});

export const WebToolsConfigSchema = z.object({
  search: WebSearchConfigSchema.optional(),
});

export const ToolsConfigSchema = z.object({
  web: WebToolsConfigSchema.optional(),
}).default({
  web: {
    search: {
      apiKey: '',
      maxResults: 5,
    },
  },
});

// ============================================
// Gateway Configuration
// ============================================

export const GatewayAuthSchema = z.object({
  mode: z.enum(['none', 'token']).default('token'),
  token: z.string().optional(),
}).default({
  mode: 'token',
});

export const HeartbeatConfigSchema = z.object({
  enabled: z.boolean(),
  intervalMs: z.number(),
}).default({
  enabled: true,
  intervalMs: 60000,
});

export const GatewayConfigSchema = z.object({
  host: z.string().optional(),
  port: z.number().optional(),
  auth: GatewayAuthSchema.optional(),
  heartbeat: HeartbeatConfigSchema.optional(),
  maxSseConnections: z.number().optional(),
  corsOrigins: z.array(z.string()).optional(),
}).default({
  host: '0.0.0.0',
  port: 18790,
  auth: {
    mode: 'token',
  },
  heartbeat: {
    enabled: true,
    intervalMs: 60000,
  },
  maxSseConnections: 100,
  corsOrigins: ['*'],
});

export const CronConfigSchema = z.object({
  enabled: z.boolean().optional(),
  maxConcurrentJobs: z.number().optional(),
  defaultTimezone: z.string().optional(),
  historyRetentionDays: z.number().optional(),
  enableMetrics: z.boolean().optional(),
}).default({
  enabled: true,
  maxConcurrentJobs: 5,
  defaultTimezone: 'UTC',
  historyRetentionDays: 7,
  enableMetrics: true,
});

export const ModelsDevConfigSchema = z.object({
  enabled: z.boolean().default(true),
}).default({
  enabled: true,
});

// ============================================
// Plugin Configs
// ============================================

export const PluginsConfigSchema = z.record(
  z.string(),
  z.union([
    z.boolean(),
    z.array(z.string()),
    z.record(z.string(), z.unknown())
  ])
).default({});

// ============================================
// Root Config
// ============================================

export const ConfigSchema = z.object({
  agents: AgentsConfigSchema,
  channels: ChannelsConfigSchema,
  gateway: GatewayConfigSchema,
  tools: ToolsConfigSchema,
  cron: CronConfigSchema,
  plugins: PluginsConfigSchema,
  modelsDev: ModelsDevConfigSchema,
  providers: ProvidersConfigSchema,
}).default({
  agents: {
    defaults: {
      workspace: '~/.xopcbot/workspace',
      model: 'anthropic/claude-sonnet-4-5',
      maxTokens: 8192,
      temperature: 0.7,
      maxToolIterations: 20,
      compaction: {
        enabled: true,
        mode: 'default',
        reserveTokens: 8000,
        triggerThreshold: 0.8,
        minMessagesBeforeCompact: 10,
        keepRecentMessages: 5,
      },
      pruning: {
        enabled: true,
        maxToolResultChars: 10000,
        headKeepRatio: 0.3,
        tailKeepRatio: 0.3,
      },
    },
  },
  channels: {
    telegram: {
      enabled: false,
      token: '',
      allowFrom: [],
      debug: false,
      dmPolicy: 'pairing' as const,
      groupPolicy: 'open' as const,
    },
    whatsapp: {
      enabled: false,
      bridgeUrl: 'ws://localhost:3001',
      allowFrom: [],
    },
  },
  gateway: {
    host: '0.0.0.0',
    port: 18790,
    auth: {
      mode: 'token',
    },
    heartbeat: {
      enabled: true,
      intervalMs: 60000,
    },
    maxSseConnections: 100,
    corsOrigins: ['*'],
  },
  tools: {
    web: {
      search: {
        apiKey: '',
        maxResults: 5,
      },
    },
  },
  cron: {
    enabled: true,
    maxConcurrentJobs: 5,
    defaultTimezone: 'UTC',
    historyRetentionDays: 7,
    enableMetrics: true,
  },
  plugins: {},
  modelsDev: {
    enabled: true,
  },
  providers: {},
});

export type Config = z.infer<typeof ConfigSchema>;
export type AgentDefaults = z.infer<typeof AgentDefaultsSchema>;
export type GatewayAuthConfig = z.infer<typeof GatewayAuthSchema>;
export type TelegramConfig = z.infer<typeof TelegramConfigSchema>;
export type WhatsAppConfig = z.infer<typeof WhatsAppConfigSchema>;

// Provider config types
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;
export type RichProviderConfig = z.infer<typeof RichProviderConfigSchema>;
export type CustomModel = z.infer<typeof CustomModelSchema>;
export type ModelOverride = z.infer<typeof ModelOverrideSchema>;
export type OpenAICompat = z.infer<typeof OpenAICompatSchema>;

// ============================================
// Helper Functions
// ============================================

/**
 * 从配置中获取 API key (支持 string 和 object 两种格式)
 */
export function getApiKey(config: Config, provider: string): string | undefined {
  const providerConfig = config.providers?.[provider];
  if (typeof providerConfig === 'string') {
    return providerConfig;
  }
  if (typeof providerConfig === 'object' && providerConfig !== null) {
    return providerConfig.apiKey;
  }
  return undefined;
}

/**
 * 获取 provider 的完整配置对象
 */
export function getProviderConfig(config: Config, provider: string): RichProviderConfig | undefined {
  const providerConfig = config.providers?.[provider];
  if (typeof providerConfig === 'object' && providerConfig !== null) {
    return providerConfig;
  }
  return undefined;
}
}

/**
 * 解析模型引用
 */
export interface ParsedModelRef {
  provider: string;
  model: string;
}

/**
 * @deprecated Use detectProvider from providers/index.js instead
 */
export function parseModelId(modelId: string): ParsedModelRef {
  // 优先检查 provider/model 格式
  if (modelId.includes('/')) {
    const [provider, model] = modelId.split('/');
    return { provider: provider.toLowerCase(), model };
  }

  // 使用统一的 provider 检测（避免循环导入，暂时保留简单逻辑）
  const lower = modelId.toLowerCase();
  if (lower.startsWith('gpt-') || lower.startsWith('o1') || lower.startsWith('o3') || lower.startsWith('o4')) {
    return { provider: 'openai', model: modelId };
  }
  if (lower.startsWith('claude-')) {
    return { provider: 'anthropic', model: modelId };
  }
  if (lower.startsWith('gemini-')) {
    return { provider: 'google', model: modelId };
  }
  if (lower.startsWith('deepseek')) {
    return { provider: 'deepseek', model: modelId };
  }
  if (lower.startsWith('grok')) {
    return { provider: 'xai', model: modelId };
  }

  // 默认回退到 openai
  return { provider: 'openai', model: modelId };
}

/**
 * 检查 provider 是否已配置
 */
export function isProviderConfigured(config: Config, provider: string): boolean {
  // 1. 检查 config
  if (config.providers?.[provider]) return true;

  // 2. 检查环境变量
  const envMap: Record<string, string[]> = {
    openai: ['OPENAI_API_KEY'],
    anthropic: ['ANTHROPIC_API_KEY'],
    google: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
    groq: ['GROQ_API_KEY'],
    deepseek: ['DEEPSEEK_API_KEY'],
    qwen: ['QWEN_API_KEY', 'DASHSCOPE_API_KEY'],
    kimi: ['KIMI_API_KEY', 'MOONSHOT_API_KEY'],
    minimax: ['MINIMAX_API_KEY'],
    zhipu: ['ZHIPU_API_KEY'],
    openrouter: ['OPENROUTER_API_KEY'],
    xai: ['XAI_API_KEY'],
    cerebras: ['CEREBRAS_API_KEY'],
    mistral: ['MISTRAL_API_KEY'],
  };

  const keys = envMap[provider] || [];
  return keys.some(key => process.env[key]);
}

/**
 * 获取所有已配置的 provider
 */
export function listConfiguredProviders(config: Config): string[] {
  const providers = new Set<string>();

  // 从 config 添加
  if (config.providers) {
    for (const [provider, key] of Object.entries(config.providers)) {
      if (key) providers.add(provider);
    }
  }

  // 从环境变量添加
  const allProviders = ['openai', 'anthropic', 'google', 'groq', 'deepseek', 
    'qwen', 'kimi', 'minimax', 'zhipu', 'openrouter', 'xai', 'cerebras', 'mistral'];
  for (const p of allProviders) {
    if (isProviderConfigured(config, p)) providers.add(p);
  }

  return Array.from(providers);
}

/**
 * 获取工作空间路径
 */
export function getWorkspacePath(config: Config): string {
  const workspace = config.agents.defaults.workspace;
  if (workspace.startsWith('~')) {
    return workspace.replace('~', homedir());
  }
  return workspace;
}
