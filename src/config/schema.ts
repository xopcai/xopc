import { z } from 'zod';
import { homedir } from 'os';

// ============================================
// Provider API Keys (simple format only)
// ============================================
// Rich provider configs (baseUrl, models, etc.) are in models.json
// See src/config/models-json.ts and docs/models.md

export const ProvidersConfigSchema = z.record(z.string(), z.string()).default({});

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

export const ChannelsConfigSchema = z.object({
  telegram: TelegramConfigSchema.optional(),
}).default({
  telegram: {
    enabled: false,
    token: '',
    allowFrom: [],
    debug: false,
    dmPolicy: 'pairing' as const,
    groupPolicy: 'open' as const,
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
// STT (Speech-to-Text) Config
// ============================================

export const STTProviderConfigSchema = z.object({
  apiKey: z.string().optional(),
  model: z.string().optional(),
});

export const STTFallbackConfigSchema = z.object({
  enabled: z.boolean().default(true),
  order: z.array(z.enum(['alibaba', 'openai'])).default(['alibaba', 'openai']),
});

export const STTConfigSchema = z.object({
  enabled: z.boolean().default(false),
  provider: z.enum(['alibaba', 'openai']).default('alibaba'),
  alibaba: STTProviderConfigSchema.optional(),
  openai: STTProviderConfigSchema.optional(),
  fallback: STTFallbackConfigSchema.optional(),
});

// ============================================
// TTS (Text-to-Speech) Config
// ============================================

export const TTSProviderConfigSchema = z.object({
  apiKey: z.string().optional(),
  model: z.string().optional(),
  voice: z.string().optional(),
});

export const TTSConfigSchema = z.object({
  enabled: z.boolean().default(false),
  provider: z.enum(['openai', 'alibaba']).default('openai'),
  trigger: z.enum(['auto', 'never']).default('auto'),
  alibaba: TTSProviderConfigSchema.optional(),
  openai: TTSProviderConfigSchema.optional(),
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
  stt: STTConfigSchema.optional(),
  tts: TTSConfigSchema.optional(),
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
  stt: {
    enabled: false,
    provider: 'alibaba',
    alibaba: {
      model: 'paraformer-v2',
    },
    openai: {
      model: 'whisper-1',
    },
    fallback: {
      enabled: true,
      order: ['alibaba', 'openai'],
    },
  },
  tts: {
    enabled: false,
    provider: 'alibaba',
    trigger: 'auto',
    alibaba: {
      model: 'qwen3-tts-flash',
      voice: 'Cherry',
    },
    openai: {
      model: 'tts-1',
      voice: 'alloy',
    },
  },
});

export type Config = z.infer<typeof ConfigSchema>;
export type AgentDefaults = z.infer<typeof AgentDefaultsSchema>;
export type GatewayAuthConfig = z.infer<typeof GatewayAuthSchema>;
export type TelegramConfig = z.infer<typeof TelegramConfigSchema>;
export type STTConfig = z.infer<typeof STTConfigSchema>;
export type TTSConfig = z.infer<typeof TTSConfigSchema>;

// ============================================
// Helper Functions
// ============================================

/**
 * 从配置中获取 API key (simple string format only)
 * For rich provider configs, use models.json
 */
export function getApiKey(config: Config, provider: string): string | undefined {
  return config.providers?.[provider];
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

// Re-export from providers/index.ts for backward compatibility
export { isProviderConfigured, getConfiguredProviders as listConfiguredProviders } from '../providers/index.js';

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
