import { z } from 'zod';
import { homedir } from 'os';

// ============================================
// Agent Configs
// ============================================

export const AgentModelRefSchema = z.union([
  z.string(),
  z
    .object({
      primary: z.string().optional(),
      fallbacks: z.array(z.string()).optional(),
    })
    .strict(),
]);

export type AgentModelConfig = z.infer<typeof AgentModelRefSchema>;

export const AgentDefaultsSchema = z.object({
  workspace: z.string().default('~/.xopcbot/workspace'),
  model: z.union([
    z.string(),
    z.object({
      primary: z.string().optional(),
      fallbacks: z.array(z.string()).optional(),
    }).strict(),
  ]).default(''), // Empty default - will be resolved dynamically at runtime
  /** Vision / image understanding model (provider/model). Falls back to heuristics when unset. */
  imageModel: AgentModelRefSchema.optional(),
  /** Image generation model (provider/model), e.g. openai/gpt-image-1. Thin REST wrapper; OpenAI supported. */
  imageGenerationModel: AgentModelRefSchema.optional(),
  /** Max image size for image tool loads (MB). */
  mediaMaxMb: z.number().positive().optional(),
  maxTokens: z.number().default(8192),
  temperature: z.number().default(0.7),
  maxToolIterations: z.number().default(20),
  // Task timeout (in milliseconds, default: 5 minutes)
  maxTaskDurationMs: z.number().min(60000).max(3600000).optional(),
  // Reliability settings
  maxRequestsPerTurn: z.number().min(10).max(200).default(50),
  maxToolFailuresPerTurn: z.number().min(1).max(20).default(3),
  // Thinking ability settings
  thinkingDefault: z.enum(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'adaptive']).optional(),
  reasoningDefault: z.enum(['off', 'on', 'stream']).optional(),
  verboseDefault: z.enum(['off', 'on', 'full']).optional(),
  compaction: z.object({
    enabled: z.boolean().default(true),
    mode: z.enum(['default', 'safeguard']).default('default'),
    reserveTokens: z.number().default(8000),
    triggerThreshold: z.number().min(0.5).max(0.95).default(0.8),
    minMessagesBeforeCompact: z.number().default(10),
    keepRecentMessages: z.number().default(5),
    // Dual-strategy compaction
    evictionWindow: z.number().min(0.1).max(0.5).default(0.2),
    retentionWindow: z.number().min(3).max(20).default(6),
  }).optional(),
  pruning: z.object({
    enabled: z.boolean().default(true),
    maxToolResultChars: z.number().default(10000),
    headKeepRatio: z.number().default(0.3),
    tailKeepRatio: z.number().default(0.3),
  }).optional(),
});

export const AgentConfigSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  enabled: z.boolean().default(true),
});

export const AgentsConfigSchema = z.object({
  defaults: AgentDefaultsSchema.optional(),
  list: z.array(AgentConfigSchema).optional(),
}).default({
  defaults: {
    workspace: '~/.xopcbot/workspace',
    model: '', // Empty default - will be resolved dynamically at runtime
    maxTokens: 8192,
    temperature: 0.7,
    maxToolIterations: 20,
    maxRequestsPerTurn: 50,
    maxToolFailuresPerTurn: 3,
    compaction: {
      enabled: true,
      mode: 'default',
      reserveTokens: 8000,
      triggerThreshold: 0.8,
      minMessagesBeforeCompact: 10,
      keepRecentMessages: 5,
      evictionWindow: 0.2,
      retentionWindow: 6,
    },
    pruning: {
      enabled: true,
      maxToolResultChars: 10000,
      headKeepRatio: 0.3,
      tailKeepRatio: 0.3,
    },
  },
} as any);

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
  botToken: z.string().default(''),
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

