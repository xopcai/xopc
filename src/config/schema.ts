import { z } from 'zod';

import {
  AgentConfigEntrySchema,
  CapabilityPresetSchema,
  DEFAULT_CAPABILITY_PRESET_ID,
} from '../agent-manifest/schema.js';
import { linearizePresetIds } from '../agent-manifest/preset-chain.js';
import { checkCacheDir } from '../browser/cache-dir-policy.js';
import { UserContextConfigSchema } from '../user-context/config.js';
import { DEFAULT_AGENT_MODELS } from './default-model.js';
import { validatePublicUrl } from './public-url.js';

// ============================================
// Agent Configs
// ============================================

/**
 * Agent model ref. Always an object with explicit `primary` and optional
 * `fallbacks` chain. No string-form shorthand — every write site builds the
 * object explicitly so reads never branch on shape.
 */
export const AgentModelRefSchema = z
  .object({
    primary: z.string().min(1),
    fallbacks: z.array(z.string()).optional(),
  })
  .strict();

export type AgentModelConfig = z.infer<typeof AgentModelRefSchema>;

/**
 * Image-generation model ref. {@link AgentModelRefSchema} plus runtime knobs
 * (`timeoutMs`, `autoProviderFallback`) used by the image-generation runtime.
 */
export const AgentImageGenerationModelSchema = z
  .object({
    primary: z.string().min(1),
    fallbacks: z.array(z.string()).optional(),
    /** Hard cap for the whole generation attempt (ms). */
    timeoutMs: z.number().int().positive().optional(),
    /**
     * When all `primary + fallbacks` candidates fail, sweep every other
     * configured provider before giving up.
     */
    autoProviderFallback: z.boolean().optional(),
  })
  .strict();

export type AgentImageGenerationModelConfig = z.infer<typeof AgentImageGenerationModelSchema>;

export const AgentTypedModelRoleSchema = z
  .object({
    description: z.string().max(500).optional(),
    model: z.string().min(1),
    fallbacks: z.array(z.string().min(1)).optional(),
  })
  .strict()
  .superRefine((entry, ctx) => {
    const validateRef = (ref: string) => {
      const trimmed = ref.trim();
      const idx = trimmed.indexOf('/');
      return idx > 0 && idx < trimmed.length - 1;
    };
    if (!validateRef(entry.model)) {
      ctx.addIssue({
        code: 'custom',
        message: `model must be provider/model format (got '${entry.model}')`,
        path: ['model'],
      });
    }
    for (const [index, fallback] of (entry.fallbacks ?? []).entries()) {
      if (!validateRef(fallback)) {
        ctx.addIssue({
          code: 'custom',
          message: `fallback must be provider/model format (got '${fallback}')`,
          path: ['fallbacks', index],
        });
      }
    }
  });

export type AgentTypedModelRole = z.infer<typeof AgentTypedModelRoleSchema>;

const AgentTypedModelRolesSchema = z
  .record(z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/), AgentTypedModelRoleSchema)
  .optional();

export const AgentModelsSchema = z
  .object({
    defaultRole: z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/).optional(),
    roles: AgentTypedModelRolesSchema,
    imageModel: AgentModelRefSchema.optional(),
    imageGenerationModel: AgentImageGenerationModelSchema.optional(),
  })
  .strict()
  .optional();

export type AgentModelsConfig = z.infer<typeof AgentModelsSchema>;

export type AgentTypedModel = AgentTypedModelRole & { id: string };

export const AgentsConfigSchema = z.object({
  /** Default agent id when not specified (routing / session creation). */
  default: z.string().optional(),
  /** Protected global defaults preset applied before each agent's own presets. */
  defaultPreset: z.string().default(DEFAULT_CAPABILITY_PRESET_ID),
  capabilityPresets: z.record(z.string(), CapabilityPresetSchema).default({}),
  list: z.array(AgentConfigEntrySchema).default([]),
}).strict().default({
  default: 'main',
  defaultPreset: DEFAULT_CAPABILITY_PRESET_ID,
  capabilityPresets: {
    [DEFAULT_CAPABILITY_PRESET_ID]: {
      id: DEFAULT_CAPABILITY_PRESET_ID,
      name: 'Global defaults',
      description: 'Default capabilities inherited by every agent.',
      version: 1,
      models: DEFAULT_AGENT_MODELS,
    },
  },
  list: [
    {
      id: 'main',
      enabled: true,
      identity: {
        name: 'Smart Assistant',
        description: 'General-purpose personal assistant.',
        role: 'General assistant',
        language: 'en',
        tone: 'direct',
      },
      responsibilities: {
        primary: ['Help the user complete tasks'],
      },
      workspace: { root: '~/.xopc/workspace/main' },
    },
  ],
});

