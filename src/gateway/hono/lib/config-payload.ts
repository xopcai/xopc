import {
  listAgentEntries,
  normalizeAgentId,
  resolveDefaultAgentId,
} from '../../../agent/agent-scope.js';
import {
  listChannelPlugins,
  syncChannelPluginsFromManager,
} from '../../../channels/plugins/registry.js';
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
        browser: (() => {
          const br = config.agents?.defaults?.browser;
          if (!br || typeof br !== 'object') {
            return {
              enabled: false,
              headless: true,
              allowPrivateUrls: false,
              commandTimeout: null,
              cloudProvider: null,
              cdpUrl: null,
              dialogPolicy: null,
              dialogTimeoutSeconds: null,
            };
          }
          return {
            enabled: br.enabled === true,
            headless: br.headless !== false,
            allowPrivateUrls: br.allowPrivateUrls === true,
            commandTimeout:
              typeof br.commandTimeout === 'number' && Number.isFinite(br.commandTimeout)
                ? Math.floor(br.commandTimeout)
                : null,
            cloudProvider:
              br.cloudProvider === 'browserbase' || br.cloudProvider === 'browser-use' ? br.cloudProvider : null,
            cdpUrl: typeof br.cdpUrl === 'string' && br.cdpUrl.trim() ? br.cdpUrl.trim() : null,
            dialogPolicy:
              br.dialogPolicy === 'must_respond' ||
              br.dialogPolicy === 'auto_accept' ||
              br.dialogPolicy === 'auto_dismiss'
                ? br.dialogPolicy
                : null,
            dialogTimeoutSeconds:
              typeof br.dialogTimeoutSeconds === 'number' && Number.isFinite(br.dialogTimeoutSeconds)
                ? Math.floor(br.dialogTimeoutSeconds)
                : null,
          };
        })(),
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
      host: config.gateway?.host,
      port: config.gateway?.port,
      auth: {
        mode: config.gateway?.auth?.mode || 'token',
        token: config.gateway?.auth?.token || '',
      },
      heartbeat: {
        enabled: config.gateway?.heartbeat?.enabled,
        intervalMs: config.gateway?.heartbeat?.intervalMs,
        target: config.gateway?.heartbeat?.target,
        targetChatId: config.gateway?.heartbeat?.targetChatId,
        prompt: config.gateway?.heartbeat?.prompt,
        ackMaxChars: config.gateway?.heartbeat?.ackMaxChars,
        isolatedSession: config.gateway?.heartbeat?.isolatedSession,
        activeHours: config.gateway?.heartbeat?.activeHours,
      },
    },
    cron: { enabled: config.cron?.enabled },
    update: {
      channel: config.update?.channel ?? 'stable',
    },
    stt: config.tools?.media?.audio,
    tts: config.messages?.tts,
    tools: safeToolsWebForGet(config),
    bindings: Array.isArray(config.bindings) ? config.bindings : [],
  };
}
