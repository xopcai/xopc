import { normalizeChannelsFromConfig } from '@/features/settings/channels-config-api';
import {
  isFeishuConfigured,
  isTelegramConfigured,
  isWeixinConfigured,
} from '@/features/settings/channels/utils';

export type SetupChecklistItemId = 'gateway' | 'provider' | 'defaultModel' | 'channel' | 'skill';

export type SetupChecklistItemState = {
  id: SetupChecklistItemId;
  done: boolean;
  optional?: boolean;
  /** Short status line for the overview card (e.g. model ref, provider count). */
  detail?: string;
};

export type SetupStatusSnapshot = {
  gatewayConnected: boolean;
  providerConfigured: boolean;
  providerCount: number;
  defaultModel: string;
  defaultModelConfigured: boolean;
  channelConfigured: boolean;
  skillInstalled: boolean;
  skillCount: number;
  checklist: SetupChecklistItemState[];
  requiredComplete: boolean;
  allComplete: boolean;
};

function countConfiguredProviders(config: unknown): number {
  if (!config || typeof config !== 'object') return 0;
  const providers = (config as Record<string, unknown>).providers;
  if (!providers || typeof providers !== 'object' || Array.isArray(providers)) return 0;
  return Object.values(providers as Record<string, unknown>).filter((v) => v === '***').length;
}

function readDefaultModel(config: unknown): string {
  if (!config || typeof config !== 'object') return '';
  const agents = (config as Record<string, unknown>).agents;
  if (!agents || typeof agents !== 'object' || Array.isArray(agents)) return '';
  const defaults = (agents as Record<string, unknown>).defaults;
  if (!defaults || typeof defaults !== 'object' || Array.isArray(defaults)) return '';
  const model = (defaults as Record<string, unknown>).model;
  return typeof model === 'string' ? model.trim() : '';
}

function isAnyChannelConfigured(config: unknown): boolean {
  const channels = normalizeChannelsFromConfig(config);
  return (
    (channels.telegram.enabled && isTelegramConfigured(channels.telegram)) ||
    (channels.weixin.enabled && isWeixinConfigured(channels.weixin)) ||
    (channels.feishu.enabled && isFeishuConfigured(channels.feishu)) ||
    isTelegramConfigured(channels.telegram) ||
    isWeixinConfigured(channels.weixin) ||
    isFeishuConfigured(channels.feishu)
  );
}

export function buildSetupStatusSnapshot(input: {
  hasToken: boolean;
  sseConnected: boolean;
  config: unknown;
  skillCount: number;
  labels: {
    gatewayOnline: string;
    gatewayOffline: string;
    providersConfigured: (count: number) => string;
    providersMissing: string;
    modelConfigured: (model: string) => string;
    modelMissing: string;
    channelConfigured: string;
    channelMissing: string;
    skillsConfigured: (count: number) => string;
    skillsMissing: string;
  };
}): SetupStatusSnapshot {
  const providerCount = countConfiguredProviders(input.config);
  const providerConfigured = providerCount > 0;
  const defaultModel = readDefaultModel(input.config);
  const defaultModelConfigured = defaultModel.length > 0;
  const gatewayConnected = input.hasToken && input.sseConnected;
  const channelConfigured = isAnyChannelConfigured(input.config);
  const skillInstalled = input.skillCount > 0;

  const checklist: SetupChecklistItemState[] = [
    {
      id: 'gateway',
      done: gatewayConnected,
      detail: gatewayConnected ? input.labels.gatewayOnline : input.labels.gatewayOffline,
    },
    {
      id: 'provider',
      done: providerConfigured,
      detail: providerConfigured
        ? input.labels.providersConfigured(providerCount)
        : input.labels.providersMissing,
    },
    {
      id: 'defaultModel',
      done: defaultModelConfigured,
      detail: defaultModelConfigured
        ? input.labels.modelConfigured(defaultModel)
        : input.labels.modelMissing,
    },
    {
      id: 'channel',
      done: channelConfigured,
      optional: true,
      detail: channelConfigured ? input.labels.channelConfigured : input.labels.channelMissing,
    },
    {
      id: 'skill',
      done: skillInstalled,
      optional: true,
      detail: skillInstalled
        ? input.labels.skillsConfigured(input.skillCount)
        : input.labels.skillsMissing,
    },
  ];

  const requiredComplete = checklist.filter((item) => !item.optional).every((item) => item.done);
  const allComplete = checklist.every((item) => item.done);

  return {
    gatewayConnected,
    providerConfigured,
    providerCount,
    defaultModel,
    defaultModelConfigured,
    channelConfigured,
    skillInstalled,
    skillCount: input.skillCount,
    checklist,
    requiredComplete,
    allComplete,
  };
}