const BrowserCloudConfigSchema = z
  .object({
    apiKey: z.string().optional(),
    projectId: z.string().optional(),
    region: z.string().optional(),
  })
  .strict()
  .optional();

const BrowserExtensionConfigSchema = z
  .object({
    port: z.number().int().min(1024).max(65535).optional(),
    host: z.string().min(1).optional(),
    connectionTimeout: z.number().int().positive().optional(),
  })
  .strict()
  .optional();

const BrowserCloakConfigSchema = z
  .object({
    keepOpen: z.boolean().optional(),
    temporaryProfile: z.boolean().optional(),
    cacheDir: z.string().optional().superRefine((value, ctx) => {
      const result = checkCacheDir(value);
      if (result.ok === false) {
        ctx.addIssue({ code: 'custom', message: result.message });
      }
    }),
    binaryPath: z.string().optional(),
    timezone: z.string().optional(),
    locale: z.string().optional(),
    webrtcIp: z.string().optional(),
    fingerprintPlatform: z.string().optional(),
    extraArgs: z.array(z.string()).optional(),
  })
  .strict()
  .optional();

export const BrowserConfigSchema = z
  .object({
    enabled: z.boolean().default(true),
    backend: z.enum(['local', 'cdp', 'cloud', 'extension', 'cloakbrowser']).default('extension'),
    headless: z.boolean().optional(),
    allowPrivateUrls: z.boolean().optional(),
    commandTimeout: z.number().int().min(5).max(900).optional(),
    cloudProvider: z.enum(['local', 'browserbase', 'browser-use']).optional(),
    cloud: BrowserCloudConfigSchema,
    cdpUrl: z.string().optional(),
    extension: BrowserExtensionConfigSchema,
    cloakbrowser: BrowserCloakConfigSchema,
    humanize: z.boolean().optional(),
    humanPreset: z.enum(['default', 'careful']).optional(),
    dialogPolicy: z.enum(['must_respond', 'auto_dismiss', 'auto_accept']).optional(),
    dialogTimeoutSeconds: z.number().int().positive().optional(),
  })
  .strict()
  .default({ enabled: true, backend: 'extension' });

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

export const SessionResetModeSchema = z.enum(['daily', 'idle']);

export const SessionResetConfigSchema = z
  .object({
    mode: SessionResetModeSchema.optional(),
    /** Local hour (0–23) for the daily reset boundary. */
    atHour: z.number().int().min(0).max(23).optional(),
    /** Sliding idle window (minutes). When set with daily mode, whichever expires first wins. */
    idleMinutes: z.number().int().min(0).optional(),
  })
  .strict();

export const SessionResetByTypeSchema = z
  .object({
    direct: SessionResetConfigSchema.optional(),
    group: SessionResetConfigSchema.optional(),
    thread: SessionResetConfigSchema.optional(),
  })
  .strict();

export const SessionScopeSchema = z.enum(['per-sender', 'global']);

export const SessionConfigSchema = z
  .object({
    scope: SessionScopeSchema.default('per-sender'),
    mainKey: z.string().default('main'),
    dmScope: SessionDmScopeSchema.default('main'),
    identityLinks: z.record(z.string(), z.array(z.string())).optional(),
    resetTriggers: z.array(z.string()).optional(),
    reset: SessionResetConfigSchema.optional(),
    resetByType: SessionResetByTypeSchema.optional(),
    resetByChannel: z.record(z.string(), SessionResetConfigSchema).optional(),
    storage: SessionStorageConfigSchema.optional(),
  })
  .strict()
  .default({
    scope: 'per-sender',
    mainKey: 'main',
    dmScope: 'main',
  });

/** Channel buckets — shapes validated post-parse by registered channel plugins. */
export const ChannelsConfigSchema = z.record(z.string(), z.unknown()).default({});

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

const RuntimePreferenceSchema = z.enum([
  'managed-only',
  'managed-first',
  'system-first',
  'system-only',
]);

const RuntimeProvisionSchema = z.enum(['eager', 'on-demand', 'disabled']);

const LanguageRuntimeSchema = z.object({
  enabled: z.boolean().default(true),
  version: z.string().min(1).optional(),
  preference: RuntimePreferenceSchema.default('managed-first'),
  provision: RuntimeProvisionSchema.default('on-demand'),
});

