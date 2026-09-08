import {
  listAgentEntries,
  normalizeAgentId,
  resolveDefaultAgentId,
} from '../../../agent/agent-scope.js';
import {
  buildChannelCatalogForConfig,
  buildChannelCatalogFromSnapshot,
  getChannelSetupStatus,
} from '../../../channels/catalog/channel-catalog-service.js';
import { normalizeConfiguredMcpServers } from '../../../config/mcp-config-normalize.js';
import type { Config } from '../../../config/schema.js';
import {
  GENERIC_MASKED_SECRET,
  maskSecretLength,
} from './mask-secret-length.js';
import { maskTunnelSecretForWeb } from '../../../tunnel/env.js';
import { resolveShareConfig } from '../../../share/share-config.js';
import {
  resolveSessionConfigForWeb,
  resolveUpdateConfigForWeb,
} from '../../../config/web-patch.js';
import { CredentialResolver } from '../../../auth/credentials.js';
import { loadModelsJson, getModelsJsonPath } from '../../../config/models-json.js';
import { getAllProviders, isProviderConfigured } from '../../../providers/index.js';
import { getProviderRegistry } from '../../../providers/plugin-registry.js';
import {
  ContextPlanningConfigSchema,
  KnowledgeMemoryConfigSchema,
  UserModelConfigSchema,
} from '../../../user-context/config.js';
import type { GatewayService } from '../../service.js';
import { safeToolsWebForGet } from '../../config-tools-web.js';
import { buildSafeProvidersConfigForWeb } from './safe-providers-config.js';
import { maskSttConfigForWeb, maskTtsConfigForWeb, maskRealtimeVoiceConfigForWeb } from './safe-voice-config.js';

function readModelsJsonProviderApiKey(providerId: string): string | undefined {
  const { config } = loadModelsJson(getModelsJsonPath());
  const entry = config.providers?.[providerId];
  const key = entry?.apiKey;
  return typeof key === 'string' && key.trim() ? key.trim() : undefined;
}

/** Length-preserving mask for LLM provider keys in GET `/api/config`. */
async function maskLlmProviderApiKeyForWeb(provider: string): Promise<string> {
  const resolver = new CredentialResolver();
  const stored = await resolver.revealGatewayStoredApiKey(provider);
  if (stored) return maskSecretLength(stored);

  const fromModelsJson = readModelsJsonProviderApiKey(provider);
  if (fromModelsJson) return maskSecretLength(fromModelsJson);

  // Extension plugins manage their own auth; don't show a fake gateway key mask.
  if (getProviderRegistry().has(provider)) return '';

  if (await isProviderConfigured(provider)) return GENERIC_MASKED_SECRET;
  return '';
}

/** MCP block for GET/PATCH `/api/config` (authenticated console editing). */
export function buildSafeMcpConfigForWeb(config: Config) {
  const mcp = config.mcp;
  if (!mcp) {
    return { servers: {} as Record<string, Record<string, unknown>> };
  }
  return {
    ...(mcp.sessionIdleTtlMs !== undefined ? { sessionIdleTtlMs: mcp.sessionIdleTtlMs } : {}),
    servers: normalizeConfiguredMcpServers(mcp.servers),
  };
}

export function buildSafeBrowserConfigForWeb(browser: unknown) {
  if (!browser || typeof browser !== 'object') {
    return { enabled: false };
  }

  const raw = browser as Record<string, unknown>;
  const rawDriver = raw.driver && typeof raw.driver === 'object' && !Array.isArray(raw.driver)
    ? raw.driver as Record<string, unknown>
    : undefined;
  const driver = rawDriver ? { ...rawDriver } : undefined;
  if (driver?.kind === 'remote' && typeof driver.apiKey === 'string' && driver.apiKey.trim()) {
    driver.apiKey = maskSecretLength(driver.apiKey);
  }
  return {
    enabled: raw.enabled === true,
    ...(driver ? { driver } : {}),
    ...(raw.observation ? { observation: raw.observation } : {}),
    ...(raw.limits ? { limits: raw.limits } : {}),
    ...(raw.security ? { security: raw.security } : {}),
  };
}

