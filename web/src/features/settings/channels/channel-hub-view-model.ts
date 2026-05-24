import type { ChannelStatus } from '@/features/cron/cron-api';
import {
  feishuRoutingAccountIds,
  telegramRoutingAccountIds,
  weixinRoutingAccountIds,
} from '@/features/settings/channel-bindings-merge';
import type { ChannelPairingSummaryPayload, ChannelsSettingsState } from '@/features/settings/channels-config-api';
import type { ChannelsSettingsMessages } from '@/i18n/messages';

import { isManageableChannelId, type ManageableChannelId } from './channels-routes';
import { channelUsesPairingPolicy, hubPairingPendingCount } from './pairing-policy';
import { isFeishuConfigured, isTelegramConfigured, isWeixinConfigured } from './utils';

export type ChannelHubId = ManageableChannelId;

export type ChannelHubStatus = 'not_configured' | 'disabled' | 'running' | 'offline';

export type ChannelHubPrimaryAction = 'setup' | 'manage' | 'fix' | 'pairing';

export type ChannelHubCardVm = {
  id: string;
  manageable: boolean;
  configured: boolean;
  enabled: boolean;
  connected: boolean;
  status: ChannelHubStatus;
  summaryLines: string[];
  pendingPairing: number;
  primaryAction: ChannelHubPrimaryAction;
};

export type ChannelsHubSummaryVm = {
  pendingPairingTotal: number;
  stalePairingTotal: number;
  atCapacity: boolean;
  offlineChannelIds: string[];
};

export const CHANNEL_HUB_IDS: readonly ChannelHubId[] = ['telegram', 'weixin', 'feishu'];

export function resolveChannelConnected(statuses: ChannelStatus[], id: string): boolean {
  return statuses.find((s) => s.name === id)?.connected ?? false;
}

function readChannelEnabled(statuses: ChannelStatus[], id: string): boolean {
  return statuses.find((s) => s.name === id)?.enabled ?? false;
}

export function isExtensionChannelConfigured(config: unknown, id: string): boolean {
  const channels =
    config && typeof config === 'object'
      ? (config as { channels?: unknown }).channels
      : undefined;
  const section =
    channels && typeof channels === 'object' && !Array.isArray(channels)
      ? (channels as Record<string, unknown>)[id]
      : undefined;
  if (!section || typeof section !== 'object') return false;
  return Object.keys(section).length > 0;
}

function resolveChannelHubStatus(configured: boolean, enabled: boolean, connected: boolean): ChannelHubStatus {
  if (!configured) return 'not_configured';
  if (!enabled) return 'disabled';
  if (connected) return 'running';
  return 'offline';
}

function resolvePrimaryAction(
  status: ChannelHubStatus,
  pendingPairing: number,
  manageable: boolean,
): ChannelHubPrimaryAction {
  if (!manageable) return 'manage';
  if (status === 'not_configured') return 'setup';
  if (pendingPairing > 0) return 'pairing';
  if (status === 'offline') return 'fix';
  return 'manage';
}

function dmPolicyLabel(ch: ChannelsSettingsMessages, policy: ChannelsSettingsState['telegram']['dmPolicy']): string {
  return ch.policy.dm[policy];
}

function accountCountLine(ch: ChannelsSettingsMessages, count: number): string {
  return ch.hubSummaryAccountCount.replace('{{count}}', String(count));
}

function buildTelegramSummaryLines(ch: ChannelsSettingsMessages, form: ChannelsSettingsState): string[] {
  const tg = form.telegram;
  const lines = [ch.hubSummaryDm.replace('{{policy}}', dmPolicyLabel(ch, tg.dmPolicy))];
  const count = telegramRoutingAccountIds(tg).length;
  if (count > 0) lines.push(accountCountLine(ch, count));
  return lines;
}

function buildWeixinSummaryLines(ch: ChannelsSettingsMessages, form: ChannelsSettingsState): string[] {
  const wx = form.weixin;
  const lines = [ch.hubSummaryDm.replace('{{policy}}', dmPolicyLabel(ch, wx.dmPolicy))];
  lines.push(ch.hubSummaryStream.replace('{{mode}}', ch.policy.stream[wx.streamMode]));
  const count = weixinRoutingAccountIds(wx).length;
  if (count > 0) lines.push(accountCountLine(ch, count));
  return lines;
}

function buildFeishuSummaryLines(ch: ChannelsSettingsMessages, form: ChannelsSettingsState): string[] {
  const fs = form.feishu;
  const mode = fs.connectionMode === 'webhook' ? ch.hubConnectionWebhook : ch.hubConnectionWebsocket;
  const lines = [ch.hubSummaryConnection.replace('{{mode}}', mode)];
  const count = feishuRoutingAccountIds(fs).length;
  if (count > 0) lines.push(accountCountLine(ch, count));
  return lines;
}

function pairingSlice(
  id: ManageableChannelId,
  summary: ChannelPairingSummaryPayload,
): ChannelPairingSummaryPayload['telegram'] {
  return summary[id];
}