const DEFAULT_RUNTIME_TOOLS_CONFIG = {
  enabled: true,
  node: {
    enabled: true,
    preference: 'managed-first' as const,
    provision: 'eager' as const,
  },
  python: {
    enabled: true,
    preference: 'managed-first' as const,
    provision: 'on-demand' as const,
  },
  uv: { enabled: true },
  download: {
    source: 'auto' as const,
    gatewayBaseUrl: 'https://xopc.ai/api/runtime/v1',
    timeoutMs: 600_000,
  },
  retention: { keepVersions: 2 },
};

export const RuntimeToolsConfigSchema = z.object({
  enabled: z.boolean().default(true),
  node: LanguageRuntimeSchema.default({
    enabled: true,
    preference: 'managed-first',
    provision: 'eager',
  }),
  python: LanguageRuntimeSchema.default({
    enabled: true,
    preference: 'managed-first',
    provision: 'on-demand',
  }),
  uv: z.object({
    enabled: z.boolean().default(true),
    version: z.string().min(1).optional(),
  }).default({ enabled: true }),
  download: z.object({
    bundleDir: z.string().min(1).optional(),
    proxy: z.string().url().optional(),
    source: z.enum(['auto', 'website-only', 'direct-only']).default('auto'),
    gatewayBaseUrl: z.string().url().default('https://xopc.ai/api/runtime/v1'),
    timeoutMs: z.number().int().min(10_000).max(1_800_000).default(600_000),
  }).strict().default({
    source: 'auto',
    gatewayBaseUrl: 'https://xopc.ai/api/runtime/v1',
    timeoutMs: 600_000,
  }),
  retention: z.object({
    keepVersions: z.number().int().min(1).max(5).default(2),
    maxCacheBytes: z.number().int().positive().optional(),
  }).default({ keepVersions: 2 }),
}).default(DEFAULT_RUNTIME_TOOLS_CONFIG);

export type RuntimeToolsConfig = z.infer<typeof RuntimeToolsConfigSchema>;

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
    /** Skip rate limiting for loopback client IPs (default true). Remote browser Origin requests never exempt. */
    exemptLoopback: z.boolean().default(true),
    /**
     * Coalesce same-client failures arriving within this window into a single
     * attempt. Absorbs SPA fan-out / SDK auto-retry storms without weakening
     * brute-force protection (deliberate attackers are still rate-limited to
     * one effective attempt per window). Set to 0 to disable.
     */
    burstCoalesceMs: z.number().int().min(0).default(1000),
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

export const TunnelConfigSchema = z
  .object({
    enabled: z.boolean().default(false),
    brokerUrl: z.string().url().default('https://frp.xopc.ai/api'),
    /** Broker register API secret. */
    registrationSecret: z.string().min(1).optional(),
    autoStart: z.boolean().default(false),
    subdomain: z.string().optional(),
    consent: TunnelConsentSchema.optional(),
  })
  .default({
    enabled: false,
    brokerUrl: 'https://frp.xopc.ai/api',
    autoStart: false,
  });

export type TunnelConfig = z.infer<typeof TunnelConfigSchema>;

