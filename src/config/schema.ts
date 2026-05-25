import { z } from 'zod';

import { getDefaultWorkspacePath } from '../agent/agent-scope.js';

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

/**
 * Image-generation model ref. Superset of {@link AgentModelRefSchema} with
 * runtime knobs (`timeoutMs`, `autoProviderFallback`) used by the
 * image-generation runtime; falls back to a plain string for backward
 * compatibility with old configs.
 */
export const AgentImageGenerationModelSchema = z.union([
  z.string(),
  z
    .object({
      primary: z.string().optional(),
      fallbacks: z.array(z.string()).optional(),
      /** Hard cap for the whole generation attempt (ms). */
      timeoutMs: z.number().int().positive().optional(),
      /**
       * When all `primary + fallbacks` candidates fail, sweep every other
       * configured provider before giving up.
       */
      autoProviderFallback: z.boolean().optional(),
    })
    .strict(),
]);

export type AgentImageGenerationModelConfig = z.infer<typeof AgentImageGenerationModelSchema>;

export const AgentDefaultsSchema = z.object({
  /** Parent directory: each agent’s Markdown root is `<expanded>/<agentId>/` (e.g. `.../workspace/main`). */
  workspace: z.string().default('~/.xopc/workspace'),
  model: z.union([
    z.string(),
    z.object({
      primary: z.string().optional(),
      fallbacks: z.array(z.string()).optional(),
    }).strict(),
  ]).default(''), // Empty default - will be resolved dynamically at runtime
  /** Vision / image understanding model (provider/model). Falls back to heuristics when unset. */
  imageModel: AgentModelRefSchema.optional(),
  /** Image generation model (provider/model), e.g. openai/gpt-image-1. Supports plugin-based providers (OpenAI / DashScope / MiniMax / Google / Fal). */
  imageGenerationModel: AgentImageGenerationModelSchema.optional(),
  /** Max image size for image tool loads (MB). */
  mediaMaxMb: z.number().positive().optional(),
  maxTokens: z.number().default(8192),
  temperature: z.number().default(0.7),
  maxToolIterations: z.number().default(20),
  // Wall-clock limit for one user turn (LLM + tools). Default 30m if unset; cap 4h.
  maxTaskDurationMs: z.number().min(60000).max(14_400_000).optional(),
  // Reliability settings
  maxRequestsPerTurn: z.number().min(10).max(200).default(50),
  maxToolFailuresPerTurn: z.number().min(1).max(20).default(3),
  // Thinking ability settings
  thinkingDefault: z.enum(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'adaptive']).optional(),
  reasoningDefault: z.enum(['off', 'on', 'stream']).optional(),
  verboseDefault: z.enum(['off', 'on', 'full']).optional(),
  bootstrapMaxChars: z.number().int().positive().optional(),
  bootstrapTotalMaxChars: z.number().int().positive().optional(),
  bootstrapPromptTruncationWarning: z.enum(['off', 'once', 'always']).optional(),
  startupContext: z
    .object({
      enabled: z.boolean().optional(),
      applyOn: z.array(z.enum(['new', 'reset'])).optional(),
      dailyMemoryDays: z.number().int().min(1).optional(),
      maxFileBytes: z.number().int().positive().optional(),
      maxFileChars: z.number().int().positive().optional(),
      maxTotalChars: z.number().int().positive().optional(),
    })
    .optional(),
  contextLimits: z
    .object({
      postCompactionMaxChars: z.number().int().positive().optional(),
    })
    .optional(),
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
    postCompactionSections: z.array(z.string()).optional(),
  }).optional(),
  pruning: z.object({
    enabled: z.boolean().default(true),
    maxToolResultChars: z.number().default(10000),
    headKeepRatio: z.number().default(0.3),
    tailKeepRatio: z.number().default(0.3),
  }).optional(),
  /**
   * Curated memory (`agents/<id>/memories/`) + pluggable external provider.
   * Only one external provider at a time.
   */
  memory: z
    .object({
      /** Master switch: `curated_memory` tool, prefetch, and external provider. Default true. */
      enabled: z.boolean().optional(),
      /** When false, disable curated_memory tool and memory subsystem helpers. Default true. */
      useEnhancedSystem: z.boolean().optional(),
      /** Include USER.md in snapshot. Default true. */
      userProfileEnabled: z.boolean().optional(),
      memoryCharLimit: z.number().positive().optional(),
      userCharLimit: z.number().positive().optional(),
      provider: z.enum(['none', 'stub']).optional(),
      /** How often prefetched external memory is injected into the user message. */
      injectionFrequency: z.enum(['every-turn', 'first-turn']).optional(),
      /** Inject prefetch on turns 1, 1+N, 1+2N, … (only when injectionFrequency is every-turn). Min 1. */
      contextCadence: z.number().int().min(1).optional(),
      /** Reserved for future external “dialectic” sync cadence (not wired yet). */
      dialecticCadence: z.number().int().min(1).optional(),
      /**
       * Background memory consolidation ("dreaming"): three-phase sleep model that
       * promotes short-term recall signals into long-term memory (`MEMORY.md`).
       *
       * Phases:
       * - **light** — fast, frequent sweep (default every 6 h): dedup + signal collection.
       * - **deep**  — daily deep promotion (default 3 AM): score-gated write to MEMORY.md.
       * - **rem**   — weekly pattern discovery (default Sun 5 AM): cross-session insight mining.
       */
      dreaming: z
        .object({
          enabled: z.boolean().optional(),
          /** Default deep-phase cron when `phases.deep.cron` is omitted. */
          frequency: z.string().optional(),
          timezone: z.string().optional(),
          phases: z
            .object({
              light: z
                .object({
                  enabled: z.boolean().optional(),
                  cron: z.string().optional(),
                  lookbackDays: z.number().int().min(1).optional(),
                  limit: z.number().int().min(0).optional(),
                  dedupeSimilarity: z.number().min(0).max(1).optional(),
                })
                .optional(),
              deep: z
                .object({
                  enabled: z.boolean().optional(),
                  cron: z.string().optional(),
                  minScore: z.number().min(0).max(1).optional(),
                  minRecallCount: z.number().int().min(1).optional(),
                  minUniqueQueries: z.number().int().min(1).optional(),
                  limit: z.number().int().min(0).optional(),
                  recencyHalfLifeDays: z.number().min(1).optional(),
                  maxAgeDays: z.number().int().min(1).optional(),
                })
                .optional(),
              rem: z
                .object({
                  enabled: z.boolean().optional(),
                  cron: z.string().optional(),
                  lookbackDays: z.number().int().min(1).optional(),
                  limit: z.number().int().min(0).optional(),
                  minPatternStrength: z.number().min(0).max(1).optional(),
                })
                .optional(),
            })
            .optional(),
        })
        .optional(),
    })
    .optional(),
  /** Cross-session transcript search (`session_search` tool). */
  sessionSearch: z
    .object({
      /** Model ref for per-session summaries (e.g. openai/gpt-4o-mini). */
      summaryModel: z.string().optional(),
    })
    .optional(),
  /**
   * Post-turn background review (Hermes-style): optional quiet follow-up that may call
   * `curated_memory` / `skill_manage` so durable facts and reusable workflows persist
   * without bloating the main user-visible turn.
   */
  backgroundReview: z
    .object({
      /** When true, nudges may run after successful turns. Default false (opt-in). */
      enabled: z.boolean().optional(),
      /** User-turn cadence for memory review. 0 disables the memory channel. Default 10. */
      memoryNudgeInterval: z.number().int().min(0).optional(),
      /** LLM rounds without `skill_manage` before a skill review. 0 disables the skill channel. Default 10. */
      skillNudgeInterval: z.number().int().min(0).optional(),
      /** Max tool executions for the review agent. Default 8. */
      maxToolRounds: z.number().int().min(1).max(32).optional(),
      /** Max prior messages passed into the review context (tail). Default 80. */
      maxHistoryMessages: z.number().int().min(10).max(200).optional(),
      /** Wall-clock cap for the review run (ms). Default 120000. */
      maxDurationMs: z.number().int().min(30_000).max(600_000).optional(),
    })
    .optional(),
  /** LLM pass for `web_extract` (markdown-focused extraction). */
  webExtract: z
    .object({
      model: z.string().optional(),
      maxLength: z.number().positive().optional(),
    })
    .optional(),
  /**
   * Browser capability via unified `browser_use` tool. Enabled by default (set `enabled: false` to disable).
   * Install browsers once: `npx playwright install chromium`.
   */
  browser: z
    .object({
      enabled: z.boolean().optional(),
      /** Run browser in headless mode (default: false — visible window). */
      headless: z.boolean().optional(),
      /** When true, skip private-IP blocking for browser navigation (cloud metadata endpoints are always blocked). */
      allowPrivateUrls: z.boolean().optional(),
      /** Browser command timeout in seconds (default: 30). */
      commandTimeout: z.number().min(5).optional(),
      /** Browser backend mode: 'local' (Playwright), 'cdp', 'cloud', or 'extension' (Chrome Extension bridge). */
      backend: z.enum(['local', 'cdp', 'cloud', 'extension']).optional(),
      /** Cloud browser backend: 'local' (default Playwright), 'browserbase', or 'browser-use'. */
      cloudProvider: z.enum(['local', 'browserbase', 'browser-use']).optional(),
      /** Direct CDP WebSocket endpoint URL (bypasses cloud provider). */
      cdpUrl: z.string().optional(),
      /** Chrome Extension bridge settings (only used when backend = 'extension'). */
      extension: z.object({
        /** WebSocket server port. Default: 19820. */
        port: z.number().min(1024).max(65535).optional(),
        /** Host to bind. Default: 127.0.0.1. */
        host: z.string().optional(),
        /** Timeout waiting for extension connection (ms). Default: 30000. */
        connectionTimeout: z.number().min(1000).optional(),
      }).optional(),
      /** JS dialog handling policy: 'must_respond' (agent must act), 'auto_dismiss', or 'auto_accept'. */
      dialogPolicy: z.enum(['must_respond', 'auto_dismiss', 'auto_accept']).optional(),
      /** Dialog auto-dismiss/accept timeout in seconds (default: 300). */
      dialogTimeoutSeconds: z.number().min(1).optional(),
    })
    .optional(),
  /** Sub-agent delegation (`delegate_task`). Opt-in. */
  delegate: z
    .object({
      enabled: z.boolean().optional(),
    })
    .optional(),
  /** Sandboxed `execute_code` (programmatic tool calls). Opt-in. */
  executeCode: z
    .object({
      enabled: z.boolean().optional(),
    })
    .optional(),
  /** Optional full system prompt replacement (merged with per-agent entry; entry wins). */
  systemPromptOverride: z.string().optional(),
  /** Optional allowlist of skill names for `<available_skills>`; when set, replaces unfiltered list. */
  skills: z.array(z.string()).optional(),
  /** Disable built-in tools by name (e.g. `shell`, `web_search`). */
  tools: z
    .object({
      disable: z.array(z.string()).optional(),
    })
    .optional(),
  /** Opaque per-process params (reserved for extensions / future use). */
  params: z.record(z.string(), z.unknown()).optional(),
});

