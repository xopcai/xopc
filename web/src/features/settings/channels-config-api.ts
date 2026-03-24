import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

import type {
  ChannelsSettingsState,
  DmPolicy,
  GroupPolicy,
  ReplyToMode,
  StreamMode,
  TelegramAccount,
  WeixinAccount,
} from './channels-settings.types';

export type {
  ChannelsSettingsState,
  TelegramConfig,
  WeixinConfig,
} from './channels-settings.types';

export type { DmPolicy, GroupPolicy, ReplyToMode, StreamMode };

export function defaultChannelsState(): ChannelsSettingsState {
  return {
    telegram: {
      enabled: false,
      botToken: '',
      apiRoot: '',
      debug: false,
      allowFrom: [],
      groupAllowFrom: [],
      dmPolicy: 'pairing',
      groupPolicy: 'open',
      replyToMode: 'off',
      streamMode: 'partial',
      historyLimit: 50,
      textChunkLimit: 4000,
      proxy: '',
      accounts: {},
    },
    weixin: {
      enabled: false,
      dmPolicy: 'pairing',
      allowFrom: [],
      debug: false,
      streamMode: 'partial',
      historyLimit: 50,
      textChunkLimit: 4000,
      routeTag: '',
      accounts: {},
    },
  };
}

export function normalizeChannelsFromConfig(config: unknown): ChannelsSettingsState {
  const cfg = config && typeof config === 'object' ? (config as { channels?: unknown }).channels : undefined;
  const ch = cfg && typeof cfg === 'object' ? (cfg as Record<string, unknown>) : {};
  const tg = ch.telegram as Record<string, unknown> | undefined;
  const wx = ch.weixin as Record<string, unknown> | undefined;

  const telegramAccounts = tg?.accounts;
  const accounts: Record<string, TelegramAccount> =
    telegramAccounts && typeof telegramAccounts === 'object' && !Array.isArray(telegramAccounts)
      ? (telegramAccounts as Record<string, TelegramAccount>)
      : {};

  const weixinAccounts = wx?.accounts;
  const wxAcc: Record<string, WeixinAccount> =
    weixinAccounts && typeof weixinAccounts === 'object' && !Array.isArray(weixinAccounts)
      ? (weixinAccounts as Record<string, WeixinAccount>)
      : {};

  return {
    telegram: {
      enabled: Boolean(tg?.enabled),
      botToken: typeof tg?.botToken === 'string' ? tg.botToken : '',
      apiRoot: typeof tg?.apiRoot === 'string' ? tg.apiRoot : '',
      debug: Boolean(tg?.debug),
      allowFrom: Array.isArray(tg?.allowFrom) ? [...(tg.allowFrom as (string | number)[])] : [],
      groupAllowFrom: Array.isArray(tg?.groupAllowFrom) ? [...(tg.groupAllowFrom as (string | number)[])] : [],
      dmPolicy: (tg?.dmPolicy as DmPolicy) || 'pairing',
      groupPolicy: (tg?.groupPolicy as GroupPolicy) || 'open',
      replyToMode: (tg?.replyToMode as ReplyToMode) || 'off',
      streamMode: (tg?.streamMode as StreamMode) ?? 'partial',
      historyLimit: typeof tg?.historyLimit === 'number' ? tg.historyLimit : 50,
      textChunkLimit: typeof tg?.textChunkLimit === 'number' ? tg.textChunkLimit : 4000,
      proxy: typeof tg?.proxy === 'string' ? tg.proxy : '',
      accounts: { ...accounts },
    },
    weixin: {
      enabled: Boolean(wx?.enabled),
      dmPolicy: (wx?.dmPolicy as DmPolicy) || 'pairing',
      allowFrom: Array.isArray(wx?.allowFrom) ? [...(wx.allowFrom as string[])] : [],
      debug: Boolean(wx?.debug),
      streamMode: (wx?.streamMode as StreamMode) ?? 'partial',
      historyLimit: typeof wx?.historyLimit === 'number' ? wx.historyLimit : 50,
      textChunkLimit: typeof wx?.textChunkLimit === 'number' ? wx.textChunkLimit : 4000,
      routeTag: wx?.routeTag != null ? String(wx.routeTag) : '',
      accounts: { ...wxAcc },
    },
  };
}

export async function fetchChannelsSettings(): Promise<ChannelsSettingsState> {
  const res = await fetchJson<{ ok?: boolean; payload?: { config?: unknown } }>(apiUrl('/api/config'));
  const c = res.payload?.config;
  return normalizeChannelsFromConfig(c ?? {});
}

export async function patchChannelsSettings(state: ChannelsSettingsState): Promise<void> {
  const tg = state.telegram;
  const wx = state.weixin;
  const weixinRouteTag: string | number | null = (() => {
    const raw = wx.routeTag.trim();
    if (!raw) return null;
    return /^\d+$/.test(raw) ? Number(raw) : raw;
  })();

  await fetchJson(apiUrl('/api/config'), {
    method: 'PATCH',
    body: JSON.stringify({
      channels: {
        telegram: {
          enabled: tg.enabled,
          botToken: tg.botToken,
          apiRoot: tg.apiRoot || undefined,
          debug: tg.debug,
          allowFrom: tg.allowFrom,
          groupAllowFrom: tg.groupAllowFrom.length ? tg.groupAllowFrom : undefined,
          dmPolicy: tg.dmPolicy,
          groupPolicy: tg.groupPolicy,
          replyToMode: tg.replyToMode,
          streamMode: tg.streamMode,
          historyLimit: tg.historyLimit,
          textChunkLimit: tg.textChunkLimit,
          proxy: tg.proxy || undefined,
          accounts: Object.keys(tg.accounts).length ? tg.accounts : undefined,
        },
        weixin: {
          enabled: wx.enabled,
          dmPolicy: wx.dmPolicy,
          allowFrom: wx.allowFrom,
          debug: wx.debug,
          streamMode: wx.streamMode,
          historyLimit: wx.historyLimit,
          textChunkLimit: wx.textChunkLimit,
          routeTag: weixinRouteTag,
          accounts: Object.keys(wx.accounts).length ? wx.accounts : undefined,
        },
      },
    }),
  });
}
