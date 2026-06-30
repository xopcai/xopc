/**
 * Build ActivationContext from app config + optional overrides.
 */

import type { Config } from '../config/config-surface.js';
import { mergeSttConfigFromAppConfig } from '../channels/attachments/voice-stt-webchat.js';
import { collectSttProviderConfigEntries } from '../voice/stt/config-slice.js';
import { isSttProviderConfigured } from '../voice/stt/list-providers.js';
import { collectTtsProviderConfigEntries } from '../voice/tts/config-slice.js';
import { isProviderConfigured } from '../voice/tts/factory.js';
import { mergeTtsConfigFromAppConfig } from '../voice/tts/merge-config.js';
import { isProviderConfiguredSync } from '../providers/index.js';
import { PROVIDER_ENV_MAP } from '../providers/env-keys.js';
import type { ActivationContext } from './activation-planner.js';

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function telegramConfigured(ch: Record<string, unknown> | undefined): boolean {
  if (!ch) return false;
  if (ch.enabled === true) return true;
  const accounts = ch.accounts;
  if (isRecord(accounts)) {
    for (const acc of Object.values(accounts)) {
      if (!isRecord(acc)) continue;
      if (acc.enabled === false) continue;
      if (typeof acc.botToken === 'string' && acc.botToken.trim().length > 0) return true;
    }
  }
  return false;
}

function weixinConfigured(ch: Record<string, unknown> | undefined): boolean {
  if (!ch) return false;
  if (ch.enabled === true) return true;
  const accounts = ch.accounts;
  if (isRecord(accounts) && Object.keys(accounts).length > 0) {
    for (const acc of Object.values(accounts)) {
      if (isRecord(acc) && acc.enabled === false) continue;
      return true;
    }
  }
  return false;
}

/**
 * Derive configured channel plugin ids from `channels.*` config.
 */
export function collectConfiguredChannelIds(config: unknown): string[] | undefined {
  const root = config as Record<string, unknown> | undefined;
  const channels = root?.channels;
  if (!isRecord(channels)) return undefined;

  const ids: string[] = [];

  if (telegramConfigured(channels.telegram as Record<string, unknown> | undefined)) {
    ids.push('telegram');
  }
  if (weixinConfigured(channels.weixin as Record<string, unknown> | undefined)) {
    ids.push('weixin');
  }

  for (const [key, value] of Object.entries(channels)) {
    if (key === 'telegram' || key === 'weixin') continue;
    if (isRecord(value) && value.enabled === true && !ids.includes(key)) {
      ids.push(key);
    }
  }

  return ids.length ? ids : undefined;
}

function collectConfiguredLlmProviderIds(config: unknown): string[] {
  const root = config as Record<string, unknown> | undefined;
  const candidateIds = new Set<string>(Object.keys(PROVIDER_ENV_MAP));
  const providers = root?.providers;
  if (isRecord(providers)) {
    for (const key of Object.keys(providers)) {
      candidateIds.add(key);
    }
  }
  const ids: string[] = [];
  for (const key of candidateIds) {
    if (isProviderConfiguredSync(key)) {
      ids.push(key);
    }
  }
  return ids;
}

function collectConfiguredSpeechProviderIds(config: unknown): string[] {
  const root = config as Record<string, unknown> | undefined;
  const messages = root?.messages;
  if (!isRecord(messages) || !isRecord(messages.tts)) {
    return [];
  }

  const ttsConfig = mergeTtsConfigFromAppConfig(messages.tts);
  const ids = new Set<string>();
  const primary = ttsConfig.provider?.trim();
  if (primary && isProviderConfigured(primary, ttsConfig)) {
    ids.add(primary);
  }
  for (const providerId of Object.keys(collectTtsProviderConfigEntries(ttsConfig))) {
    if (isProviderConfigured(providerId, ttsConfig)) {
      ids.add(providerId);
    }
  }
  return [...ids];
}

