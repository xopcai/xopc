import { revalidateGatewayConfig } from '@/features/gateway/gateway-config-swr';
import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

import {
  extractChannelAgentRoutes,
  mergeChannelAgentBindings,
  feishuRoutingAccountIds,
  telegramRoutingAccountIds,
  weixinRoutingAccountIds,
  type BindingRuleWire,
} from './channel-bindings-merge';
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
    bindingsFull: [],
    channelAgentRoutes: { telegram: {}, weixin: {}, feishu: {} },
    defaultAgentId: 'main',
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
    feishu: {
      enabled: false,
      defaultAccount: '',
      appId: '',
      appSecret: '',
      domain: 'feishu',
      connectionMode: 'websocket',
      dmPolicy: 'pairing',
      groupPolicy: 'allowlist',
      allowFrom: [],
      groupAllowFrom: [],
      requireMention: true,
      historyLimit: 50,
      textChunkLimit: 4000,
      renderMode: 'auto',
      streaming: true,
      reactionNotifications: 'own',
      accounts: {},
    },
  };
}

export function normalizeChannelsFromConfig(config: unknown): ChannelsSettingsState {
  const cfg = config && typeof config === 'object' ? (config as { channels?: unknown }).channels : undefined;
  const ch = cfg && typeof cfg === 'object' ? (cfg as Record<string, unknown>) : {};
  const tg = ch.telegram as Record<string, unknown> | undefined;
  const wx = ch.weixin as Record<string, unknown> | undefined;
  const fs = ch.feishu as Record<string, unknown> | undefined;

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

  const bindingsRaw = (() => {
    const cfgObj = config && typeof config === 'object' ? (config as Record<string, unknown>) : {};
    const b = cfgObj.bindings;
    return Array.isArray(b) ? (b as BindingRuleWire[]) : [];
  })();

  const agents = (() => {
    const cfgObj = config && typeof config === 'object' ? (config as Record<string, unknown>) : {};
    const a = cfgObj.agents;
    return a && typeof a === 'object' ? (a as Record<string, unknown>) : {};
  })();
  const defaultAgentId =
    typeof agents.defaultId === 'string' && agents.defaultId.trim()
      ? agents.defaultId.trim().toLowerCase()
      : 'main';

  const base = {
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
    feishu: {
      enabled: Boolean(fs?.enabled),
      defaultAccount: typeof fs?.defaultAccount === 'string' ? fs.defaultAccount : '',
      appId: typeof fs?.appId === 'string' ? fs.appId : '',
      appSecret: typeof fs?.appSecret === 'string' ? fs.appSecret : '',
      domain: (typeof fs?.domain === 'string' && fs.domain) || 'feishu',
      connectionMode: (fs?.connectionMode as any) || 'websocket',
      dmPolicy: (fs?.dmPolicy as DmPolicy) || 'pairing',
      groupPolicy: (fs?.groupPolicy as GroupPolicy) || 'allowlist',
      allowFrom: Array.isArray(fs?.allowFrom) ? [...(fs.allowFrom as (string | number)[])] : [],
      groupAllowFrom: Array.isArray(fs?.groupAllowFrom) ? [...(fs.groupAllowFrom as (string | number)[])] : [],
      requireMention: fs?.requireMention === undefined ? true : Boolean(fs.requireMention),
      historyLimit: typeof fs?.historyLimit === 'number' ? fs.historyLimit : 50,
      textChunkLimit: typeof fs?.textChunkLimit === 'number' ? fs.textChunkLimit : 4000,
      renderMode: (fs?.renderMode as any) || 'auto',
      streaming: fs?.streaming === undefined ? true : Boolean(fs.streaming),
      reactionNotifications: (fs?.reactionNotifications as any) || 'own',
      accounts:
        fs?.accounts && typeof fs.accounts === 'object' && !Array.isArray(fs.accounts)
          ? ({ ...(fs.accounts as Record<string, any>) } as any)
          : {},
    },
  };

  const tgIds = telegramRoutingAccountIds(base.telegram);
  const wxIds = weixinRoutingAccountIds(base.weixin);
  const fsIds = feishuRoutingAccountIds(base.feishu as any);
  const channelAgentRoutes = extractChannelAgentRoutes(bindingsRaw, tgIds, wxIds, fsIds, defaultAgentId);

  return {
    ...base,
    bindingsFull: bindingsRaw.map((r) => ({ ...r })),
    channelAgentRoutes,
    defaultAgentId,
  };
}

