import { useCallback, useMemo, useReducer, useRef, useState } from 'react';
import useSWR from 'swr';

import { fetchChatAgents } from '@/features/chat/agent-selection/chat-agents-api';
import { useGatewayConfigSwr } from '@/features/gateway/gateway-config-swr';
import {
  normalizeChannelsFromConfig,
  patchChannelsSettings,
  type ChannelsSettingsState,
  type DmPolicy,
  type GroupPolicy,
  type ReplyToMode,
  type StreamMode,
} from '@/features/settings/channels-config-api';
import { messages } from '@/i18n/messages';
import { copyTextToClipboard } from '@/lib/copy-to-clipboard';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';

import { telegramDefaultBotToken } from './utils';

type ChannelsPanelFormState = {
  form: ChannelsSettingsState | null;
  baseline: ChannelsSettingsState | null;
  tgAccountsDraft: string;
  tgAccountsError: string;
  wxAccountsDraft: string;
  wxAccountsError: string;
  feishuAccountsDraft: string;
  feishuAccountsError: string;
};

const emptyPanelFormState: ChannelsPanelFormState = {
  form: null,
  baseline: null,
  tgAccountsDraft: '',
  tgAccountsError: '',
  wxAccountsDraft: '',
  wxAccountsError: '',
  feishuAccountsDraft: '',
  feishuAccountsError: '',
};

function accountsDraftsFrom(state: ChannelsSettingsState): Pick<
  ChannelsPanelFormState,
  | 'tgAccountsDraft'
  | 'tgAccountsError'
  | 'wxAccountsDraft'
  | 'wxAccountsError'
  | 'feishuAccountsDraft'
  | 'feishuAccountsError'
> {
  return {
    tgAccountsDraft: JSON.stringify(state.telegram.accounts ?? {}, null, 2),
    tgAccountsError: '',
    wxAccountsDraft: JSON.stringify(state.weixin.accounts ?? {}, null, 2),
    wxAccountsError: '',
    feishuAccountsDraft: JSON.stringify(state.feishu?.accounts ?? {}, null, 2),
    feishuAccountsError: '',
  };
}

type PanelFormAction =
  | { type: 'reset' }
  | { type: 'load'; payload: ChannelsSettingsState }
  | { type: 'commitSaved'; payload: ChannelsSettingsState }
  | { type: 'discard' }
  | { type: 'updateTelegram'; patch: Partial<ChannelsSettingsState['telegram']> }
  | { type: 'updateWeixin'; patch: Partial<ChannelsSettingsState['weixin']> }
  | { type: 'updateFeishu'; patch: Partial<ChannelsSettingsState['feishu']> }
  | {
      type: 'updateChannelAgentRoute';
      channel: 'telegram' | 'weixin' | 'feishu';
      accountId: string;
      agentId: string;
    }
  | { type: 'setTgAccountsDraft'; value: string }
  | { type: 'setWxAccountsDraft'; value: string }
  | { type: 'setFeishuAccountsDraft'; value: string }
  | { type: 'setTgAccountsError'; value: string }
  | { type: 'setWxAccountsError'; value: string }
  | { type: 'setFeishuAccountsError'; value: string }
  | { type: 'applyTgAccounts'; accounts: ChannelsSettingsState['telegram']['accounts'] }
  | { type: 'applyWxAccounts'; accounts: ChannelsSettingsState['weixin']['accounts'] }
  | { type: 'applyFeishuAccounts'; accounts: ChannelsSettingsState['feishu']['accounts'] }
  | { type: 'restoreForm'; payload: ChannelsSettingsState };