/**
 * Workspace-scoped concerns (file import, etc.). Distinct from
 * agent manifest workspace roots; this block carries
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

export const GatewayWebchatConfigSchema = z.object({
  /** Default visibility of AI execution activity in the Web UI. */
  activityDetailDefault: z.enum(['off', 'on', 'stream']).default('on'),
}).default({
  activityDetailDefault: 'on',
});

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
  webchat: GatewayWebchatConfigSchema.optional(),
  corsOrigins: z.array(z.string()).optional(),
  /**
   * Reverse-proxy publicly reachable URL (e.g. `https://gateway.example.com`).
   * Optional. When set, mobile pairing surfaces this URL as the preferred
   * baseUrl and it is auto-added to the browser CORS/CSRF allowlist.
   * - Must be a URL with no path / query / userinfo.
   * - Must use `https:` for public hosts; `http:` is only allowed when the
   *   hostname is in an RFC1918 / `.local` private range.
   */
  publicUrl: z
    .string()
    .superRefine((value, ctx) => {
      const result = validatePublicUrl(value);
      if (result.ok === false) {
        ctx.addIssue({ code: 'custom', message: `gateway.publicUrl: ${result.message}` });
      }
    })
    .optional(),
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
    /** Maximum TTL in ms (default 30 days). */
    maxTtlMs: z.number().min(60_000).max(2_592_000_000).default(2_592_000_000),
    /** Maximum concurrent active shares (default 500). */
    maxActiveShares: z.number().min(1).max(10_000).default(500),
    /** Maximum shareable file size in bytes (default 500 MB). */
    maxFileSize: z.number().min(1_048_576).max(10_737_418_240).default(524_288_000),
    /** MIME types allowed for inline preview (?inline=1). */
    inlinePreviewMimes: z.array(z.string()).default([
      'image/png',
      'image/jpeg',
      'image/gif',
      'image/webp',
      'image/svg+xml',
      'application/pdf',
      'text/html',
      'text/markdown',
      'text/plain',
      'application/json',
    ]),
    /** Folder-sharing controls (browse + ZIP). */
    directory: z.object({
      enabled: z.boolean().default(true),
      /** Maximum folder size in bytes at scan time (default 2 GB). */
      maxFolderSize: z.number().int().min(1_048_576).max(10_737_418_240).default(2_147_483_648),
      /** Maximum number of entries scanned for a single folder share. */
      maxFileCount: z.number().int().min(1).max(100_000).default(10_000),
      /** Traversal depth cap (defense against recursive symlinks). */
      maxDepth: z.number().int().min(1).max(64).default(20),
      /** In-memory directory listing cache TTL. */
      listingCacheMs: z.number().int().min(0).max(600_000).default(60_000),
      /** Maximum simultaneous ZIP streams per share token. */
      zipConcurrency: z.number().int().min(1).max(8).default(1),
    }).default({
      enabled: true,
      maxFolderSize: 2_147_483_648,
      maxFileCount: 10_000,
      maxDepth: 20,
      listingCacheMs: 60_000,
      zipConcurrency: 1,
    }),
    /** Note snapshot-sharing controls. */
    note: z.object({
      enabled: z.boolean().default(true),
      maxMarkdownBytes: z.number().int().min(1_024).max(10_485_760).default(2_097_152),
      maxAttachmentCount: z.number().int().min(0).max(500).default(50),
      maxAttachmentSize: z.number().int().min(1_024).max(1_073_741_824).default(104_857_600),
      maxTotalSize: z.number().int().min(1_024).max(2_147_483_648).default(262_144_000),
      assetTicketTtlMs: z.number().int().min(60_000).max(3_600_000).default(600_000),
      revokeOnSourceDelete: z.boolean().default(true),
    }).default({
      enabled: true,
      maxMarkdownBytes: 2_097_152,
      maxAttachmentCount: 50,
      maxAttachmentSize: 104_857_600,
      maxTotalSize: 262_144_000,
      assetTicketTtlMs: 600_000,
      revokeOnSourceDelete: true,
    }),
  }).optional(),
  /** Site-share configuration (static directory or reverse-proxy a local dev server). */
  siteShare: z.object({
    enabled: z.boolean().default(true),
    /** Public host suffix that subdomain shares are served under. */
    publicHostSuffix: z.string().min(1).default('share.xopc.ai'),
    /** Default TTL in ms (default 24h). */
    defaultTtlMs: z.number().int().min(60_000).max(604_800_000).default(86_400_000),
    /** Maximum TTL in ms (default 30 days). */
    maxTtlMs: z.number().int().min(60_000).max(2_592_000_000).default(2_592_000_000),
    /** Maximum concurrent active site shares (default 50). */
    maxActiveSites: z.number().int().min(1).max(1_000).default(50),
    static: z.object({
      enabled: z.boolean().default(true),
      /** Maximum total bytes of files served per static site. */
      maxRootDirSize: z.number().int().min(1_048_576).max(10_737_418_240).default(1_073_741_824),
      /** Maximum file count under root dir. */
      maxFileCount: z.number().int().min(1).max(100_000).default(20_000),
      /** Whether HTML/CSS rewrite of absolute paths is on by default. */
      rewriteEnabledByDefault: z.boolean().default(false),
    }).default({
      enabled: true,
      maxRootDirSize: 1_073_741_824,
      maxFileCount: 20_000,
      rewriteEnabledByDefault: false,
    }),
    proxy: z.object({
      /** Reverse-proxy mode default-enabled per the product brief. */
      enabled: z.boolean().default(true),
      /** Upstream host whitelist. Loopback by default. */
      allowedUpstreamHosts: z
        .array(z.string().min(1))
        .default(['127.0.0.1', 'localhost', '::1']),
      /** Upstream port whitelist (common dev-server ports). */
      allowedUpstreamPorts: z
        .array(z.number().int().min(1).max(65535))
        .default([3000, 3001, 4321, 5173, 8000, 8080, 8888, 9000]),
      /** Whether to forward WebSocket upgrades. */
      forwardWebSocket: z.boolean().default(true),
      /** Maximum request body size in bytes (50 MB). */
      bodySizeLimit: z.number().int().min(0).max(1_073_741_824).default(52_428_800),
      /** Per-request HTTP timeout in ms. */
      requestTimeoutMs: z.number().int().min(1_000).max(600_000).default(30_000),
      /** Per-WebSocket idle timeout in ms. */
      wsIdleTimeoutMs: z.number().int().min(10_000).max(3_600_000).default(300_000),
      /** Rewrite Set-Cookie Path attribute (subpath mode only). */
      rewriteSetCookiePath: z.boolean().default(true),
    }).default({
      enabled: true,
      allowedUpstreamHosts: ['127.0.0.1', 'localhost', '::1'],
      allowedUpstreamPorts: [3000, 3001, 4321, 5173, 8000, 8080, 8888, 9000],
      forwardWebSocket: true,
      bodySizeLimit: 52_428_800,
      requestTimeoutMs: 30_000,
      wsIdleTimeoutMs: 300_000,
      rewriteSetCookiePath: true,
    }),
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
  webchat: {
    activityDetailDefault: 'on',
  },
  corsOrigins: [],
  skillsMarketplaceProvider: 'store',
  skillsStoreBaseUrl: 'https://store.xopc.ai',
});