export const AgentConfigSchema = z.object({
  id: z.string(),
  /** When true, this entry is the default routing agent. */
  default: z.boolean().optional(),
  name: z.string().optional(),
  /** Short human-readable summary for UIs (gateway console, pickers). */
  description: z.string().max(4000).optional(),
  enabled: z.boolean().default(true),
  /** Per-agent workspace root (`~` expanded at runtime). */
  workspace: z.string().optional(),
  /**
   * Internal agent state directory (`…/credentials`, `agent.json`, pid, inbox).
   * Default: `<stateDir>/agents/<id>/agent`.
   */
  agentDir: z.string().optional(),
  model: AgentModelRefSchema.optional(),
  thinkingDefault: z.enum(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'adaptive']).optional(),
  reasoningDefault: z.enum(['off', 'on', 'stream']).optional(),
  verboseDefault: z.enum(['off', 'on', 'full']).optional(),
  systemPromptOverride: z.string().optional(),
  skills: z.array(z.string()).optional(),
  tools: z
    .object({
      disable: z.array(z.string()).optional(),
    })
    .optional(),
  params: z.record(z.string(), z.unknown()).optional(),
});

export const AgentsConfigSchema = z.object({
  /** Default agent id when not specified (routing / session creation). */
  default: z.string().optional(),
  defaults: AgentDefaultsSchema.optional(),
  list: z.array(AgentConfigSchema).optional(),
}).default({
  defaults: {
    workspace: '~/.xopc/workspace',
    model: '', // Empty default - will be resolved dynamically at runtime
    maxTokens: 8192,
    temperature: 0.7,
    maxToolIterations: 20,
    maxRequestsPerTurn: 50,
    maxToolFailuresPerTurn: 3,
    thinkingDefault: 'medium',
    reasoningDefault: 'stream',
    verboseDefault: 'full',
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
// Channel Configs (per-channel Zod lives in bundled extensions; root schema is open)
// ============================================

export {
  TelegramTopicConfigSchema,
  TelegramGroupConfigSchema,
  TelegramAccountConfigSchema,
  TelegramConfigSchema,
} from '../../extensions/telegram/src/config-schema.js';
export type { TelegramConfig } from '../../extensions/telegram/src/config-schema.js';
export { WeixinAccountConfigSchema, WeixinConfigSchema } from '../../extensions/weixin/src/config-schema.js';
export type { WeixinConfig } from '../../extensions/weixin/src/config-schema.js';
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

/** Channel buckets — shapes validated post-parse by registered channel plugins. */
export const ChannelsConfigSchema = z.record(z.string(), z.unknown()).default({
  telegram: {
    enabled: false,
    allowFrom: [],
    groupAllowFrom: [],
    debug: false,
    accounts: {
      default: {
        accountId: 'default',
        enabled: true,
        botToken: '',
        allowFrom: [],
        dmPolicy: 'pairing' as const,
        groupPolicy: 'open' as const,
        replyToMode: 'off' as const,
        historyLimit: 50,
        textChunkLimit: 4000,
        streamMode: 'partial' as const,
      },
    },
    dmPolicy: 'pairing' as const,
    groupPolicy: 'open' as const,
    replyToMode: 'off' as const,
    historyLimit: 50,
    textChunkLimit: 4000,
  },
});

export const SearchProviderEntrySchema = z.object({
  type: z.enum(['brave', 'tavily', 'bing', 'searxng']),
  apiKey: z.string().optional(),
  /** SearXNG instance base URL (e.g. http://localhost:8080) */
  url: z.string().optional(),
  disabled: z.boolean().optional(),
});

export type SearchProviderEntry = z.infer<typeof SearchProviderEntrySchema>;

export const WebSearchConfigSchema = z.object({
  maxResults: z.number().default(5),
  /** Ordered API providers; empty → HTML fallback only */
  providers: z.array(SearchProviderEntrySchema).default([]),
});

export type WebSearchConfig = z.infer<typeof WebSearchConfigSchema>;

export const WebsiteBlocklistSchema = z.object({
  /** Master switch. Default false (no blocking). */
  enabled: z.boolean().default(false),
  /** Domain patterns to block (e.g. "example.com", "*.evil.org"). */
  domains: z.array(z.string()).default([]),
});

export type WebsiteBlocklistConfig = z.infer<typeof WebsiteBlocklistSchema>;

export const WebToolsConfigSchema = z.object({
  /** Search result HTML fallback: cn → Bing, otherwise DuckDuckGo */
  region: z.enum(['cn', 'global']).optional(),
  search: WebSearchConfigSchema.optional(),
  /** Domain blocklist for web_fetch / web_extract / browser tools. */
  blocklist: WebsiteBlocklistSchema.optional(),
});

export type WebToolsConfig = z.infer<typeof WebToolsConfigSchema>;

export const ToolsConfigSchema = z.object({
  web: WebToolsConfigSchema.optional(),
  /**
   * Per-capability media providers. Currently only `audio` (STT) is wired;
   * `image` / `video` slots are reserved for future capabilities.
   */
  media: z.lazy(() => ToolsMediaConfigSchema),
}).default({
  web: {
    search: {
      maxResults: 5,
      providers: [],
    },
  },
});

// ============================================
// Gateway Configuration
// ============================================

export const GatewayAuthRateLimitSchema = z
  .object({
    enabled: z.boolean().default(true),
    maxAttempts: z.number().int().min(1).default(5),
    windowMs: z.number().default(900_000),
    blockDurationMs: z.number().default(300_000),
    /** OpenClaw alias for blockDurationMs. */
    lockoutMs: z.number().optional(),
    /** Skip rate limiting for loopback client IPs (default true). Browser Origin requests never exempt. */
    exemptLoopback: z.boolean().default(true),
  })
  .optional();

export const GatewaySecuritySchema = z
  .object({
    /** When true, non-loopback binds require explicit gateway.auth.rateLimit configuration. */
    strict: z.boolean().optional(),
  })
  .optional();

export const GatewayTrustedProxySchema = z
  .object({
    /** Header set by the reverse proxy with the authenticated user identity. */
    userHeader: z.string().min(1),
    /** Additional headers that must be present (e.g. proxy auth markers). */
    requiredHeaders: z.array(z.string()).optional(),
    /** When non-empty, only these user identities are allowed. */
    allowUsers: z.array(z.string()).optional(),
    /** Allow trusted-proxy auth when the TCP source is loopback (same-host reverse proxy). */
    allowLoopback: z.boolean().optional(),
  })
  .strict();

export const GatewayAuthSchema = z
  .object({
    mode: z.enum(['none', 'token', 'password', 'trusted-proxy']).default('token'),
    token: z.string().optional(),
    password: z.string().optional(),
    /** When true (default for Serve), browser UI may auth via Tailscale identity headers. API routes still require token. */
    allowTailscale: z.boolean().optional(),
    rateLimit: GatewayAuthRateLimitSchema,
    trustedProxy: GatewayTrustedProxySchema.optional(),
  })
  .default({
    mode: 'token',
  });

export const GatewayTailscaleConsentSchema = z.object({
  version: z.string().min(1),
  acceptedAt: z.string().min(1),
});

export const GatewayTailscaleSchema = z
  .object({
    mode: z.enum(['off', 'serve', 'funnel']).default('off'),
    resetOnExit: z.boolean().default(true),
    consent: GatewayTailscaleConsentSchema.optional(),
  })
  .default({
    mode: 'off',
    resetOnExit: true,
  });

export const GatewayRemoteSchema = z.object({
  url: z.string().url(),
  token: z.string().optional(),
  password: z.string().optional(),
  transport: z.enum(['direct', 'ssh']).default('direct'),
  sshTarget: z.string().optional(),
  sshIdentity: z.string().optional(),
  tlsFingerprint: z.string().optional(),
});

export const GatewayTlsSchema = z
  .object({
    enabled: z.boolean().default(false),
    autoGenerate: z.boolean().default(false),
    certPath: z.string().optional(),
    keyPath: z.string().optional(),
  })
  .default({
    enabled: false,
    autoGenerate: false,
  });

export const GatewayModeSchema = z.enum(['local', 'remote']).default('local');

export const HeartbeatConfigSchema = z
  .object({
    enabled: z.boolean(),
    intervalMs: z.number(),
    /** When false, heartbeat instructions are only sent during heartbeat polling turns (not in every chat system prompt). */
    includeSystemPromptSection: z.boolean().optional().default(false),
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
    intervalMs: 1_800_000,
    includeSystemPromptSection: false,
  });

export const GatewayChannelConnectDeferModeSchema = z.enum(['auto', 'off', 'explicit']);

export const TunnelConsentSchema = z.object({
  version: z.string().min(1),
  acceptedAt: z.string().min(1),
});

export const TunnelE2eSchema = z
  .object({
    enabled: z.boolean().default(true),
    tlsPort: z.number().int().min(1024).max(65535).default(18791),
    staging: z.boolean().default(false),
  })
  .default({
    enabled: true,
    tlsPort: 18791,
    staging: false,
  });

export const TunnelExposureModeSchema = z.enum(['public', 'pairing-only']);

export const TunnelConfigSchema = z
  .object({
    enabled: z.boolean().default(false),
    brokerUrl: z.string().url().default('https://frp.xopc.ai/api'),
    /** Broker register API secret (env `XOPC_TUNNEL_REGISTRATION_SECRET` overrides when set). */
    registrationSecret: z.string().min(1).optional(),
    autoStart: z.boolean().default(false),
    subdomain: z.string().optional(),
    /** public: full gateway; pairing-only: broker routes only mobile pair endpoints. */
    exposure: TunnelExposureModeSchema.default('public'),
    consent: TunnelConsentSchema.optional(),
    e2e: TunnelE2eSchema.optional(),
  })
  .default({
    enabled: false,
    brokerUrl: 'https://frp.xopc.ai/api',
    autoStart: false,
    exposure: 'public',
  });

export type TunnelConfig = z.infer<typeof TunnelConfigSchema>;

/**
 * Workspace-scoped concerns (file import, etc.). Distinct from
 * `agents.defaults.workspace`, which is the workspace *path*; this block carries
 * feature configuration for workspace-related routes.
 */
export const WorkspaceImportConfigSchema = z.object({
  /** Workspace-relative subdir for imported files. Default `imports`. */
  targetDir: z.string().default('imports'),
  /** Per-file byte cap. Default 100 MiB. */
  maxBytes: z.number().int().min(1024).max(10_737_418_240).default(104_857_600),
  /** When false, the route rejects `onConflict: 'overwrite'`. Default true. */
  allowOverwrite: z.boolean().default(true),
});
export type WorkspaceImportConfig = z.infer<typeof WorkspaceImportConfigSchema>;

export const WorkspaceConfigSchema = z.object({
  import: WorkspaceImportConfigSchema.optional(),
}).optional();
export type WorkspaceConfig = z.infer<typeof WorkspaceConfigSchema>;

export const GatewayBindModeSchema = z.enum(['auto', 'loopback', 'lan', 'tailnet', 'custom']);

export const GatewayConfigSchema = z.object({
  /** Semantic bind mode. */
  bind: GatewayBindModeSchema.optional(),
  /** IPv4 listen address when `bind` is `custom`. */
  customBindHost: z.string().optional(),
  port: z.number().optional(),
  /** local: this process runs the gateway; remote: CLI clients target gateway.remote. */
  mode: GatewayModeSchema.optional(),
  /** Persistent remote gateway target for CLI/TUI/MCP when mode=remote. */
  remote: GatewayRemoteSchema.optional(),
  tailscale: GatewayTailscaleSchema.optional(),
  tls: GatewayTlsSchema.optional(),
  auth: GatewayAuthSchema.optional(),
  heartbeat: HeartbeatConfigSchema.optional(),
  maxSseConnections: z.number().optional(),
  corsOrigins: z.array(z.string()).optional(),
  /** Dangerous: allow browser Origin to match the HTTP Host header when not in corsOrigins. */
  dangerouslyAllowHostHeaderOriginFallback: z.boolean().optional(),
  /** CIDRs or exact IPs of reverse proxies allowed to terminate auth (trusted-proxy mode). */
  trustedProxies: z.array(z.string()).optional(),
  /** When true, fall back to X-Real-IP if X-Forwarded-For chain parsing fails. Default false (fail closed). */
  allowRealIpFallback: z.boolean().optional(),
  security: GatewaySecuritySchema,
  /**
   * How channel `start()` is split around HTTP listen when using `GatewayServer`.
   * - `auto` (default): defer ids come from channel plugin `meta.deferConnectUntilAfterListen` + enabled config.
   * - `off`: always start all channels in phase1 (troubleshooting / strict ordering).
   * - `explicit`: defer only `channelConnectDeferIds` (empty = defer none).
   */
  channelConnectDeferMode: GatewayChannelConnectDeferModeSchema.optional(),
  /** When `channelConnectDeferMode` is `explicit`, these channel plugin ids are deferred until after listen. */
  channelConnectDeferIds: z.array(z.string().min(1)).max(24).optional(),
  /** Removed from the defer set (applied after `auto` or `explicit` resolution). */
  channelConnectDeferSkipIds: z.array(z.string().min(1)).max(24).optional(),
  /** Default skills marketplace provider id. Built-in: 'store', 'skillhub', 'clawhub'. Extensions may register more. */
  skillsMarketplaceProvider: z.string().optional(),
  /** Base URL for the xopc skills marketplace (public REST API). */
  skillsStoreBaseUrl: z.string().url().optional(),
  /** File sharing configuration (temporary public download links for workspace files). */
  share: z.object({
    enabled: z.boolean().default(true),
    /** Default TTL in ms (default 24h). */
    defaultTtlMs: z.number().min(60_000).max(604_800_000).default(86_400_000),
    /** Maximum TTL in ms (default 7 days). */
    maxTtlMs: z.number().min(60_000).max(2_592_000_000).default(604_800_000),
    /** Maximum concurrent active shares (default 100). */
    maxActiveShares: z.number().min(1).max(10_000).default(100),
    /** Maximum shareable file size in bytes (default 100MB). */
    maxFileSize: z.number().min(1_048_576).max(10_737_418_240).default(104_857_600),
    /** MIME types allowed for inline preview (?inline=1). */
    inlinePreviewMimes: z.array(z.string()).default([
      'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf',
    ]),
  }).optional(),
}).default({
  bind: 'loopback',
  port: 18790,
  auth: {
    mode: 'token',
  },
  heartbeat: {
    enabled: true,
    intervalMs: 1_800_000,
    includeSystemPromptSection: false,
  },
  maxSseConnections: 100,
  corsOrigins: [],
  skillsMarketplaceProvider: 'skillhub',
  skillsStoreBaseUrl: 'https://store.xopc.ai',
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
  order: z
    .array(z.enum(['openai', 'alibaba', 'edge', 'minimax']))
    .default(['openai', 'alibaba', 'minimax', 'edge']),
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

export const TTSSummarizationConfigSchema = z.object({
  enabled: z.boolean().optional(),
  targetLength: z.number().int().min(1).optional(),
  threshold: z.number().int().min(1).optional(),
  model: z.string().optional(),
});

export const TTSConfigSchema = z.object({
  enabled: z.boolean().default(false),
  provider: z.enum(['openai', 'alibaba', 'edge', 'minimax']).default('openai'),
  trigger: z.enum(['off', 'always', 'inbound', 'tagged']).default('always'),
  fallback: TTSFallbackConfigSchema.optional(),
  maxTextLength: z.number().int().min(1).default(512), // Conservative default to accommodate all providers (Alibaba limit is 512)
  timeoutMs: z.number().int().min(1000).max(180000).default(60000),
  summarization: TTSSummarizationConfigSchema.optional(),
  modelOverrides: TTSModelOverridesConfigSchema.optional(),
  alibaba: TTSProviderConfigSchema.optional(),
  openai: TTSProviderConfigSchema.optional(),
  edge: TTSEdgeConfigSchema.optional(),
  minimax: TTSProviderConfigSchema.optional(),
});

// ============================================
// messages.* — delivery / presentation concerns
// ============================================

export const MessagesConfigSchema = z.object({
  /** Voice (text-to-speech) output configuration. */
  tts: TTSConfigSchema.optional(),
}).optional();

export const ToolsMediaAudioConfigSchema = STTConfigSchema;

export const ToolsMediaConfigSchema = z.object({
  /** Audio (speech-to-text) capability provider config. */
  audio: ToolsMediaAudioConfigSchema.optional(),
}).optional();

// ============================================
// Provider Configs (capability providers: image / audio / video)
// ============================================

/**
 * Optional Azure OpenAI overrides used when an OpenAI image-generation
 * request should hit an Azure deployment instead of `api.openai.com`.
 *
 * URL template (when present):
 *   `https://<resource>.openai.azure.com/openai/deployments/<deployment>/images/generations?api-version=<apiVersion>`
 */
export const ProviderAzureConfigSchema = z
  .object({
    /** Azure resource name (subdomain before `.openai.azure.com`). */
    resource: z.string().min(1).optional(),
    /** Azure deployment id (configured per model). */
    deployment: z.string().min(1).optional(),
    /** Azure REST API version, e.g. `2024-08-01-preview`. */
    apiVersion: z.string().min(1).optional(),
  })
  .strict();

/** Per-vendor request overrides applied by the provider HTTP layer. */
export const ProviderRequestOverridesSchema = z
  .object({
    /** Hard cap for a single HTTP call (ms). */
    timeoutMs: z.number().int().positive().optional(),
    /** Extra headers merged into every outbound request. */
    headers: z.record(z.string(), z.string()).optional(),
  })
  .strict();

/**
 * Generic per-vendor provider config — used by image / audio / video
 * capability providers via `cfg.providers.<id>`. Kept loose (`.strict()` but
 * everything optional) so adding a new vendor never requires a config
 * migration.
 */
export const ProviderAuthConfigSchema = z
  .object({
    /** Static API key (api-key / azure-key modes). */
    apiKey: z.string().optional(),
    /** Override the default REST base URL. */
    baseUrl: z.string().url().optional(),
    /** Vendor region (DashScope: `beijing` / `singapore`; AWS: region id). */
    region: z.string().optional(),
    /** Image-only base URL override (DashScope splits image vs LLM). */
    imageBaseUrl: z.string().url().optional(),
    /** Per-vendor request overrides. */
    request: ProviderRequestOverridesSchema.optional(),
    /** Azure OpenAI deployment overrides; only consumed by OpenAI image provider. */
    azure: ProviderAzureConfigSchema.optional(),
  })
  .strict();

export type ProviderAuthConfig = z.infer<typeof ProviderAuthConfigSchema>;

/**
 * `cfg.providers.<id>` is keyed by provider id (`openai`, `dashscope`,
 * `minimax`, `google`, `fal`, …). Every entry is optional and validated by
 * {@link ProviderAuthConfigSchema}.
 */
export const ProvidersConfigSchema = z.record(z.string(), ProviderAuthConfigSchema);

export type ProvidersConfig = z.infer<typeof ProvidersConfigSchema>;

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
// Update Config
// ============================================

export const UpdateAutoConfigSchema = z
  .object({
    /** Enable automatic update installation. Default false. */
    enabled: z.boolean().default(false),
    /** Hours to wait before applying a stable update after first detection. */
    stableDelayHours: z.number().min(0).default(6),
    /** Additional random jitter hours for stable rollout (avoids thundering herd). */
    stableJitterHours: z.number().min(0).default(12),
    /** How often to re-check for beta updates (hours). Min 0.25. */
    betaCheckIntervalHours: z.number().min(0.25).default(1),
  })
  .strict()
  .optional();

/** Persistent `/goal` (Ralph loop) — Hermes-aligned defaults. */
export const GoalsConfigSchema = z
  .object({
    /** Max continuation turns before auto-pause (Hermes default 20). */
    maxTurns: z.number().int().min(1).max(500).default(20),
    /** Optional judge model ref; defaults to `agents.defaults.model`. */
    judgeModelRef: z.string().optional(),
    /**
     * When true (default), first post-turn runs a decomposition judge to build a checklist;
     * subsequent turns evaluate progress per item (Hermes-style). When false, use legacy freeform judge only.
     */
    checklistMode: z.boolean().default(true),
    /** Auto-pause after this many consecutive judge JSON/tool parse failures (Hermes default 3). */
    maxConsecutiveParseFailures: z.number().int().min(1).max(20).default(3),
    /** Judge LLM call timeout in ms (Hermes uses 60s). */
    judgeTimeoutMs: z.number().int().min(5_000).max(120_000).default(60_000),
    /** Max characters of recent transcript JSON passed to the checklist judge as extra context. */
    checklistHistoryChars: z.number().int().min(0).max(100_000).default(24_000),
  })
  .strict();

export type GoalsConfig = z.infer<typeof GoalsConfigSchema>;

export const UpdateConfigSchema = z
  .object({
    /** Check for updates on gateway startup. Default true. */
    checkOnStart: z.boolean().default(true),
    /** Update channel: stable (default), beta, or dev. */
    channel: z.enum(['stable', 'beta', 'dev']).default('stable'),
    /** Automatic update policy. */
    auto: UpdateAutoConfigSchema,
  })
  .strict()
  .optional();

export type UpdateConfig = z.infer<typeof UpdateConfigSchema>;

// ============================================
// MCP (Model Context Protocol)
// ============================================

const McpHttpUrlSchema = z
  .string()
  .url()
  .refine((value) => {
    try {
      const protocol = new URL(value).protocol;
      return protocol === 'http:' || protocol === 'https:';
    } catch {
      return false;
    }
  }, 'MCP server URL must use http or https');

export const McpServerSchema = z
  .object({
    command: z.string().optional(),
    args: z.array(z.string()).optional(),
    env: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
    cwd: z.string().optional(),
    workingDirectory: z.string().optional(),
    url: McpHttpUrlSchema.optional(),
    transport: z.enum(['sse', 'streamable-http']).optional(),
    headers: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
    connectionTimeoutMs: z.number().finite().positive().optional(),
  })
  .catchall(z.unknown())
  .superRefine((value, ctx) => {
    const hasCommand = typeof value.command === 'string' && value.command.trim().length > 0;
    const hasUrl = typeof value.url === 'string' && value.url.trim().length > 0;
    if (hasCommand && hasUrl) {
      ctx.addIssue({
        code: 'custom',
        message: 'MCP server cannot define both command and url',
      });
    }
  });

export const McpConfigSchema = z
  .object({
    servers: z.record(z.string(), McpServerSchema).optional(),
    sessionIdleTtlMs: z.number().finite().min(0).optional(),
  })
  .strict()
  .optional();

export type McpServerConfig = z.infer<typeof McpServerSchema>;
export type McpConfig = z.infer<typeof McpConfigSchema>;

// ============================================
// Root Config
// ============================================

export const ConfigSchema = z.object({
  agents: AgentsConfigSchema,
  bindings: BindingsConfigSchema,
  session: SessionConfigSchema,
  channels: ChannelsConfigSchema,
  gateway: GatewayConfigSchema,
  tunnel: TunnelConfigSchema.optional(),
  workspace: WorkspaceConfigSchema,
  tools: ToolsConfigSchema,
  mcp: McpConfigSchema,
  cron: CronConfigSchema,
  goals: GoalsConfigSchema.optional(),
  extensions: ExtensionsConfigSchema.default({}),
  /** Per-vendor capability provider config (image / audio / video). */
  providers: ProvidersConfigSchema.optional(),
  modelsDev: ModelsDevConfigSchema,
  /** Delivery / presentation concerns (currently `tts`). */
  messages: MessagesConfigSchema,
  update: UpdateConfigSchema,
}).default({
  agents: {
    defaults: {
      workspace: '~/.xopc/workspace',
      model: '', // Empty default - will be resolved dynamically at runtime
      maxTokens: 8192,
      temperature: 0.7,
      maxToolIterations: 20,
      maxRequestsPerTurn: 50,
      maxToolFailuresPerTurn: 3,
      thinkingDefault: 'medium',
      reasoningDefault: 'stream',
      verboseDefault: 'full',
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
      allowFrom: [],
      groupAllowFrom: [],
      debug: false,
      accounts: {
        default: {
          accountId: 'default',
          enabled: true,
          botToken: '',
          allowFrom: [],
          dmPolicy: 'pairing' as const,
          groupPolicy: 'open' as const,
          replyToMode: 'off' as const,
          historyLimit: 50,
          textChunkLimit: 4000,
          streamMode: 'partial' as const,
        },
      },
      dmPolicy: 'pairing' as const,
      groupPolicy: 'open' as const,
      replyToMode: 'off' as const,
      historyLimit: 50,
      textChunkLimit: 4000,
    },
  },
  gateway: {
    bind: 'loopback',
    port: 18790,
    auth: {
      mode: 'token',
    },
    heartbeat: {
      enabled: true,
      intervalMs: 1_800_000,
      includeSystemPromptSection: false,
    },
    maxSseConnections: 100,
    corsOrigins: [],
    skillsMarketplaceProvider: 'skillhub',
    skillsStoreBaseUrl: 'https://store.xopc.ai',
  },
  tools: {
    web: {
      search: {
        maxResults: 5,
        providers: [],
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
  goals: {
    maxTurns: 20,
    checklistMode: true,
    maxConsecutiveParseFailures: 3,
    judgeTimeoutMs: 60_000,
    checklistHistoryChars: 24_000,
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
  // messages.tts / tools.media.audio start undefined; the factory layer fills
  // in provider-level defaults (model/voice) on demand. Fresh configs don't
  // ship with enabled providers so they never make surprise STT/TTS calls.
});

export type Config = z.infer<typeof ConfigSchema>;
export type AgentDefaults = z.infer<typeof AgentDefaultsSchema>;
export type GatewayAuthConfig = z.infer<typeof GatewayAuthSchema>;
export type GatewayTrustedProxyConfig = z.infer<typeof GatewayTrustedProxySchema>;
export type GatewayAuthRateLimitConfig = z.infer<typeof GatewayAuthRateLimitSchema>;
export type GatewayBindMode = z.infer<typeof GatewayBindModeSchema>;
export type STTConfig = z.infer<typeof STTConfigSchema>;
export type TTSConfig = z.infer<typeof TTSConfigSchema>;

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

/**
 * Default agent’s resolved Markdown workspace root (`resolveAgentWorkspaceDir` for the default agent id).
 */
export function getWorkspacePath(config: Config): string {
  return getDefaultWorkspacePath(config);
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
