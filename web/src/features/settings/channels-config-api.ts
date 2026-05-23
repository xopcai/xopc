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

export function emptyTelegramAccount(accountId: string): TelegramAccount {
  return {
    accountId,
    name: '',
    enabled: true,
    botToken: '',
    allowFrom: [],
    dmPolicy: 'pairing',
    groupPolicy: 'open',
    replyToMode: 'off',
    apiRoot: '',
    proxy: '',
    historyLimit: 50,
    textChunkLimit: 4000,
    streamMode: 'partial',
  };
}

export function defaultChannelsState(): ChannelsSettingsState {
  return {
    bindingsFull: [],
    channelAgentRoutes: { telegram: {}, weixin: {}, feishu: {} },
    defaultAgentId: 'main',
    telegram: {
      enabled: false,
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
      accounts: { default: emptyTelegramAccount('default') },
    },
    weixin: {
      enabled: false,
      dmPolicy: 'open',
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
      verificationToken: '',
      encryptKey: '',
      webhookHost: '127.0.0.1',
      webhookPort: 3000,
      webhookPath: '/feishu/events',
      dmPolicy: 'open',
      groupPolicy: 'allowlist',
      allowFrom: [],
      groupAllowFrom: [],
      requireMention: true,
      historyLimit: 50,
      textChunkLimit: 4000,
      renderMode: 'auto',
      streaming: false,
      reactionNotifications: 'own',
      tools: { doc: true, wiki: true, drive: true, scopes: true, bitable: true, perm: false },
      actions: { reactions: true },
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
  let accounts: Record<string, TelegramAccount> =
    telegramAccounts && typeof telegramAccounts === 'object' && !Array.isArray(telegramAccounts)
      ? { ...(telegramAccounts as Record<string, TelegramAccount>) }
      : {};

  const legacyTopToken = typeof tg?.botToken === 'string' ? tg.botToken.trim() : '';
  const defaultTok = accounts.default?.botToken?.trim() ?? '';
  if (legacyTopToken && !defaultTok) {
    accounts = {
      ...accounts,
      default: {
        ...(accounts.default ?? emptyTelegramAccount('default')),
        accountId: 'default',
        botToken: legacyTopToken,
      },
    };
  }
  if (!accounts.default) {
    accounts = { ...accounts, default: emptyTelegramAccount('default') };
  }

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
      dmPolicy: (wx?.dmPolicy as DmPolicy) || 'open',
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
      verificationToken: typeof fs?.verificationToken === 'string' ? fs.verificationToken : '',
      encryptKey: typeof fs?.encryptKey === 'string' ? fs.encryptKey : '',
      webhookHost: typeof fs?.webhookHost === 'string' ? fs.webhookHost : '127.0.0.1',
      webhookPort: typeof fs?.webhookPort === 'number' ? fs.webhookPort : 3000,
      webhookPath: typeof fs?.webhookPath === 'string' ? fs.webhookPath : '/feishu/events',
      dmPolicy: (fs?.dmPolicy as DmPolicy) || 'open',
      groupPolicy: (fs?.groupPolicy as GroupPolicy) || 'allowlist',
      allowFrom: Array.isArray(fs?.allowFrom) ? [...(fs.allowFrom as (string | number)[])] : [],
      groupAllowFrom: Array.isArray(fs?.groupAllowFrom) ? [...(fs.groupAllowFrom as (string | number)[])] : [],
      requireMention: fs?.requireMention === undefined ? true : Boolean(fs.requireMention),
      historyLimit: typeof fs?.historyLimit === 'number' ? fs.historyLimit : 50,
      textChunkLimit: typeof fs?.textChunkLimit === 'number' ? fs.textChunkLimit : 4000,
      renderMode: (fs?.renderMode as any) || 'auto',
      streaming: fs?.streaming === undefined ? false : Boolean(fs.streaming),
      reactionNotifications: (fs?.reactionNotifications as any) || 'own',
      tools:
        fs?.tools && typeof fs.tools === 'object' && !Array.isArray(fs.tools)
          ? ({ ...(fs.tools as Record<string, boolean>) } as any)
          : undefined,
      actions:
        fs?.actions && typeof fs.actions === 'object' && !Array.isArray(fs.actions)
          ? ({ ...(fs.actions as Record<string, boolean>) } as any)
          : undefined,
      accounts:
        fs?.accounts && typeof fs.accounts === 'object' && !Array.isArray(fs.accounts)
          ? ({ ...(fs.accounts as Record<string, any>) } as any)
          : {},
    },
  };

  const tgIds = telegramRoutingAccountIds(base.telegram);
  const wxIds = weixinRoutingAccountIds(base.weixin);
  const fsIds = feishuRoutingAccountIds(base.feishu);
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
    feishuRoutingAccountIds(fs),
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
          verificationToken: (fs as any).verificationToken?.trim() ? (fs as any).verificationToken : undefined,
          encryptKey: (fs as any).encryptKey?.trim() ? (fs as any).encryptKey : undefined,
          webhookHost: (fs as any).webhookHost?.trim() ? (fs as any).webhookHost : undefined,
          webhookPort: typeof (fs as any).webhookPort === 'number' ? (fs as any).webhookPort : undefined,
          webhookPath: (fs as any).webhookPath?.trim() ? (fs as any).webhookPath : undefined,
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
          tools: (fs as any).tools,
          actions: (fs as any).actions,
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

// ---------------------------------------------------------------------------
// Feishu QR scan-to-create
// ---------------------------------------------------------------------------

export type FeishuSetupStatusPayload =
  | { phase: 'polling' }
  | { phase: 'done'; ok: true; appId: string; domain: string; openId?: string }
  | { phase: 'done'; ok: false; message: string }
  | { phase: 'unknown'; message: string };

export async function fetchFeishuSetupStart(body?: {
  domain?: 'feishu' | 'lark';
}): Promise<{ sessionKey: string; qrUrl: string }> {
  const res = await fetchJson<{
    ok: boolean;
    payload: { sessionKey: string; qrUrl: string };
  }>(apiUrl('/api/channels/feishu/setup/start'), {
    method: 'POST',
    body: JSON.stringify(body ?? {}),
  });
  return res.payload;
}

export async function fetchFeishuSetupStatus(sessionKey: string): Promise<FeishuSetupStatusPayload> {
  const res = await fetchJson<{
    ok: boolean;
    payload: { status: FeishuSetupStatusPayload };
  }>(apiUrl(`/api/channels/feishu/setup/${encodeURIComponent(sessionKey)}`));
  return res.payload.status;
}

// ---------------------------------------------------------------------------
// Channel DM pairing (telegram / feishu / weixin)
// ---------------------------------------------------------------------------

export type PairingChannelId = 'telegram' | 'feishu' | 'weixin';

export type PairingPendingItem = {
  senderId: string;
  codeLast4: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  isStale: boolean;
  meta?: Record<string, string>;
};

export type ChannelPairingStatePayload = {
  channel: PairingChannelId;
  accountId: string;
  dmPolicy: DmPolicy;
  pending: PairingPendingItem[];
  paired: {
    fromConfig: string[];
    fromCredentials: string[];
  };
};

export async function fetchChannelPairingState(
  channel: PairingChannelId,
  accountId = 'default',
): Promise<ChannelPairingStatePayload> {
  const q = new URLSearchParams({ channel, account: accountId });
  const res = await fetchJson<{ ok: boolean; payload: ChannelPairingStatePayload }>(
    apiUrl(`/api/channels/pairing?${q.toString()}`),
  );
  return res.payload;
}

export async function approveChannelPairingRequest(body: {
  channel: PairingChannelId;
  accountId?: string;
  code: string;
}): Promise<{ senderId: string; alreadyPaired: boolean }> {
  const res = await fetchJson<{
    ok: boolean;
    payload: { senderId: string; alreadyPaired: boolean };
    error?: { code?: string; message?: string };
  }>(apiUrl('/api/channels/pairing/approve'), {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return res.payload;
}

export type ChannelPairingSummaryEntry = {
  pending: number;
  stale: number;
  atCapacity: boolean;
};

export type ChannelPairingSummaryPayload = Record<PairingChannelId, ChannelPairingSummaryEntry>;

export async function fetchChannelPairingSummary(): Promise<ChannelPairingSummaryPayload> {
  const res = await fetchJson<{
    ok: boolean;
    payload: { summary: ChannelPairingSummaryPayload };
  }>(apiUrl('/api/channels/pairing/summary'));
  return res.payload.summary;
}

export async function approveChannelPairingBySender(body: {
  channel: PairingChannelId;
  accountId?: string;
  senderId: string;
}): Promise<{ senderId: string; alreadyPaired: boolean }> {
  const res = await fetchJson<{
    ok: boolean;
    payload: { senderId: string; alreadyPaired: boolean };
  }>(apiUrl('/api/channels/pairing/approve-sender'), {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return res.payload;
}

export async function revokeChannelPairingPaired(body: {
  channel: PairingChannelId;
  accountId?: string;
  senderId: string;
}): Promise<{ changed: boolean }> {
  const res = await fetchJson<{
    ok: boolean;
    payload: { changed: boolean };
  }>(apiUrl('/api/channels/pairing/paired'), {
    method: 'DELETE',
    body: JSON.stringify(body),
  });
  return res.payload;
}

export async function dismissChannelPairingPending(body: {
  channel: PairingChannelId;
  accountId?: string;
  senderId: string;
}): Promise<{ senderId: string }> {
  const res = await fetchJson<{
    ok: boolean;
    payload: { senderId: string };
    error?: { code?: string; message?: string };
  }>(apiUrl('/api/channels/pairing/pending'), {
    method: 'DELETE',
    body: JSON.stringify(body),
  });
  return res.payload;
}