export const ModelsDevConfigSchema = z.object({
  enabled: z.boolean().default(true),
}).default({
  enabled: true,
});

export const ModelCatalogConfigSchema = z.object({
  enabled: z.boolean().default(true),
  refreshOnStartup: z.boolean().default(true),
  intervalHours: z.number().min(0.25).default(6),
}).strict().default({
  enabled: true,
  refreshOnStartup: true,
  intervalHours: 6,
});

// ============================================
// STT (Speech-to-Text) Config
// ============================================

const SttProviderConfigCatchallSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.array(z.unknown()),
  z.record(z.string(), z.unknown()),
]);

export const STTProviderConfigSchema = z
  .object({
    apiKey: z.string().optional(),
    model: z.string().optional(),
    baseUrl: z.string().optional(),
    headers: z.record(z.string(), z.string()).optional(),
    language: z.string().optional(),
    prompt: z.string().optional(),
  })
  .catchall(SttProviderConfigCatchallSchema);

export const STTFallbackConfigSchema = z.object({
  enabled: z.boolean().default(false),
  order: z.array(z.string().min(1)).default(['xopc-local']),
});

export const MediaUnderstandingCapabilitiesSchema = z
  .array(z.enum(['image', 'audio', 'video']))
  .optional();

export const MediaUnderstandingModelSchema = z
  .object({
    provider: z.string().optional(),
    model: z.string().optional(),
    capabilities: MediaUnderstandingCapabilitiesSchema,
    type: z.union([z.literal('provider'), z.literal('cli')]).optional(),
    command: z.string().optional(),
    baseUrl: z.string().optional(),
    headers: z.record(z.string(), z.string()).optional(),
    apiKey: z.string().optional(),
    language: z.string().optional(),
    prompt: z.string().optional(),
  })
  .catchall(SttProviderConfigCatchallSchema);

export const STTConfigSchema = z
  .object({
    enabled: z.boolean().default(true),
    /** Primary provider id — any registered MediaUnderstandingProvider id. */
    provider: z.string().min(1).default('xopc-local'),
    fallback: STTFallbackConfigSchema.default({ enabled: false, order: ['xopc-local'] }),
    timeoutMs: z.number().int().min(1000).max(180000).optional(),
    /** Ordered model entries for this capability (OpenClaw `tools.media.audio.models`). */
    models: z.array(MediaUnderstandingModelSchema).optional(),
    /** Provider settings map keyed by provider id. */
    providers: z.record(z.string(), STTProviderConfigSchema).optional(),
  })
  .strict();

// ============================================
// TTS (Text-to-Speech) Config
// ============================================

const TtsProviderConfigCatchallSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.array(z.unknown()),
  z.record(z.string(), z.unknown()),
]);

export const TTSProviderConfigSchema = z
  .object({
    apiKey: z.string().optional(),
    model: z.string().optional(),
    voice: z.string().optional(),
  })
  .catchall(TtsProviderConfigCatchallSchema);