function panelFormReducer(
  state: ChannelsPanelFormState,
  action: PanelFormAction,
): ChannelsPanelFormState {
  switch (action.type) {
    case 'reset':
      return emptyPanelFormState;
    case 'load': {
      const snapshot = structuredClone(action.payload);
      return {
        form: snapshot,
        baseline: structuredClone(snapshot),
        ...accountsDraftsFrom(snapshot),
      };
    }
    case 'commitSaved': {
      const snapshot = structuredClone(action.payload);
      return {
        form: snapshot,
        baseline: structuredClone(snapshot),
        ...accountsDraftsFrom(snapshot),
      };
    }
    case 'discard': {
      if (!state.baseline) return state;
      const restored = structuredClone(state.baseline);
      return {
        form: restored,
        baseline: state.baseline,
        ...accountsDraftsFrom(restored),
      };
    }
    case 'updateTelegram':
      return state.form
        ? {
            ...state,
            form: { ...state.form, telegram: { ...state.form.telegram, ...action.patch } },
          }
        : state;
    case 'updateWeixin':
      return state.form
        ? {
            ...state,
            form: { ...state.form, weixin: { ...state.form.weixin, ...action.patch } },
          }
        : state;
    case 'updateFeishu':
      return state.form
        ? {
            ...state,
            form: { ...state.form, feishu: { ...state.form.feishu, ...action.patch } },
          }
        : state;
    case 'updateChannelAgentRoute': {
      if (!state.form) return state;
      const k =
        action.channel === 'telegram'
          ? 'telegram'
          : action.channel === 'weixin'
            ? 'weixin'
            : 'feishu';
      return {
        ...state,
        form: {
          ...state.form,
          channelAgentRoutes: {
            ...state.form.channelAgentRoutes,
            [k]: {
              ...state.form.channelAgentRoutes[k],
              [action.accountId]: action.agentId.trim().toLowerCase(),
            },
          },
        },
      };
    }
    case 'setTgAccountsDraft':
      return { ...state, tgAccountsDraft: action.value };
    case 'setWxAccountsDraft':
      return { ...state, wxAccountsDraft: action.value };
    case 'setFeishuAccountsDraft':
      return { ...state, feishuAccountsDraft: action.value };
    case 'setTgAccountsError':
      return { ...state, tgAccountsError: action.value };
    case 'setWxAccountsError':
      return { ...state, wxAccountsError: action.value };
    case 'setFeishuAccountsError':
      return { ...state, feishuAccountsError: action.value };
    case 'applyTgAccounts':
      return state.form
        ? {
            ...state,
            form: { ...state.form, telegram: { ...state.form.telegram, accounts: action.accounts } },
            tgAccountsError: '',
          }
        : state;
    case 'applyWxAccounts':
      return state.form
        ? {
            ...state,
            form: { ...state.form, weixin: { ...state.form.weixin, accounts: action.accounts } },
            wxAccountsError: '',
          }
        : state;
    case 'applyFeishuAccounts':
      return state.form
        ? {
            ...state,
            form: { ...state.form, feishu: { ...state.form.feishu, accounts: action.accounts } },
            feishuAccountsError: '',
          }
        : state;
    case 'restoreForm':
      return { ...state, form: structuredClone(action.payload) };
  }
}