/** Implicit enable when `botToken` is set. */
function preprocessTelegramConfigInput(raw: unknown): unknown {
  if (raw === null || raw === undefined) return raw;
  if (typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const o = { ...(raw as Record<string, unknown>) };
  const botToken = typeof o.botToken === 'string' ? o.botToken : '';
  if (o.enabled === undefined && botToken.trim().length > 0) {
    o.enabled = true;
  }
  return o;
}

const TelegramConfigSchemaInner = z.object({
  enabled: z.boolean().default(false),
  botToken: z.string().default(''),
  allowFrom: z.array(z.union([z.string(), z.number()])).default([]),
  groupAllowFrom: z.array(z.union([z.string(), z.number()])).default([]),
  apiRoot: z.string().optional(),
  debug: z.boolean().default(false),
  accounts: z.record(z.string(), TelegramAccountConfigSchema).optional(),
  dmPolicy: z.enum(['pairing', 'allowlist', 'open', 'disabled']).default('pairing'),
  groupPolicy: z.enum(['open', 'disabled', 'allowlist']).default('open'),
  replyToMode: z.enum(['off', 'first', 'all']).default('off'),
  streamMode: z.enum(['off', 'partial', 'block']).optional(),
  historyLimit: z.number().default(50),
  textChunkLimit: z.number().default(4000),
  proxy: z.string().optional(),
});

export const TelegramConfigSchema = z.preprocess(
  preprocessTelegramConfigInput,
  TelegramConfigSchemaInner
);

const WeixinAccountConfigSchema = z.object({
  name: z.string().optional(),
  enabled: z.boolean().optional(),
  cdnBaseUrl: z.string().optional(),
  routeTag: z.union([z.string(), z.number()]).optional(),
  dmPolicy: z.enum(['pairing', 'allowlist', 'open', 'disabled']).default('pairing'),
  allowFrom: z.array(z.string()).default([]),
  streamMode: z.enum(['off', 'partial', 'block']).optional(),
  debug: z.boolean().optional(),
});

export const WeixinConfigSchema = z.object({
  enabled: z.boolean().default(false),
  dmPolicy: z.enum(['pairing', 'allowlist', 'open', 'disabled']).default('pairing'),
  allowFrom: z.array(z.string()).default([]),
  debug: z.boolean().default(false),
  streamMode: z.enum(['off', 'partial', 'block']).optional(),
  historyLimit: z.number().default(50),
  textChunkLimit: z.number().default(4000),
  routeTag: z.union([z.string(), z.number()]).optional(),
  accounts: z.record(z.string(), WeixinAccountConfigSchema).optional(),
});

// ============================================
// Session Routing Configuration
// ============================================

export const BindingMatchSchema = z.object({
  channel: z.string(),
  accountId: z.string().optional(),
  peerKind: z.string().optional(),
  peerId: z.string().optional(),
  guildId: z.string().optional(),
  teamId: z.string().optional(),
  memberRoleIds: z.array(z.string()).optional(),
});

export const BindingRuleSchema = z.object({
  id: z.string().optional(),
  agentId: z.string(),
  priority: z.number().default(100),
  match: BindingMatchSchema,
  enabled: z.boolean().default(true),
});

export const BindingsConfigSchema = z.array(BindingRuleSchema).default([]);

export const SessionDmScopeSchema = z.enum([
  'main',
  'per-peer',
  'per-channel-peer',
  'per-account-channel-peer',
]);

export const SessionStorageConfigSchema = z.object({
  pruneAfterMs: z.number().optional(),
  maxEntries: z.number().optional(),
});

export const SessionConfigSchema = z.object({
  dmScope: SessionDmScopeSchema.default('main'),
  identityLinks: z.record(z.string(), z.array(z.string())).optional(),
  storage: SessionStorageConfigSchema.optional(),
}).default({
  dmScope: 'main',
});

export const ChannelsConfigSchema = z.object({
  telegram: TelegramConfigSchema.optional(),
  weixin: WeixinConfigSchema.optional(),
}).default({
  telegram: {
    enabled: false,
    botToken: '',
    allowFrom: [],
    groupAllowFrom: [],
    debug: false,
    dmPolicy: 'pairing' as const,
    groupPolicy: 'open' as const,
    replyToMode: 'off' as const,
    historyLimit: 50,
    textChunkLimit: 4000,
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

export const HeartbeatConfigSchema = z
  .object({
    enabled: z.boolean(),
    intervalMs: z.number(),
    target: z.string().optional(),
    targetChatId: z.string().optional(),
    prompt: z.string().optional(),
    ackMaxChars: z.number().optional(),
    isolatedSession: z.boolean().optional(),
    activeHours: z
      .object({
        start: z.string(),
        end: z.string(),
        timezone: z.string().optional(),
      })
      .optional(),
  })
  .default({
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
  host: '127.0.0.1',
  port: 18790,
  auth: {
    mode: 'token',
  },
  heartbeat: {
    enabled: true,
    intervalMs: 60000,
  },
  maxSseConnections: 100,
  corsOrigins: [],
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

export const TTSFallbackConfigSchema = z.object({
  enabled: z.boolean().default(true),
  order: z.array(z.enum(['openai', 'alibaba', 'edge'])).default(['openai', 'alibaba', 'edge']),
});

export const TTSModelOverridesConfigSchema = z.object({
  enabled: z.boolean().default(true),
  allowText: z.boolean().default(true),
  allowProvider: z.boolean().default(false),
  allowVoice: z.boolean().default(true),
  allowModelId: z.boolean().default(true),
  allowVoiceSettings: z.boolean().default(false),
  allowNormalization: z.boolean().default(false),
  allowSeed: z.boolean().default(false),
});

export const TTSEdgeConfigSchema = z.object({
  enabled: z.boolean().default(true),
  voice: z.string().optional(),
  lang: z.string().optional(),
  outputFormat: z.string().optional(),
  pitch: z.string().optional(),
  rate: z.string().optional(),
  volume: z.string().optional(),
  proxy: z.string().optional(),
  timeoutMs: z.number().int().min(1000).max(120000).optional(),
});

export const TTSConfigSchema = z.object({
  enabled: z.boolean().default(false),
  provider: z.enum(['openai', 'alibaba', 'edge']).default('openai'),
  trigger: z.enum(['off', 'always', 'inbound', 'tagged']).default('always'),
  fallback: TTSFallbackConfigSchema.optional(),
  maxTextLength: z.number().int().min(1).default(512), // Conservative default to accommodate all providers (Alibaba limit is 512)
  timeoutMs: z.number().int().min(1000).max(120000).default(30000),
  modelOverrides: TTSModelOverridesConfigSchema.optional(),
  alibaba: TTSProviderConfigSchema.optional(),
  openai: TTSProviderConfigSchema.optional(),
  edge: TTSEdgeConfigSchema.optional(),
});

// ============================================
// ACP (Agent Control Protocol) Config
// ============================================

export const AcpDispatchConfigSchema = z.object({
  /** Master switch for ACP turn dispatch */
  enabled: z.boolean().optional(),
});

export const AcpStreamConfigSchema = z.object({
  /** Coalescer idle flush window in milliseconds */
  coalesceIdleMs: z.number().optional(),
  /** Maximum text size per streamed chunk */
  maxChunkChars: z.number().optional(),
  /** Suppresses repeated status/tool projection lines */
  repeatSuppression: z.boolean().optional(),
  /** Live streams or waits for terminal event */
  deliveryMode: z.enum(['live', 'final_only']).optional(),
  /** Separator before visible text when hidden tool events occurred */
  hiddenBoundarySeparator: z.enum(['none', 'space', 'newline', 'paragraph']).optional(),
  /** Maximum assistant output characters per turn */
  maxOutputChars: z.number().optional(),
  /** Maximum visible characters for session/update lines */
  maxSessionUpdateChars: z.number().optional(),
  /** Per-sessionUpdate visibility overrides */
  tagVisibility: z.record(z.string(), z.boolean()).optional(),
});

export const AcpRuntimeConfigSchema = z.object({
  /** Idle runtime TTL in minutes */
  ttlMinutes: z.number().optional(),
  /** Install/setup command shown by doctor */
  installCommand: z.string().optional(),
});

export const AcpRateLimitConfigSchema = z.object({
  /** Maximum requests per window per session */
  maxRequests: z.number().default(100),
  /** Time window in milliseconds */
  windowMs: z.number().default(60000),
  /** Whether to enable rate limiting */
  enabled: z.boolean().default(true),
});

export const AcpConfigSchema = z.object({
  /** Global ACP runtime gate */
  enabled: z.boolean().default(false),
  dispatch: AcpDispatchConfigSchema.optional(),
  /** Backend id registered by ACP runtime plugin */
  backend: z.string().optional(),
  /** Default agent for ACP sessions */
  defaultAgent: z.string().optional(),
  /** Allowed agents list */
  allowedAgents: z.array(z.string()).optional(),
  /** Maximum concurrent ACP sessions */
  maxConcurrentSessions: z.number().optional(),
  /** Rate limiting configuration */
  rateLimit: AcpRateLimitConfigSchema.optional(),
  stream: AcpStreamConfigSchema.optional(),
  runtime: AcpRuntimeConfigSchema.optional(),
});

// ============================================
// ============================================
// Extension Configs 
// ============================================

// Security config for extensions 
export const ExtensionSecurityConfigSchema = z.object({
  checkPermissions: z.boolean().default(true),
  allowUntrusted: z.boolean().default(false),
  allow: z.array(z.string()).default([]),
  trackProvenance: z.boolean().default(true),
  allowPromptInjection: z.boolean().default(false),
});

// Slot config for extensions 
export const ExtensionSlotsConfigSchema = z.object({
  memory: z.string().optional(),
  tts: z.string().optional(),
  imageGeneration: z.string().optional(),
  webSearch: z.string().optional(),
});

// Complete extensions config
// Extension config allows both known fields AND arbitrary extension-specific config
// Known fields: enabled (array), allow (array), security (object), slots (object)
// Arbitrary: any other key is extension-specific config (e.g., extensions.hello.greeting)
export const ExtensionsConfigSchema: z.ZodType<Record<string, unknown>> = z.record(z.string(), z.unknown());

// ============================================
// Root Config
// ============================================

export const ConfigSchema = z.object({
  agents: AgentsConfigSchema,
  bindings: BindingsConfigSchema,
  session: SessionConfigSchema,
  channels: ChannelsConfigSchema,
  gateway: GatewayConfigSchema,
  tools: ToolsConfigSchema,
  cron: CronConfigSchema,
  extensions: ExtensionsConfigSchema.default({}),
  modelsDev: ModelsDevConfigSchema,
  stt: STTConfigSchema.optional(),
  tts: TTSConfigSchema.optional(),
  acp: AcpConfigSchema.optional(),
}).default({
  agents: {
    defaults: {
      workspace: '~/.xopcbot/workspace',
      model: '', // Empty default - will be resolved dynamically at runtime
      maxTokens: 8192,
      temperature: 0.7,
      maxToolIterations: 20,
      maxRequestsPerTurn: 50,
      maxToolFailuresPerTurn: 3,
      thinkingDefault: 'medium',
      reasoningDefault: 'off',
      verboseDefault: 'off',
      compaction: {
        enabled: true,
        mode: 'default',
        reserveTokens: 8000,
        triggerThreshold: 0.8,
        minMessagesBeforeCompact: 10,
        keepRecentMessages: 5,
        evictionWindow: 0.2,
        retentionWindow: 6,
      },
      pruning: {
        enabled: true,
        maxToolResultChars: 10000,
        headKeepRatio: 0.3,
        tailKeepRatio: 0.3,
      },
    },
  },
  bindings: [],
  session: {
    dmScope: 'main' as const,
  },
  channels: {
    telegram: {
      enabled: false,
      botToken: '',
      allowFrom: [],
      groupAllowFrom: [],
      debug: false,
      dmPolicy: 'pairing' as const,
      groupPolicy: 'open' as const,
      replyToMode: 'off' as const,
      historyLimit: 50,
      textChunkLimit: 4000,
    },
  },
  gateway: {
    host: '127.0.0.1',
    port: 18790,
    auth: {
      mode: 'token',
    },
    heartbeat: {
      enabled: true,
      intervalMs: 60000,
    },
    maxSseConnections: 100,
    corsOrigins: [],
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
  extensions: {
    allow: [],
    security: {
      checkPermissions: true,
      allowUntrusted: false,
      allow: [],
      trackProvenance: true,
      allowPromptInjection: false,
    },
    slots: {},
  },
  modelsDev: {
    enabled: true,
  },
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
    provider: 'openai',
    trigger: 'always',
    fallback: {
      enabled: true,
      order: ['openai', 'alibaba', 'edge'],
    },
    maxTextLength: 4096,
    timeoutMs: 30000,
    modelOverrides: {
      enabled: true,
      allowText: true,
      allowProvider: false,
      allowVoice: true,
      allowModelId: true,
      allowVoiceSettings: false,
      allowNormalization: false,
      allowSeed: false,
    },
    alibaba: {
      model: 'qwen-tts',
      voice: 'Cherry',
    },
    openai: {
      model: 'tts-1',
      voice: 'alloy',
    },
    edge: {
      enabled: true,
      voice: 'en-US-MichelleNeural',
      lang: 'en-US',
      outputFormat: 'audio-24khz-48kbitrate-mono-mp3',
    },
  },
});

export type Config = z.infer<typeof ConfigSchema>;
export type AgentDefaults = z.infer<typeof AgentDefaultsSchema>;
export type GatewayAuthConfig = z.infer<typeof GatewayAuthSchema>;
export type TelegramConfig = z.infer<typeof TelegramConfigSchema>;
export type WeixinConfig = z.infer<typeof WeixinConfigSchema>;
export type STTConfig = z.infer<typeof STTConfigSchema>;
export type TTSConfig = z.infer<typeof TTSConfigSchema>;
export type AcpConfig = z.infer<typeof AcpConfigSchema>;

// ============================================
// Helper Functions
// ============================================

/**
 * Parse a model reference string.
 */
export interface ParsedModelRef {
  provider: string;
  model: string;
}

export { isProviderConfigured } from '../providers/index.js';

/**
 * Resolve the workspace directory path from config.
 */
export function getWorkspacePath(config: Config): string {
  const workspace = config.agents.defaults.workspace;
  if (workspace.startsWith('~')) {
    return workspace.replace('~', homedir());
  }
  return workspace;
}

/**
 * Primary model ref from `agents.defaults.model` (string or `{ primary }`).
 * Returns undefined when unset or empty.
 */
export function getAgentDefaultModelRef(config: Config): string | undefined {
  const raw = config.agents?.defaults?.model;
  if (raw === undefined || raw === null) return undefined;
  const ref = typeof raw === 'string' ? raw : raw.primary;
  if (ref === undefined || ref === null) return undefined;
  const s = String(ref).trim();
  return s ? s : undefined;
}

/** `provider/model` or null when invalid. */
export function parseModelRef(ref: string): ParsedModelRef | null {
  const trimmed = ref.trim();
  const idx = trimmed.indexOf('/');
  if (idx <= 0 || idx === trimmed.length - 1) {
    return null;
  }
  return { provider: trimmed.slice(0, idx).trim(), model: trimmed.slice(idx + 1).trim() };
}