export async function fetchChannelsSettings(): Promise<ChannelsSettingsState> {
  const res = await fetchJson<{ ok?: boolean; payload?: { config?: unknown } }>(apiUrl('/api/config'));
  const c = res.payload?.config;
  return normalizeChannelsFromConfig(c ?? {});
}

export type WeixinGatewayQrLoginStatusPayload =
  | { phase: 'polling'; qrcodeUrl: string; qrStatus?: string }
  | { phase: 'done'; ok: true; accountId: string }
  | { phase: 'done'; ok: false; message: string }
  | { phase: 'unknown'; message: string };

export async function fetchWeixinGatewayQrLoginStart(body?: {
  account?: string;
  timeoutMs?: number;
}): Promise<{ sessionKey: string; qrcodeUrl: string }> {
  const res = await fetchJson<{ ok: boolean; payload: { sessionKey: string; qrcodeUrl: string } }>(
    apiUrl('/api/channels/weixin/login/start'),
    { method: 'POST', body: JSON.stringify(body ?? {}) },
  );
  return res.payload;
}

export async function fetchWeixinGatewayQrLoginStatus(
  sessionKey: string,
): Promise<WeixinGatewayQrLoginStatusPayload> {
  const res = await fetchJson<{ ok: boolean; payload: { status: WeixinGatewayQrLoginStatusPayload } }>(
    apiUrl(`/api/channels/weixin/login/${encodeURIComponent(sessionKey)}`),
  );
  return res.payload.status;
}

export async function patchChannelsSettings(state: ChannelsSettingsState): Promise<ChannelsSettingsState> {
  const tg = state.telegram;
  const wx = state.weixin;
  const fs = state.feishu;
  const mergedBindings = mergeChannelAgentBindings(
    state.bindingsFull,
    state.channelAgentRoutes,
    telegramRoutingAccountIds(tg),
    weixinRoutingAccountIds(wx),
    feishuRoutingAccountIds(fs as any),
    state.defaultAgentId,
  );
  const weixinRouteTag: string | number | null = (() => {
    const raw = wx.routeTag.trim();
    if (!raw) return null;
    return /^\d+$/.test(raw) ? Number(raw) : raw;
  })();

  const res = await fetchJson<{ ok?: boolean; payload?: { config?: unknown } }>(apiUrl('/api/config'), {
    method: 'PATCH',
    body: JSON.stringify({
      bindings: mergedBindings,
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
          // Always send `accounts` (including `{}`) so PATCH clears stale entries instead of omitting the field.
          accounts: tg.accounts,
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
          accounts: wx.accounts,
        },
        feishu: {
          enabled: fs.enabled,
          defaultAccount: fs.defaultAccount || undefined,
          appId: fs.appId,
          appSecret: fs.appSecret || undefined,
          domain: fs.domain || undefined,
          connectionMode: fs.connectionMode,
          dmPolicy: fs.dmPolicy,
          groupPolicy: fs.groupPolicy,
          allowFrom: fs.allowFrom,
          groupAllowFrom: fs.groupAllowFrom.length ? fs.groupAllowFrom : undefined,
          requireMention: fs.requireMention,
          historyLimit: fs.historyLimit,
          textChunkLimit: fs.textChunkLimit,
          renderMode: fs.renderMode,
          streaming: fs.streaming,
          reactionNotifications: fs.reactionNotifications,
          accounts: fs.accounts,
        },
      },
    }),
  });
  const c = res.payload?.config;
  void revalidateGatewayConfig();
  if (c) return normalizeChannelsFromConfig(c);
  return {
    ...state,
    bindingsFull: mergedBindings,
  };
}