/** Sanitized config snapshot for GET/PATCH `/api/config` (matches persisted `service.currentConfig`). */
export async function buildSafeWebConfigPayload(service: GatewayService, options: { locale?: string } = {}) {
  const config = service.currentConfig;
  const extensionLoader =
    typeof service.getExtensionLoader === 'function' ? service.getExtensionLoader() : undefined;
  const snapshot = extensionLoader?.getManifestSnapshot();
  const catalog = snapshot
    ? buildChannelCatalogFromSnapshot(snapshot, { locale: options.locale })
    : buildChannelCatalogForConfig(config, { locale: options.locale });
  const channelsPayload = Object.fromEntries(
    catalog.entries.map((entry) => {
      const plugin =
        typeof service.getChannelRuntimePlugin === 'function'
          ? service.getChannelRuntimePlugin(entry.id)
          : undefined;
      const channelCfgKey = entry.configPath.startsWith('channels.')
        ? entry.configPath.slice('channels.'.length).split('.')[0] || entry.id
        : entry.id;
      const channelCfg = config.channels?.[channelCfgKey] as Record<string, unknown> | undefined;
      const setupStatus = getChannelSetupStatus(config, entry.id, entry);
      return [
        entry.id,
        {
          enabled: setupStatus.enabled,
          configured: setupStatus.ready,
          setupStatus,
          config: plugin?.configSurface?.buildConfigSurface(config) ?? channelCfg ?? {},
          schema: entry.configSchema,
          uiHints: entry.uiHints,
        },
      ];
    }),
  );
  return {
    agents: {
      defaultId: resolveDefaultAgentId(config),
      list: listAgentEntries(config)
        .filter((e) => e.enabled !== false)
        .map((e) => ({
          id: normalizeAgentId(e.id),
          workspace: e.workspace,
          models: e.models,
          tools: e.tools,
          skills: e.skills,
          workflows: e.workflows,
        })),
      defaults: config.agents.defaults,
    },
    channels: channelsPayload,
    providers: Object.fromEntries(
      await Promise.all(
        getAllProviders().map(async (provider) => [
          provider,
          await maskLlmProviderApiKeyForWeb(provider),
        ]),
      ),
    ),
    /** Masked `cfg.providers` for capability keys (image / STT / etc.). */
    providersConfig: buildSafeProvidersConfigForWeb(config.providers),
    gateway: {
      bind: config.gateway?.bind ?? 'loopback',
      customBindHost: config.gateway?.customBindHost,
      port: config.gateway?.port,
      corsOrigins: Array.isArray(config.gateway?.corsOrigins) ? config.gateway.corsOrigins : [],
      trustedProxies: Array.isArray(config.gateway?.trustedProxies)
        ? config.gateway.trustedProxies
        : [],
      allowRealIpFallback: config.gateway?.allowRealIpFallback === true,
      dangerouslyAllowHostHeaderOriginFallback:
        config.gateway?.dangerouslyAllowHostHeaderOriginFallback === true,
      security: {
        strict: config.gateway?.security?.strict === true,
      },
      auth: {
        mode: config.gateway?.auth?.mode || 'token',
        token: config.gateway?.auth?.token ? maskSecretLength(config.gateway.auth.token) : '',
        password: config.gateway?.auth?.password
          ? maskSecretLength(config.gateway.auth.password)
          : '',
        trustedProxy: config.gateway?.auth?.trustedProxy
          ? {
              userHeader: config.gateway.auth.trustedProxy.userHeader,
              requiredHeaders: config.gateway.auth.trustedProxy.requiredHeaders ?? [],
              allowUsers: config.gateway.auth.trustedProxy.allowUsers ?? [],
              allowLoopback: config.gateway.auth.trustedProxy.allowLoopback === true,
            }
          : undefined,
        rateLimit: {
          enabled: config.gateway?.auth?.rateLimit?.enabled !== false,
          maxAttempts:
            typeof config.gateway?.auth?.rateLimit?.maxAttempts === 'number'
              ? config.gateway.auth.rateLimit.maxAttempts
              : 5,
          windowMs:
            typeof config.gateway?.auth?.rateLimit?.windowMs === 'number'
              ? config.gateway.auth.rateLimit.windowMs
              : 900_000,
          blockDurationMs:
            typeof config.gateway?.auth?.rateLimit?.blockDurationMs === 'number'
              ? config.gateway.auth.rateLimit.blockDurationMs
              : typeof config.gateway?.auth?.rateLimit?.lockoutMs === 'number'
                ? config.gateway.auth.rateLimit.lockoutMs
                : 300_000,
          exemptLoopback: config.gateway?.auth?.rateLimit?.exemptLoopback !== false,
        },
      },
      heartbeat: {
        enabled: config.gateway?.heartbeat?.enabled,
        intervalMs: config.gateway?.heartbeat?.intervalMs,
        includeSystemPromptSection: config.gateway?.heartbeat?.includeSystemPromptSection === true,
        target: config.gateway?.heartbeat?.target,
        targetChatId: config.gateway?.heartbeat?.targetChatId,
        prompt: config.gateway?.heartbeat?.prompt,
        ackMaxChars: config.gateway?.heartbeat?.ackMaxChars,
        isolatedSession: config.gateway?.heartbeat?.isolatedSession,
        activeHours: config.gateway?.heartbeat?.activeHours,
      },
      webchat: {
        activityDetailDefault: config.gateway?.webchat?.activityDetailDefault ?? 'on',
      },
      channelConnectDeferMode: config.gateway?.channelConnectDeferMode ?? 'auto',
      channelConnectDeferIds: Array.isArray(config.gateway?.channelConnectDeferIds)
        ? config.gateway.channelConnectDeferIds
        : [],
      channelConnectDeferSkipIds: Array.isArray(config.gateway?.channelConnectDeferSkipIds)
        ? config.gateway.channelConnectDeferSkipIds
        : [],
      share: resolveShareConfig(config.gateway?.share),
      publicUrl: config.gateway?.publicUrl ?? null,
      skillsMarketplaceProvider: config.gateway?.skillsMarketplaceProvider ?? 'store',
      skillsStoreBaseUrl: config.gateway?.skillsStoreBaseUrl ?? 'https://store.xopc.ai',
    },
    browser: buildSafeBrowserConfigForWeb(config.browser),
    session: resolveSessionConfigForWeb(config),
    userContext: {
      preferences: config.userContext?.preferences ?? { responseLanguage: 'auto' },
      userModel: UserModelConfigSchema.parse(config.userContext?.userModel),
      knowledgeMemory: KnowledgeMemoryConfigSchema.parse(config.userContext?.knowledgeMemory),
      contextPlanning: ContextPlanningConfigSchema.parse(config.userContext?.contextPlanning),
    },
    tui: {
      defaultAgent: config.tui?.defaultAgent ?? 'coder',
    },
    tunnel: {
      enabled: config.tunnel?.enabled === true,
      autoStart: config.tunnel?.autoStart === true,
      brokerUrl: config.tunnel?.brokerUrl ?? 'https://frp.xopc.ai/api',
      registrationSecret: config.tunnel?.registrationSecret
        ? maskTunnelSecretForWeb(config.tunnel.registrationSecret)
        : '',
      consent: config.tunnel?.consent
        ? {
            version: config.tunnel.consent.version,
            acceptedAt: config.tunnel.consent.acceptedAt,
          }
        : undefined,
      transport: { tls: 'broker_terminated' as const },
    },
    update: {
      ...resolveUpdateConfigForWeb(config),
    },
    stt: maskSttConfigForWeb(config.tools?.media?.audio),
    tts: maskTtsConfigForWeb(config.messages?.tts),
    voice: maskRealtimeVoiceConfigForWeb(config.voice),
    tools: safeToolsWebForGet(config),
    bindings: Array.isArray(config.bindings) ? config.bindings : [],
    mcp: buildSafeMcpConfigForWeb(config),
  };
}
