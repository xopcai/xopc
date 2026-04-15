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
import { agentModelFallbacksToArray, agentModelRefToString } from './agent-model.js';

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
        mediaMaxMb: config.agents?.defaults?.mediaMaxMb,
        maxTokens: config.agents?.defaults?.maxTokens,
        temperature: config.agents?.defaults?.temperature,
        maxToolIterations: config.agents?.defaults?.maxToolIterations,
        workspace: config.agents?.defaults?.workspace,
        thinkingDefault: config.agents?.defaults?.thinkingDefault,
        reasoningDefault: config.agents?.defaults?.reasoningDefault,
        verboseDefault: config.agents?.defaults?.verboseDefault,
        browser: {
          enabled: config.agents?.defaults?.browser?.enabled === true,
          headless: config.agents?.defaults?.browser?.headless !== false,
        },
        compaction: config.agents?.defaults?.compaction,
        pruning: config.agents?.defaults?.pruning,
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
    stt: config.stt,
    tts: config.tts,
    tools: safeToolsWebForGet(config),
    bindings: Array.isArray(config.bindings) ? config.bindings : [],
  };
}