function collectConfiguredMediaUnderstandingProviderIds(config: unknown): string[] {
  const root = config as Record<string, unknown> | undefined;
  const tools = root?.tools;
  if (!isRecord(tools) || !isRecord(tools.media)) {
    return [];
  }

  const sttConfig = mergeSttConfigFromAppConfig(
    tools.media.audio as Parameters<typeof mergeSttConfigFromAppConfig>[0],
    tools.media as Parameters<typeof mergeSttConfigFromAppConfig>[1],
  );
  const ids = new Set<string>();
  const primary = sttConfig.provider?.trim();
  if (primary && isSttProviderConfigured(primary, sttConfig)) {
    ids.add(primary);
  }
  for (const providerId of Object.keys(collectSttProviderConfigEntries(sttConfig))) {
    if (isSttProviderConfigured(providerId, sttConfig)) {
      ids.add(providerId);
    }
  }
  return [...ids];
}

/**
 * Derive configured provider ids for extension activation (LLM + speech + STT).
 */
export function collectConfiguredProviderIds(config: unknown): string[] | undefined {
  const ids = new Set<string>([
    ...collectConfiguredLlmProviderIds(config),
    ...collectConfiguredSpeechProviderIds(config),
    ...collectConfiguredMediaUnderstandingProviderIds(config),
  ]);
  return ids.size > 0 ? [...ids] : undefined;
}

function defaultModelId(config: unknown): string | undefined {
  const root = config as Record<string, unknown> | undefined;
  const agents = root?.agents;
  if (!isRecord(agents)) return undefined;
  const list = agents.list;
  if (!Array.isArray(list)) return undefined;
  const defaultId = typeof agents.default === 'string' ? agents.default : undefined;
  const entry =
    list.find((candidate) => isRecord(candidate) && candidate.id === defaultId) ??
    list.find((candidate) => isRecord(candidate) && candidate.enabled !== false);
  if (!isRecord(entry)) return undefined;
  const models = entry.models;
  if (!isRecord(models)) return undefined;
  const defaultRole = typeof models.defaultRole === 'string' ? models.defaultRole : undefined;
  const roles = models.roles;
  if (!defaultRole || !isRecord(roles)) return undefined;
  const role = roles[defaultRole];
  if (isRecord(role)) {
    const model = role.model;
    if (typeof model === 'string' && model.trim().length > 0) return model;
  }
  return undefined;
}

/**
 * Merge partial activation context over values inferred from loaded app config.
 */
export function mergeActivationContext(
  appConfig: Config | Record<string, unknown> | undefined,
  partial?: Partial<ActivationContext>,
): ActivationContext {
  const ext = appConfig && isRecord((appConfig as Record<string, unknown>).extensions)
    ? ((appConfig as Record<string, unknown>).extensions as Record<string, unknown>)
    : undefined;

  const base: ActivationContext = {
    enabledIds: Array.isArray(ext?.enabled)
      ? ext!.enabled.filter((x): x is string => typeof x === 'string')
      : undefined,
    disabledIds: Array.isArray(ext?.disabled)
      ? ext!.disabled.filter((x): x is string => typeof x === 'string')
      : undefined,
    requestedModelId: defaultModelId(appConfig),
    configuredProviderIds: collectConfiguredProviderIds(appConfig),
    configuredChannelIds: collectConfiguredChannelIds(appConfig),
    env: process.env,
  };

  return {
    env: partial?.env ?? base.env,
    enabledIds: partial?.enabledIds !== undefined ? partial.enabledIds : base.enabledIds,
    disabledIds: partial?.disabledIds !== undefined ? partial.disabledIds : base.disabledIds,
    requestedModelId:
      partial?.requestedModelId !== undefined ? partial.requestedModelId : base.requestedModelId,
    configuredProviderIds:
      partial?.configuredProviderIds !== undefined
        ? partial.configuredProviderIds
        : base.configuredProviderIds,
    configuredChannelIds:
      partial?.configuredChannelIds !== undefined
        ? partial.configuredChannelIds
        : base.configuredChannelIds,
  };
}
