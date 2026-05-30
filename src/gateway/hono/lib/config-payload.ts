import {
  listAgentEntries,
  normalizeAgentId,
  resolveDefaultAgentId,
} from '../../../agent/agent-scope.js';
import {
  listChannelPlugins,
  syncChannelPluginsFromManager,
} from '../../../channels/plugins/registry.js';
import { normalizeConfiguredMcpServers } from '../../../config/mcp-config-normalize.js';
import type { Config } from '../../../config/schema.js';
import { maskTunnelSecretForWeb } from '../../../tunnel/env.js';
import { resolveShareConfig } from '../../../share/share-config.js';
import {
  resolveCronConfigForWeb,
  resolveGoalsConfigForWeb,
  resolveSessionConfigForWeb,
  resolveUpdateConfigForWeb,
} from '../../../config/web-patch.js';
import { bundledChannelPlugins } from '../../../generated/bundled-channel-plugins.js';
import { getAllProviders, isProviderConfigured } from '../../../providers/index.js';
import type { GatewayService } from '../../service.js';
import { safeToolsWebForGet } from '../../config-tools-web.js';
import {
  agentImageGenerationModelAutoProviderFallback,
  agentImageGenerationModelTimeoutMs,
  agentModelFallbacksToArray,
  agentModelRefToString,
} from './agent-model.js';
import { buildSafeProvidersConfigForWeb } from './safe-providers-config.js';
import { maskSttConfigForWeb, maskTtsConfigForWeb } from './safe-voice-config.js';

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

function maskBrowserCloudConfigForWeb(cloud: unknown): Record<string, unknown> | null {
  if (!cloud || typeof cloud !== 'object' || Array.isArray(cloud)) {
    return null;
  }
  const raw = cloud as Record<string, unknown>;
  const safe: Record<string, unknown> = {};
  if (typeof raw.apiKey === 'string' && raw.apiKey.trim()) {
    safe.apiKey = '***';
  }
  if (typeof raw.projectId === 'string' && raw.projectId.trim()) {
    safe.projectId = raw.projectId.trim();
  }
  if (typeof raw.region === 'string' && raw.region.trim()) {
    safe.region = raw.region.trim();
  }
  return Object.keys(safe).length > 0 ? safe : null;
}

export function buildSafeBrowserConfigForWeb(browser: Config['agents']['defaults']['browser'] | undefined) {
  if (!browser || typeof browser !== 'object') {
    return {
      enabled: false,
      headless: false,
      allowPrivateUrls: false,
      commandTimeout: null,
      backend: null,
      cloudProvider: null,
      cloud: null,
      cdpUrl: null,
      extension: null,
      cloakbrowser: null,
      humanize: null,
      humanPreset: null,
      dialogPolicy: null,
      dialogTimeoutSeconds: null,
    };
  }

  return {
    enabled: browser.enabled === true,
    headless: browser.headless === true,
    allowPrivateUrls: browser.allowPrivateUrls === true,
    commandTimeout:
      typeof browser.commandTimeout === 'number' && Number.isFinite(browser.commandTimeout)
        ? Math.floor(browser.commandTimeout)
        : null,
    backend:
      browser.backend === 'cdp' ||
      browser.backend === 'cloud' ||
      browser.backend === 'extension' ||
      browser.backend === 'cloakbrowser'
        ? browser.backend
        : null,
    cloudProvider:
      browser.cloudProvider === 'browserbase' || browser.cloudProvider === 'browser-use'
        ? browser.cloudProvider
        : null,
    cloud: maskBrowserCloudConfigForWeb(browser.cloud),
    cdpUrl: typeof browser.cdpUrl === 'string' && browser.cdpUrl.trim() ? browser.cdpUrl.trim() : null,
    extension: browser.extension && typeof browser.extension === 'object' && !Array.isArray(browser.extension)
      ? browser.extension
      : null,
    cloakbrowser:
      browser.cloakbrowser && typeof browser.cloakbrowser === 'object' && !Array.isArray(browser.cloakbrowser)
        ? browser.cloakbrowser
        : null,
    humanize: typeof browser.humanize === 'boolean' ? browser.humanize : null,
    humanPreset: browser.humanPreset === 'default' || browser.humanPreset === 'careful' ? browser.humanPreset : null,
    dialogPolicy:
      browser.dialogPolicy === 'must_respond' ||
      browser.dialogPolicy === 'auto_accept' ||
      browser.dialogPolicy === 'auto_dismiss'
        ? browser.dialogPolicy
        : null,
    dialogTimeoutSeconds:
      typeof browser.dialogTimeoutSeconds === 'number' && Number.isFinite(browser.dialogTimeoutSeconds)
        ? Math.floor(browser.dialogTimeoutSeconds)
        : null,
  };
}