export function buildManageableChannelHubCardVm(params: {
  id: ManageableChannelId;
  form: ChannelsSettingsState;
  connected: boolean;
  pairingSummary: ChannelPairingSummaryPayload;
  ch: ChannelsSettingsMessages;
}): ChannelHubCardVm {
  const { id, form, connected, pairingSummary, ch } = params;
  const tg = form.telegram;
  const wx = form.weixin;
  const fs = form.feishu;

  const configured =
    id === 'telegram'
      ? isTelegramConfigured(tg)
      : id === 'weixin'
        ? isWeixinConfigured(wx)
        : isFeishuConfigured(fs);

  const enabled = id === 'telegram' ? tg.enabled : id === 'weixin' ? wx.enabled : fs.enabled;
  const channelConfig = id === 'telegram' ? tg : id === 'weixin' ? wx : fs;
  const usesPairing = channelUsesPairingPolicy(id, channelConfig);
  const pendingPairing = hubPairingPendingCount({
    configured,
    channelEnabled: enabled,
    usesPairing,
    summaryPending: pairingSlice(id, pairingSummary).pending,
  });

  const status = resolveChannelHubStatus(configured, enabled, connected);
  const summaryLines = configured
    ? id === 'telegram'
      ? buildTelegramSummaryLines(ch, form)
      : id === 'weixin'
        ? buildWeixinSummaryLines(ch, form)
        : buildFeishuSummaryLines(ch, form)
    : [];

  return {
    id,
    manageable: true,
    configured,
    enabled,
    connected,
    status,
    summaryLines,
    pendingPairing,
    primaryAction: resolvePrimaryAction(status, pendingPairing, true),
  };
}

/** @deprecated alias */
export const buildChannelHubCardVm = buildManageableChannelHubCardVm;

export function buildExtensionChannelHubCardVm(params: {
  id: string;
  config: unknown;
  statuses: ChannelStatus[];
  ch: ChannelsSettingsMessages;
}): ChannelHubCardVm {
  const { id, config, statuses, ch } = params;
  const configured = isExtensionChannelConfigured(config, id);
  const enabled = readChannelEnabled(statuses, id);
  const connected = resolveChannelConnected(statuses, id);
  const status = resolveChannelHubStatus(configured, enabled, connected);

  return {
    id,
    manageable: false,
    configured,
    enabled,
    connected,
    status,
    summaryLines: configured ? [ch.hubExtensionConfiguredHint] : [],
    pendingPairing: 0,
    primaryAction: 'manage',
  };
}

export function buildChannelHubCardForCatalogId(params: {
  id: string;
  form: ChannelsSettingsState;
  config: unknown;
  statuses: ChannelStatus[];
  pairingSummary: ChannelPairingSummaryPayload;
  ch: ChannelsSettingsMessages;
}): ChannelHubCardVm {
  if (isManageableChannelId(params.id)) {
    return buildManageableChannelHubCardVm({
      id: params.id,
      form: params.form,
      connected: resolveChannelConnected(params.statuses, params.id),
      pairingSummary: params.pairingSummary,
      ch: params.ch,
    });
  }
  return buildExtensionChannelHubCardVm({
    id: params.id,
    config: params.config,
    statuses: params.statuses,
    ch: params.ch,
  });
}

export function buildChannelsHubSummaryVm(params: {
  cards: ChannelHubCardVm[];
  pairingSummary: ChannelPairingSummaryPayload;
}): ChannelsHubSummaryVm {
  const { cards, pairingSummary } = params;
  const pendingPairingTotal = cards.reduce((n, c) => n + c.pendingPairing, 0);
  const stalePairingTotal =
    pairingSummary.telegram.stale + pairingSummary.feishu.stale + pairingSummary.weixin.stale;
  const atCapacity =
    pairingSummary.telegram.atCapacity ||
    pairingSummary.feishu.atCapacity ||
    pairingSummary.weixin.atCapacity;
  const offlineChannelIds = cards.filter((c) => c.status === 'offline').map((c) => c.id);

  return {
    pendingPairingTotal,
    stalePairingTotal,
    atCapacity,
    offlineChannelIds,
  };
}

export function buildChannelHubCardsForCatalog(params: {
  catalogIds: string[];
  form: ChannelsSettingsState;
  config: unknown;
  statuses: ChannelStatus[];
  pairingSummary: ChannelPairingSummaryPayload;
  ch: ChannelsSettingsMessages;
}): ChannelHubCardVm[] {
  return params.catalogIds.map((id) =>
    buildChannelHubCardForCatalogId({
      id,
      form: params.form,
      config: params.config,
      statuses: params.statuses,
      pairingSummary: params.pairingSummary,
      ch: params.ch,
    }),
  );
}

export function buildChannelHubCards(
  form: ChannelsSettingsState,
  statuses: ChannelStatus[],
  pairingSummary: ChannelPairingSummaryPayload,
  ch: ChannelsSettingsMessages,
): ChannelHubCardVm[] {
  return buildChannelHubCardsForCatalog({
    catalogIds: [...CHANNEL_HUB_IDS],
    form,
    config: null,
    statuses,
    pairingSummary,
    ch,
  });
}