export const TTSFallbackConfigSchema = z.object({
  enabled: z.boolean().default(true),
  order: z
    .array(z.string().min(1))
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

export const TTSConfigSchema = z
  .object({
    enabled: z.boolean().default(true),
    /** Primary provider id — any registered SpeechProviderPlugin id. */
    provider: z.string().min(1).default('edge'),
    trigger: z.enum(['off', 'always', 'inbound', 'tagged']).default('off'),
    fallback: TTSFallbackConfigSchema.optional(),
    maxTextLength: z.number().int().min(1).default(512), // Conservative default to accommodate all providers (Alibaba limit is 512)
    timeoutMs: z.number().int().min(1000).max(180000).default(60000),
    summarization: TTSSummarizationConfigSchema.optional(),
    modelOverrides: TTSModelOverridesConfigSchema.optional(),
    /** Provider settings map keyed by provider id. */
    providers: z.record(z.string(), TTSProviderConfigSchema).optional(),
  })
  .strict();

export const VoiceRefinementConfigSchema = z
  .object({
    mode: z.enum(['off', 'punctuation', 'light', 'custom']).default('off'),
    /** Optional provider/model reference used only when refinement is enabled. */
    model: z.string().min(1).optional(),
    customInstruction: z.string().max(4000).optional(),
  })
  .strict();

export const VoiceConfigSchema = z
  .object({
    languageMode: z.enum(['auto', 'manual']).optional(),
    language: z.enum(['en', 'zh']).optional(),
    input: z
      .object({
        refinement: VoiceRefinementConfigSchema.optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .optional();

// ============================================
// messages.* — delivery / presentation concerns
// ============================================

export const MessagesConfigSchema = z.object({
  /** Voice (text-to-speech) output configuration. */
  tts: TTSConfigSchema.optional(),
}).optional();

export const ToolsMediaAudioConfigSchema = STTConfigSchema;

export const ToolsMediaConfigSchema = z
  .object({
    /** Shared model entries applied across media capabilities when entry lacks capabilities. */
    models: z.array(MediaUnderstandingModelSchema).optional(),
    /** Audio (speech-to-text) capability provider config. */
    audio: ToolsMediaAudioConfigSchema.optional(),
  })
  .optional();

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
 * capability providers via `cfg.providers.<id>`.
 */
export const ProviderAuthConfigSchema = z
  .object({
    /** Override the default REST base URL. */
    baseUrl: z.string().url().optional(),
    /** Provider deployment region. */
    region: z.enum(['cn', 'intl']).optional(),
    /** Per-vendor request overrides. */
    request: ProviderRequestOverridesSchema.optional(),
    /** Azure OpenAI deployment overrides; only consumed by OpenAI image provider. */
    azure: ProviderAzureConfigSchema.optional(),
  })
  .strict();

export type ProviderAuthConfig = z.infer<typeof ProviderAuthConfigSchema>;

/**
 * `cfg.providers.<id>` stores non-secret connection settings. Credentials
 * live in the credential store or environment. Every entry is validated by
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

export const CommandsConfigSchema = z
  .object({
    restart: z.boolean().optional(),
  })
  .strict()
  .optional();

export type CommandsConfig = z.infer<typeof CommandsConfigSchema>;

export const TuiConfigSchema = z
  .object({
    /** Default agent id for fresh TUI sessions. Leaves global routing (`agents.default`) untouched. */
    defaultAgent: z.string().min(1).optional(),
  })
  .strict()
  .default({});

export type TuiConfig = z.infer<typeof TuiConfigSchema>;

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

const ConnectorSecretReferenceSchema = z.object({
  xopcSecretRef: z.object({
    provider: z.string().min(1),
    fieldKey: z.string().min(1),
  }),
});

const McpConfigScalarSchema = z.union([z.string(), z.number(), z.boolean(), ConnectorSecretReferenceSchema]);

export const McpOAuthConfigSchema = z
  .object({
    type: z.literal('oauth'),
    /** Optional public client id for authorization servers without dynamic registration. */
    clientId: z.string().min(1).optional(),
  })
  .strict();

export const McpServerSchema = z
  .object({
    command: z.string().optional(),
    args: z.array(z.string()).optional(),
    env: z.record(z.string(), McpConfigScalarSchema).optional(),
    cwd: z.string().optional(),
    workingDirectory: z.string().optional(),
    url: McpHttpUrlSchema.optional(),
    transport: z.enum(['sse', 'streamable-http']).optional(),
    headers: z.record(z.string(), McpConfigScalarSchema).optional(),
    auth: McpOAuthConfigSchema.optional(),
    connectionTimeoutMs: z.number().finite().positive().optional(),
    requestTimeoutMs: z.number().finite().positive().optional(),
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
    if (value.auth && !hasUrl) {
      ctx.addIssue({
        code: 'custom',
        path: ['auth'],
        message: 'MCP OAuth requires an HTTP server URL',
      });
    }
    if (value.auth && value.transport === 'sse') {
      ctx.addIssue({
        code: 'custom',
        path: ['auth'],
        message: 'MCP OAuth currently supports streamable HTTP only',
      });
    }
    if (value.auth && value.headers) {
      const authorizationHeader = Object.keys(value.headers).find(
        (key) => key.toLowerCase() === 'authorization',
      );
      if (authorizationHeader) {
        ctx.addIssue({
          code: 'custom',
          path: ['headers', authorizationHeader],
          message: 'MCP OAuth cannot be combined with a static Authorization header',
        });
      }
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
export type McpOAuthConfig = z.infer<typeof McpOAuthConfigSchema>;
export type McpConfig = z.infer<typeof McpConfigSchema>;

export const ConnectorsConfigSchema = z
  .object({
    instances: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
  })
  .strict()
  .optional();

export type ConnectorsConfig = z.infer<typeof ConnectorsConfigSchema>;

export const ExperimentalConfigSchema = z
  .object({
    /** First-run activation that analyzes one explicitly selected local folder. */
    workDiscoveryOnboarding: z.boolean().default(true),
  })
  .strict()
  .default({ workDiscoveryOnboarding: true });

export type ExperimentalConfig = z.infer<typeof ExperimentalConfigSchema>;

// ============================================
// Root Config
// ============================================

export const ConfigSchema = z.object({
  userContext: UserContextConfigSchema,
  agents: AgentsConfigSchema,
  bindings: BindingsConfigSchema,
  session: SessionConfigSchema,
  channels: ChannelsConfigSchema,
  gateway: GatewayConfigSchema,
  browser: BrowserConfigSchema,
  tunnel: TunnelConfigSchema.optional(),
  workspace: WorkspaceConfigSchema,
  tools: ToolsConfigSchema,
  runtimeTools: RuntimeToolsConfigSchema,
  mcp: McpConfigSchema,
  connectors: ConnectorsConfigSchema,
  experimental: ExperimentalConfigSchema,
  extensions: ExtensionsConfigSchema.default({}),
  /** Per-vendor capability provider config (image / audio / video). */
  providers: ProvidersConfigSchema.optional(),
  modelsDev: ModelsDevConfigSchema,
  modelCatalog: ModelCatalogConfigSchema,
  /** Delivery / presentation concerns (currently `tts`). */
  messages: MessagesConfigSchema,
  /** User-facing voice input behavior beyond provider selection. */
  voice: VoiceConfigSchema,
  update: UpdateConfigSchema,
  commands: CommandsConfigSchema,
  tui: TuiConfigSchema,
}).strict().default({
  userContext: {
    enabled: true,
    preferences: { responseLanguage: 'auto' },
    memory: {
      mode: 'confirmWrite',
      sources: ['session', 'understanding'],
      writePolicy: { understanding: 'confirm' },
    },
    understanding: {
      enabled: true,
      adaptiveCadence: true,
      reviewIntervalTurns: 10,
      maxHistoryMessages: 80,
      maxDurationMs: 120_000,
    },
    privacy: { sensitiveWritePolicy: 'confirm' },
    providerRouting: {
      searchStrategy: 'fanout',
      writeStrategy: 'local-first',
      allowExternalWrites: false,
    },
    dreaming: { mode: 'review', schedule: { time: '03:00' }, minEvidenceSources: 2, limit: 500 },
  },
  agents: {
    default: 'main',
    defaultPreset: DEFAULT_CAPABILITY_PRESET_ID,
    capabilityPresets: {
      [DEFAULT_CAPABILITY_PRESET_ID]: {
        id: DEFAULT_CAPABILITY_PRESET_ID,
        name: 'Global defaults',
        description: 'Default capabilities inherited by every agent.',
        version: 1,
        models: DEFAULT_AGENT_MODELS,
      },
    },
    list: [
      {
        id: 'main',
        enabled: true,
        identity: {
          name: 'Smart Assistant',
          description: 'General-purpose personal assistant.',
          role: 'General assistant',
          language: 'en',
          tone: 'direct',
        },
        responsibilities: {
          primary: ['Help the user complete tasks'],
        },
        workspace: { root: '~/.xopc/workspace/main' },
      },
    ],
  },
  bindings: [],
  session: {
    scope: 'per-sender' as const,
    mainKey: 'main',
    dmScope: 'main' as const,
  },
  channels: {
    telegram: {
      enabled: false,
      debug: false,
      defaults: {
        dmPolicy: 'pairing' as const,
        groupPolicy: 'open' as const,
        replyToMode: 'off' as const,
        historyLimit: 50,
        textChunkLimit: 4000,
        streaming: { mode: 'partial' as const },
      },
      accounts: {
        default: {
          accountId: 'default',
          enabled: true,
          botToken: '',
          allowFrom: [],
          groupAllowFrom: [],
        },
      },
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
    webchat: {
      activityDetailDefault: 'on' as const,
    },
    corsOrigins: [],
    skillsMarketplaceProvider: 'store',
    skillsStoreBaseUrl: 'https://store.xopc.ai',
  },
  browser: {
    enabled: true,
    backend: 'extension' as const,
  },
  tools: {
    web: {
      search: {
        maxResults: 5,
        providers: [],
      },
    },
  },
  runtimeTools: DEFAULT_RUNTIME_TOOLS_CONFIG,
  experimental: {
    workDiscoveryOnboarding: true,
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
  modelCatalog: {
    enabled: true,
    refreshOnStartup: true,
    intervalHours: 6,
  },
  tui: {},
  // messages.tts / tools.media.audio start undefined; the factory layer fills
  // in provider-level defaults (model/voice) on demand. Fresh configs don't
  // ship with enabled providers so they never make surprise STT/TTS calls.
});

export type Config = z.infer<typeof ConfigSchema>;
export type GatewayAuthConfig = z.infer<typeof GatewayAuthSchema>;
export type GatewayTrustedProxyConfig = z.infer<typeof GatewayTrustedProxySchema>;
export type GatewayAuthRateLimitConfig = z.infer<typeof GatewayAuthRateLimitSchema>;
export type GatewayBindMode = z.infer<typeof GatewayBindModeSchema>;
export type STTConfig = z.infer<typeof STTConfigSchema>;
export type TTSConfig = z.infer<typeof TTSConfigSchema>;
export type VoiceConfig = z.infer<typeof VoiceConfigSchema>;

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

export function getAgentDefaultModelRef(config: Config): string | undefined {
  const list = Array.isArray(config.agents?.list) ? config.agents.list : [];
  const defaultId =
    config.agents?.default?.trim() ||
    list.find((entry) => (entry as { default?: boolean }).default === true)?.id?.trim() ||
    list[0]?.id;
  const agent = list.find((entry) => entry.enabled !== false && entry.id === defaultId) ?? list[0];
  if (!agent) return undefined;

  let modelRef: string | undefined;
  const applyModels = (models: AgentModelsConfig | undefined): void => {
    const roles = models?.roles ?? {};
    const defaultRole = models?.defaultRole ?? Object.keys(roles)[0];
    const role = defaultRole ? roles[defaultRole] : undefined;
    const next = role?.model.trim();
    if (next) modelRef = next;
  };
  const rootPresetIds = [
    ...(config.agents.capabilityPresets[config.agents.defaultPreset] ? [config.agents.defaultPreset] : []),
    ...(agent.extends ?? []).filter((id) => id !== config.agents.defaultPreset),
  ];
  for (const presetId of linearizePresetIds(rootPresetIds, config.agents.capabilityPresets)) {
    applyModels(config.agents.capabilityPresets[presetId]?.models);
  }
  applyModels(agent.models);
  return modelRef;
}

function getAgentDefaultModelsConfig(config: Config, requestedAgentId?: string): AgentModelsConfig | undefined {
  const list = Array.isArray(config.agents?.list) ? config.agents.list : [];
  const defaultId =
    requestedAgentId?.trim() ||
    config.agents?.default?.trim() ||
    list.find((entry) => (entry as { default?: boolean }).default === true)?.id?.trim() ||
    list[0]?.id;
  const agent = list.find((entry) => entry.enabled !== false && entry.id === defaultId) ?? list[0];
  if (!agent) return undefined;

  let modelConfig: AgentModelsConfig | undefined;
  const applyModels = (models: AgentModelsConfig | undefined): void => {
    if (!models) return;
    modelConfig = {
      ...modelConfig,
      ...models,
      roles: {
        ...(modelConfig?.roles ?? {}),
        ...(models.roles ?? {}),
      },
    };
  };
  const rootPresetIds = [
    ...(config.agents.capabilityPresets[config.agents.defaultPreset] ? [config.agents.defaultPreset] : []),
    ...(agent.extends ?? []).filter((id) => id !== config.agents.defaultPreset),
  ];
  for (const presetId of linearizePresetIds(rootPresetIds, config.agents.capabilityPresets)) {
    applyModels(config.agents.capabilityPresets[presetId]?.models);
  }
  applyModels(agent.models);
  return modelConfig;
}

export function getAgentDefaultImageModelConfig(config: Config): AgentModelConfig | undefined {
  return getAgentDefaultModelsConfig(config)?.imageModel;
}

export function getAgentDefaultImageGenerationModelConfig(
  config: Config,
  agentId: string,
): AgentImageGenerationModelConfig | undefined {
  return getAgentDefaultModelsConfig(config, agentId)?.imageGenerationModel;
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