export function useChannelsSettingsPanel() {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const ch = m.channelsSettings;
  const token = useGatewayStore((st) => st.token);
  const hasToken = Boolean(token);

  const dirtyRef = useRef(false);
  const [panelForm, dispatchPanelForm] = useReducer(panelFormReducer, emptyPanelFormState);
  const [syncSource, setSyncSource] = useState({
    hasToken,
    parsed: null as ChannelsSettingsState | null,
  });

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveOk, setSaveOk] = useState(false);

  const [weixinSuccessBanner, setWeixinSuccessBanner] = useState<string | null>(null);
  const [feishuSetupSuccessBanner, setFeishuSetupSuccessBanner] = useState<string | null>(null);
  const [tgAdvanced, setTgAdvanced] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [showFeishuSecret, setShowFeishuSecret] = useState(false);
  const [showFeishuWebhookSecrets, setShowFeishuWebhookSecrets] = useState(false);
  const [copied, setCopied] = useState(false);
  const [feishuCopied, setFeishuCopied] = useState(false);
  const [feishuWebhookCopied, setFeishuWebhookCopied] = useState(false);

  const { data: chatAgents } = useSWR(hasToken ? 'gateway-chat-agents-ch' : null, fetchChatAgents, {
    revalidateOnFocus: false,
  });

  const { data: cfgData, error: swrError, isLoading, mutate } = useGatewayConfigSwr(hasToken);

  const parsed = useMemo(
    () =>
      cfgData?.payload?.config !== undefined
        ? normalizeChannelsFromConfig(cfgData.payload.config)
        : null,
    [cfgData],
  );

  if (hasToken !== syncSource.hasToken || parsed !== syncSource.parsed) {
    setSyncSource({ hasToken, parsed });
    if (!hasToken) {
      dirtyRef.current = false;
      dispatchPanelForm({ type: 'reset' });
      setSaveOk(false);
    } else if (parsed !== null && !dirtyRef.current) {
      dispatchPanelForm({ type: 'load', payload: parsed });
      setSaveOk(false);
    }
  }

  const {
    form,
    baseline,
    tgAccountsDraft,
    tgAccountsError,
    wxAccountsDraft,
    wxAccountsError,
    feishuAccountsDraft,
    feishuAccountsError,
  } = panelForm;

  const dirty = useMemo(() => {
    if (!form || !baseline) return false;
    return JSON.stringify(form) !== JSON.stringify(baseline);
  }, [form, baseline]);

  const loading = Boolean(hasToken && isLoading && cfgData === undefined && !swrError);
  const fetchError =
    swrError instanceof Error ? swrError.message : swrError ? String(swrError) : null;

  const updateChannelAgentRoute = useCallback(
    (channel: 'telegram' | 'weixin' | 'feishu', accountId: string, agentId: string) => {
      dirtyRef.current = true;
      dispatchPanelForm({ type: 'updateChannelAgentRoute', channel, accountId, agentId });
    },
    [],
  );

  const updateTelegram = useCallback((patch: Partial<ChannelsSettingsState['telegram']>) => {
    dirtyRef.current = true;
    dispatchPanelForm({ type: 'updateTelegram', patch });
  }, []);

  const updateWeixin = useCallback((patch: Partial<ChannelsSettingsState['weixin']>) => {
    dirtyRef.current = true;
    dispatchPanelForm({ type: 'updateWeixin', patch });
  }, []);

  const updateFeishu = useCallback((patch: Partial<ChannelsSettingsState['feishu']>) => {
    dirtyRef.current = true;
    dispatchPanelForm({ type: 'updateFeishu', patch });
  }, []);

  const save = useCallback(async (): Promise<boolean> => {
    if (!form || saving) return false;
    setSaving(true);
    setError(null);
    setSaveOk(false);
    try {
      const next = await patchChannelsSettings(form);
      dirtyRef.current = false;
      dispatchPanelForm({ type: 'commitSaved', payload: next });
      setSaveOk(true);
      window.setTimeout(() => setSaveOk(false), 2500);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : ch.saveError);
      return false;
    } finally {
      setSaving(false);
    }
  }, [form, saving, ch.saveError]);

  const discard = useCallback(() => {
    if (!baseline) return;
    dirtyRef.current = false;
    dispatchPanelForm({ type: 'discard' });
    setError(null);
    setSaveOk(false);
  }, [baseline]);

  const toggleChannelEnabled = useCallback(
    async (which: 'weixin' | 'telegram' | 'feishu', enabled: boolean) => {
      if (!form || saving) return;
      const prev = form;
      const next: ChannelsSettingsState =
        which === 'weixin'
          ? { ...form, weixin: { ...form.weixin, enabled } }
          : which === 'telegram'
            ? { ...form, telegram: { ...form.telegram, enabled } }
            : { ...form, feishu: { ...form.feishu, enabled } };
      dirtyRef.current = true;
      if (which === 'weixin') {
        dispatchPanelForm({ type: 'updateWeixin', patch: { enabled } });
      } else if (which === 'telegram') {
        dispatchPanelForm({ type: 'updateTelegram', patch: { enabled } });
      } else {
        dispatchPanelForm({ type: 'updateFeishu', patch: { enabled } });
      }
      setSaving(true);
      setError(null);
      try {
        const synced = await patchChannelsSettings(next);
        dirtyRef.current = false;
        dispatchPanelForm({ type: 'commitSaved', payload: synced });
      } catch (e) {
        setError(e instanceof Error ? e.message : ch.saveError);
        dirtyRef.current = true;
        dispatchPanelForm({ type: 'restoreForm', payload: prev });
      } finally {
        setSaving(false);
      }
    },
    [form, saving, ch.saveError],
  );

  const copyToken = useCallback(async () => {
    const t = form ? telegramDefaultBotToken(form.telegram) : '';
    if (!t) return;
    const ok = await copyTextToClipboard(t);
    if (!ok) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }, [form]);

  const handleFeishuQrSetupSuccess = useCallback(
    (result: { appId: string; domain: string; openId?: string }) => {
      updateFeishu({
        appId: result.appId,
        domain: result.domain,
        enabled: true,
      });
      void mutate();
      setFeishuSetupSuccessBanner(ch.feishuQrSetupSuccess);
      window.setTimeout(() => setFeishuSetupSuccessBanner(null), 4000);
    },
    [updateFeishu, mutate, ch.feishuQrSetupSuccess],
  );

  const copyFeishuSecret = useCallback(async () => {
    const t = form?.feishu?.appSecret;
    if (!t) return;
    const ok = await copyTextToClipboard(t);
    if (!ok) return;
    setFeishuCopied(true);
    window.setTimeout(() => setFeishuCopied(false), 2000);
  }, [form]);

  const copyFeishuWebhookConfig = useCallback(async () => {
    const fs = form?.feishu;
    if (!fs) return;
    const payload = {
      connectionMode: fs.connectionMode,
      verificationToken: fs.verificationToken || '',
      encryptKey: fs.encryptKey || '',
      webhookHost: fs.webhookHost || '',
      webhookPort: fs.webhookPort || 0,
      webhookPath: fs.webhookPath || '',
    };
    const ok = await copyTextToClipboard(JSON.stringify(payload, null, 2));
    if (!ok) return;
    setFeishuWebhookCopied(true);
    window.setTimeout(() => setFeishuWebhookCopied(false), 2000);
  }, [form]);

  const setTgAccountsDraft = useCallback((value: string) => {
    dispatchPanelForm({ type: 'setTgAccountsDraft', value });
  }, []);

  const setWxAccountsDraft = useCallback((value: string) => {
    dispatchPanelForm({ type: 'setWxAccountsDraft', value });
  }, []);

  const setFeishuAccountsDraft = useCallback((value: string) => {
    dispatchPanelForm({ type: 'setFeishuAccountsDraft', value });
  }, []);

  const onTgAccountsBlur = useCallback(() => {
    if (!form) return;
    const raw = tgAccountsDraft.trim();
    if (!raw) {
      dirtyRef.current = true;
      dispatchPanelForm({ type: 'applyTgAccounts', accounts: {} });
      return;
    }
    try {
      const parsedJson = JSON.parse(raw) as unknown;
      if (typeof parsedJson !== 'object' || parsedJson === null || Array.isArray(parsedJson)) {
        throw new Error(ch.jsonObjectAccounts);
      }
      dirtyRef.current = true;
      dispatchPanelForm({
        type: 'applyTgAccounts',
        accounts: parsedJson as ChannelsSettingsState['telegram']['accounts'],
      });
    } catch (err) {
      dispatchPanelForm({
        type: 'setTgAccountsError',
        value: err instanceof Error ? err.message : ch.jsonInvalid,
      });
    }
  }, [form, tgAccountsDraft, ch.jsonObjectAccounts, ch.jsonInvalid]);

  const onWxAccountsBlur = useCallback(() => {
    if (!form) return;
    const raw = wxAccountsDraft.trim();
    if (!raw) {
      dirtyRef.current = true;
      dispatchPanelForm({ type: 'applyWxAccounts', accounts: {} });
      return;
    }
    try {
      const parsedJson = JSON.parse(raw) as unknown;
      if (typeof parsedJson !== 'object' || parsedJson === null || Array.isArray(parsedJson)) {
        throw new Error(ch.jsonObjectAccounts);
      }
      dirtyRef.current = true;
      dispatchPanelForm({
        type: 'applyWxAccounts',
        accounts: parsedJson as ChannelsSettingsState['weixin']['accounts'],
      });
    } catch (err) {
      dispatchPanelForm({
        type: 'setWxAccountsError',
        value: err instanceof Error ? err.message : ch.jsonInvalid,
      });
    }
  }, [form, wxAccountsDraft, ch.jsonObjectAccounts, ch.jsonInvalid]);

  const onFeishuAccountsBlur = useCallback(() => {
    if (!form) return;
    const raw = feishuAccountsDraft.trim();
    if (!raw) {
      dirtyRef.current = true;
      dispatchPanelForm({ type: 'applyFeishuAccounts', accounts: {} });
      return;
    }
    try {
      const parsedJson = JSON.parse(raw) as unknown;
      if (typeof parsedJson !== 'object' || parsedJson === null || Array.isArray(parsedJson)) {
        throw new Error(ch.jsonObjectAccounts);
      }
      dirtyRef.current = true;
      dispatchPanelForm({
        type: 'applyFeishuAccounts',
        accounts: parsedJson as ChannelsSettingsState['feishu']['accounts'],
      });
    } catch (err) {
      dispatchPanelForm({
        type: 'setFeishuAccountsError',
        value: err instanceof Error ? err.message : ch.jsonInvalid,
      });
    }
  }, [form, feishuAccountsDraft, ch.jsonObjectAccounts, ch.jsonInvalid]);

  const dmOpts = useMemo(
    () =>
      (['pairing', 'allowlist', 'open', 'disabled'] as DmPolicy[]).map((value) => ({
        value,
        label: ch.policy.dm[value],
      })),
    [ch.policy.dm],
  );

  const groupOpts = useMemo(
    () =>
      (['open', 'disabled', 'allowlist'] as GroupPolicy[]).map((value) => ({
        value,
        label: ch.policy.group[value],
      })),
    [ch.policy.group],
  );

  const replyOpts = useMemo(
    () =>
      (['off', 'first', 'all'] as ReplyToMode[]).map((value) => ({
        value,
        label: ch.policy.reply[value],
      })),
    [ch.policy.reply],
  );

  const streamOpts = useMemo(
    () =>
      (['off', 'partial', 'block'] as StreamMode[]).map((value) => ({
        value,
        label: ch.policy.stream[value],
      })),
    [ch.policy.stream],
  );

  return {
    language,
    m,
    ch,
    hasToken,
    loading,
    fetchError,
    mutate,
    form,
    baseline,
    dirty,
    saving,
    error,
    saveOk,
    weixinSuccessBanner,
    setWeixinSuccessBanner,
    feishuSetupSuccessBanner,
    tgAdvanced,
    setTgAdvanced,
    showToken,
    setShowToken,
    showFeishuSecret,
    setShowFeishuSecret,
    showFeishuWebhookSecrets,
    setShowFeishuWebhookSecrets,
    copied,
    feishuCopied,
    feishuWebhookCopied,
    tgAccountsDraft,
    setTgAccountsDraft,
    tgAccountsError,
    wxAccountsDraft,
    setWxAccountsDraft,
    wxAccountsError,
    feishuAccountsDraft,
    setFeishuAccountsDraft,
    feishuAccountsError,
    chatAgents,
    updateChannelAgentRoute,
    updateTelegram,
    updateWeixin,
    updateFeishu,
    save,
    discard,
    toggleChannelEnabled,
    copyToken,
    handleFeishuQrSetupSuccess,
    copyFeishuSecret,
    copyFeishuWebhookConfig,
    onTgAccountsBlur,
    onWxAccountsBlur,
    onFeishuAccountsBlur,
    dmOpts,
    groupOpts,
    replyOpts,
    streamOpts,
  };
}