/** Sanitized config snapshot for GET/PATCH `/api/config` (matches persisted `service.currentConfig`). */
export async function buildSafeWebConfigPayload(service: GatewayService) {
  const config = service.currentConfig;
  if (listChannelPlugins().length === 0) {
    syncChannelPluginsFromManager(bundledChannelPlugins);
  }
  const channelsPayload = Object.fromEntries(
    listChannelPlugins().map((plugin) => {
      if (plugin.configSurface) {
        return [plugin.id, plugin.configSurface.buildConfigSurface(config)];
      }
      const channelCfg = config.channels?.[plugin.id] as Record<string, unknown> | undefined;
      return [
        plugin.id,
        {
          enabled: channelCfg?.enabled ?? false,
          configured: plugin.config.listAccountIds(config).length > 0,
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
          ...(typeof e.name === 'string' && e.name.trim() ? { name: e.name.trim() } : {}),
        })),
      defaults: {
        model: agentModelRefToString(config.agents?.defaults?.model) ?? '',
        modelFallbacks: agentModelFallbacksToArray(config.agents?.defaults?.model),
        imageModel: agentModelRefToString(config.agents?.defaults?.imageModel) ?? null,
        imageModelFallbacks: agentModelFallbacksToArray(config.agents?.defaults?.imageModel),
        imageGenerationModel: agentModelRefToString(config.agents?.defaults?.imageGenerationModel) ?? null,
        imageGenerationModelFallbacks: agentModelFallbacksToArray(
          config.agents?.defaults?.imageGenerationModel,
        ),
        imageGenerationModelTimeoutMs: agentImageGenerationModelTimeoutMs(
          config.agents?.defaults?.imageGenerationModel,
        ),
        imageGenerationModelAutoProviderFallback: agentImageGenerationModelAutoProviderFallback(
          config.agents?.defaults?.imageGenerationModel,
        ),
        mediaMaxMb: config.agents?.defaults?.mediaMaxMb,
        maxTokens: config.agents?.defaults?.maxTokens,
        temperature: config.agents?.defaults?.temperature,
        maxToolIterations: config.agents?.defaults?.maxToolIterations,
        workspace: config.agents?.defaults?.workspace,
        thinkingDefault: config.agents?.defaults?.thinkingDefault,
        reasoningDefault: config.agents?.defaults?.reasoningDefault,
        verboseDefault: config.agents?.defaults?.verboseDefault,
        browser: buildSafeBrowserConfigForWeb(config.agents?.defaults?.browser),
        maxTaskDurationMs: config.agents?.defaults?.maxTaskDurationMs,
        maxRequestsPerTurn: config.agents?.defaults?.maxRequestsPerTurn,
        maxToolFailuresPerTurn: config.agents?.defaults?.maxToolFailuresPerTurn,
        compaction: config.agents?.defaults?.compaction,
        pruning: config.agents?.defaults?.pruning,
        memory: config.agents?.defaults?.memory,
        sessionSearch: config.agents?.defaults?.sessionSearch,
        backgroundReview: config.agents?.defaults?.backgroundReview,
        webExtract: config.agents?.defaults?.webExtract,
        delegate: config.agents?.defaults?.delegate,
        executeCode: config.agents?.defaults?.executeCode,
        systemPromptOverride: config.agents?.defaults?.systemPromptOverride,
        skills: config.agents?.defaults?.skills,
        tools: config.agents?.defaults?.tools,
        params: config.agents?.defaults?.params,
      },
    },
    channels: channelsPayload,
    providers: Object.fromEntries(
      await Promise.all(
        getAllProviders().map(async (provider) => [
          provider,
          (await isProviderConfigured(provider)) ? '***' : '',
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
        token: config.gateway?.auth?.token || '',
        password: config.gateway?.auth?.password ? '••••••••••••' : '',
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
      maxSseConnections:
        typeof config.gateway?.maxSseConnections === 'number'
          ? config.gateway.maxSseConnections
          : 100,
      channelConnectDeferMode: config.gateway?.channelConnectDeferMode ?? 'auto',
      channelConnectDeferIds: Array.isArray(config.gateway?.channelConnectDeferIds)
        ? config.gateway.channelConnectDeferIds
        : [],
      channelConnectDeferSkipIds: Array.isArray(config.gateway?.channelConnectDeferSkipIds)
        ? config.gateway.channelConnectDeferSkipIds
        : [],
      share: resolveShareConfig(config.gateway?.share),
      skillsMarketplaceProvider: config.gateway?.skillsMarketplaceProvider ?? 'skillhub',
      skillsStoreBaseUrl: config.gateway?.skillsStoreBaseUrl ?? 'https://store.xopc.ai',
    },
    cron: resolveCronConfigForWeb(config),
    goals: resolveGoalsConfigForWeb(config),
    session: resolveSessionConfigForWeb(config),
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
      appE2ee: config.tunnel?.appE2ee ?? { enabled: true, requiredOnRemote: true },
    },
    update: {
      ...resolveUpdateConfigForWeb(config),
    },
    stt: maskSttConfigForWeb(config.tools?.media?.audio),
    tts: maskTtsConfigForWeb(config.messages?.tts),
    tools: safeToolsWebForGet(config),
    bindings: Array.isArray(config.bindings) ? config.bindings : [],
    mcp: buildSafeMcpConfigForWeb(config),
  };
}
