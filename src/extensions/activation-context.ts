/**
 * Build ActivationContext from app config + optional overrides.
 */

import type { Config } from '../config/config-surface.js';
import type { ActivationContext } from './activation-planner.js';

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function telegramConfigured(ch: Record<string, unknown> | undefined): boolean {
  if (!ch) return false;
  if (ch.enabled === true) return true;
  if (typeof ch.botToken === 'string' && ch.botToken.trim().length > 0) return true;
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

/**
 * Derive configured LLM provider ids when present on config (e.g. custom keys block).
 */
export function collectConfiguredProviderIds(config: unknown): string[] | undefined {
  const root = config as Record<string, unknown> | undefined;
  const providers = root?.providers;
  if (!isRecord(providers)) return undefined;
  const ids = Object.keys(providers).filter((k) => {
    const v = providers[k];
    if (!isRecord(v)) return false;
    return (
      (typeof v.apiKey === 'string' && v.apiKey.length > 0) ||
      (typeof v.api_key === 'string' && v.api_key.length > 0) ||
      v.enabled === true
    );
  });
  return ids.length ? ids : undefined;
}

function defaultModelId(config: unknown): string | undefined {
  const root = config as Record<string, unknown> | undefined;
  const agents = root?.agents;
  if (!isRecord(agents)) return undefined;
  const defaults = agents.defaults;
  if (!isRecord(defaults)) return undefined;
  const model = defaults.model;
  if (typeof model === 'string' && model.trim().length > 0) return model;
  if (isRecord(model)) {
    const primary = model.primary;
    if (typeof primary === 'string' && primary.trim().length > 0) return primary;
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
