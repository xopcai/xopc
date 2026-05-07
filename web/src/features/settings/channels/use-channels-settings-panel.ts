import { useCallback, useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';

import { fetchChatAgents } from '@/features/chat/chat-agents-api';
import { useGatewayConfigSwr } from '@/features/gateway/gateway-config-swr';
import {
  defaultChannelsState,
  normalizeChannelsFromConfig,
  patchChannelsSettings,
  type ChannelsSettingsState,
  type DmPolicy,
  type GroupPolicy,
  type ReplyToMode,
  type StreamMode,
} from '@/features/settings/channels-config-api';
import { messages } from '@/i18n/messages';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';

import { telegramDefaultBotToken } from './utils';

export function useChannelsSettingsPanel() {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const ch = m.channelsSettings;
  const token = useGatewayStore((st) => st.token);
  const hasToken = Boolean(token);

  const [form, setForm] = useState<ChannelsSettingsState | null>(null);
  const [baseline, setBaseline] = useState<ChannelsSettingsState | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveOk, setSaveOk] = useState(false);

  const [weixinModalOpen, setWeixinModalOpen] = useState(false);
  const [telegramModalOpen, setTelegramModalOpen] = useState(false);
  const [feishuModalOpen, setFeishuModalOpen] = useState(false);
  const [dingtalkModalOpen, setDingtalkModalOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<'weixin' | 'telegram' | 'feishu' | 'dingtalk' | null>(null);
  const [weixinSuccessBanner, setWeixinSuccessBanner] = useState<string | null>(null);
  const [feishuQrSetupOpen, setFeishuQrSetupOpen] = useState(false);
  const [feishuSetupSuccessBanner, setFeishuSetupSuccessBanner] = useState<string | null>(null);
  const [dingtalkSetupSuccessBanner, setDingtalkSetupSuccessBanner] = useState<string | null>(null);
  const [tgAdvanced, setTgAdvanced] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [showFeishuSecret, setShowFeishuSecret] = useState(false);
  const [showFeishuWebhookSecrets, setShowFeishuWebhookSecrets] = useState(false);
  const [showDingtalkSecret, setShowDingtalkSecret] = useState(false);
  const [copied, setCopied] = useState(false);
  const [feishuCopied, setFeishuCopied] = useState(false);
  const [dingtalkCopied, setDingtalkCopied] = useState(false);
  const [feishuWebhookCopied, setFeishuWebhookCopied] = useState(false);

  const [tgAccountsDraft, setTgAccountsDraft] = useState('');
  const [tgAccountsError, setTgAccountsError] = useState('');
  const [wxAccountsDraft, setWxAccountsDraft] = useState('');
  const [wxAccountsError, setWxAccountsError] = useState('');
  const [feishuAccountsDraft, setFeishuAccountsDraft] = useState('');
  const [feishuAccountsError, setFeishuAccountsError] = useState('');
  const [dingtalkAccountsDraft, setDingtalkAccountsDraft] = useState('');
  const [dingtalkAccountsError, setDingtalkAccountsError] = useState('');

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

  const dirty = useMemo(() => {
    if (!form || !baseline) return false;
    return JSON.stringify(form) !== JSON.stringify(baseline);
  }, [form, baseline]);

  useEffect(() => {
    if (!hasToken) {
      setForm(null);
      setBaseline(null);
      return;
    }
    if (parsed === null) return;
    if (!dirty) {
      setForm(parsed);
      setBaseline(structuredClone(parsed));
      setTgAccountsDraft(JSON.stringify(parsed.telegram.accounts ?? {}, null, 2));
      setTgAccountsError('');
      setWxAccountsDraft(JSON.stringify(parsed.weixin.accounts ?? {}, null, 2));
      setWxAccountsError('');
      setFeishuAccountsDraft(JSON.stringify(parsed.feishu?.accounts ?? {}, null, 2));
      setFeishuAccountsError('');
      setDingtalkAccountsDraft(JSON.stringify(parsed.dingtalk?.accounts ?? {}, null, 2));
      setDingtalkAccountsError('');
      setSaveOk(false);
    }
  }, [hasToken, parsed, dirty]);

  const loading = Boolean(hasToken && isLoading && cfgData === undefined && !swrError);
  const fetchError =
    swrError instanceof Error ? swrError.message : swrError ? String(swrError) : null;

  const updateChannelAgentRoute = useCallback(
    (channel: 'telegram' | 'weixin' | 'feishu' | 'dingtalk', accountId: string, agentId: string) => {
      setForm((f) => {
        if (!f) return null;
        const k =
          channel === 'telegram'
            ? 'telegram'
            : channel === 'weixin'
              ? 'weixin'
              : channel === 'feishu'
                ? 'feishu'
                : 'dingtalk';
        return {
          ...f,
          channelAgentRoutes: {
            ...f.channelAgentRoutes,
            [k]: { ...f.channelAgentRoutes[k], [accountId]: agentId.trim().toLowerCase() },
          },
        };
      });
    },
    [],
  );

  const updateTelegram = useCallback((patch: Partial<ChannelsSettingsState['telegram']>) => {
    setForm((f) => (f ? { ...f, telegram: { ...f.telegram, ...patch } } : null));
  }, []);

  const updateWeixin = useCallback((patch: Partial<ChannelsSettingsState['weixin']>) => {
    setForm((f) => (f ? { ...f, weixin: { ...f.weixin, ...patch } } : null));
  }, []);

  const updateFeishu = useCallback((patch: Partial<ChannelsSettingsState['feishu']>) => {
    setForm((f) => (f ? { ...f, feishu: { ...f.feishu, ...patch } } : null));
  }, []);

  const updateDingtalk = useCallback((patch: Partial<ChannelsSettingsState['dingtalk']>) => {
    setForm((f) => (f ? { ...f, dingtalk: { ...f.dingtalk, ...patch } } : null));
  }, []);

  const save = useCallback(async (): Promise<boolean> => {
    if (!form || saving) return false;
    setSaving(true);
    setError(null);
    setSaveOk(false);
    try {
      const next = await patchChannelsSettings(form);
      setForm(next);
      const baselineClone = structuredClone(next);
      setBaseline(baselineClone);
      setTgAccountsDraft(JSON.stringify(baselineClone.telegram.accounts ?? {}, null, 2));
      setTgAccountsError('');
      setWxAccountsDraft(JSON.stringify(baselineClone.weixin.accounts ?? {}, null, 2));
      setWxAccountsError('');
      setFeishuAccountsDraft(JSON.stringify(baselineClone.feishu?.accounts ?? {}, null, 2));
      setFeishuAccountsError('');
      setDingtalkAccountsDraft(JSON.stringify(baselineClone.dingtalk?.accounts ?? {}, null, 2));
      setDingtalkAccountsError('');
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

  const toggleChannelEnabled = useCallback(
    async (which: 'weixin' | 'telegram' | 'feishu' | 'dingtalk', enabled: boolean) => {
      if (!form || saving) return;
      const prev = form;
      const next: ChannelsSettingsState =
        which === 'weixin'
          ? { ...form, weixin: { ...form.weixin, enabled } }
          : which === 'telegram'
            ? { ...form, telegram: { ...form.telegram, enabled } }
            : which === 'feishu'
              ? { ...form, feishu: { ...form.feishu, enabled } }
              : { ...form, dingtalk: { ...form.dingtalk, enabled } };
      setForm(next);
      setSaving(true);
      setError(null);
      try {
        const synced = await patchChannelsSettings(next);
        setForm(synced);
        const baselineClone = structuredClone(synced);
        setBaseline(baselineClone);
        setTgAccountsDraft(JSON.stringify(baselineClone.telegram.accounts ?? {}, null, 2));
        setWxAccountsDraft(JSON.stringify(baselineClone.weixin.accounts ?? {}, null, 2));
        setFeishuAccountsDraft(JSON.stringify(baselineClone.feishu?.accounts ?? {}, null, 2));
        setDingtalkAccountsDraft(JSON.stringify(baselineClone.dingtalk?.accounts ?? {}, null, 2));
      } catch (e) {
        setError(e instanceof Error ? e.message : ch.saveError);
        setForm(prev);
      } finally {
        setSaving(false);
      }
    },
    [form, saving, ch.saveError],
  );

  const removeChannel = useCallback(async () => {
    if (!form || !removeTarget || saving) return;
    const defaults = defaultChannelsState();
    const next: ChannelsSettingsState =
      removeTarget === 'weixin'
        ? { ...form, weixin: defaults.weixin }
        : removeTarget === 'telegram'
          ? { ...form, telegram: defaults.telegram }
          : removeTarget === 'feishu'
            ? { ...form, feishu: defaults.feishu }
            : { ...form, dingtalk: defaults.dingtalk };
    setSaving(true);
    setError(null);
    try {
      const synced = await patchChannelsSettings(next);
      setForm(synced);
      const baselineClone = structuredClone(synced);
      setBaseline(baselineClone);
      setTgAccountsDraft(JSON.stringify(baselineClone.telegram.accounts ?? {}, null, 2));
      setWxAccountsDraft(JSON.stringify(baselineClone.weixin.accounts ?? {}, null, 2));
      setTgAccountsError('');
      setWxAccountsError('');
      setFeishuAccountsDraft(JSON.stringify(baselineClone.feishu?.accounts ?? {}, null, 2));
      setFeishuAccountsError('');
      setDingtalkAccountsDraft(JSON.stringify(baselineClone.dingtalk?.accounts ?? {}, null, 2));
      setDingtalkAccountsError('');
      setRemoveTarget(null);
      setSaveOk(true);
      window.setTimeout(() => setSaveOk(false), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : ch.saveError);
    } finally {
      setSaving(false);
    }
  }, [form, removeTarget, saving, ch.saveError]);

  const copyToken = useCallback(async () => {
    const t = form ? telegramDefaultBotToken(form.telegram) : '';
    if (!t) return;
    await navigator.clipboard.writeText(t).catch(() => {});
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

  const handleDingtalkQrSetupSuccess = useCallback(
    (result: { clientId: string }) => {
      updateDingtalk({
        clientId: result.clientId,
        enabled: true,
      });
      void mutate();
      setDingtalkSetupSuccessBanner(ch.dingtalkQrSetupSuccess);
      window.setTimeout(() => setDingtalkSetupSuccessBanner(null), 4000);
    },
    [updateDingtalk, mutate, ch.dingtalkQrSetupSuccess],
  );

  const copyDingtalkSecret = useCallback(async () => {
    const t = form?.dingtalk?.clientSecret;
    if (!t) return;
    await navigator.clipboard.writeText(t).catch(() => {});
    setDingtalkCopied(true);
    window.setTimeout(() => setDingtalkCopied(false), 2000);
  }, [form]);

  const copyFeishuSecret = useCallback(async () => {
    const t = form?.feishu?.appSecret;
    if (!t) return;
    await navigator.clipboard.writeText(t).catch(() => {});
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
    await navigator.clipboard.writeText(JSON.stringify(payload, null, 2)).catch(() => {});
    setFeishuWebhookCopied(true);
    window.setTimeout(() => setFeishuWebhookCopied(false), 2000);
  }, [form]);

  const onTgAccountsBlur = useCallback(() => {
    if (!form) return;
    const raw = tgAccountsDraft.trim();
    if (!raw) {
      updateTelegram({ accounts: {} });
      setTgAccountsError('');
      return;
    }
    try {
      const parsedJson = JSON.parse(raw) as unknown;
      if (typeof parsedJson !== 'object' || parsedJson === null || Array.isArray(parsedJson)) {
        throw new Error(ch.jsonObjectAccounts);
      }
      updateTelegram({ accounts: parsedJson as ChannelsSettingsState['telegram']['accounts'] });
      setTgAccountsError('');
    } catch (err) {
      setTgAccountsError(err instanceof Error ? err.message : ch.jsonInvalid);
    }
  }, [form, tgAccountsDraft, updateTelegram, ch.jsonObjectAccounts, ch.jsonInvalid]);

  const onWxAccountsBlur = useCallback(() => {
    if (!form) return;
    const raw = wxAccountsDraft.trim();
    if (!raw) {
      updateWeixin({ accounts: {} });
      setWxAccountsError('');
      return;
    }
    try {
      const parsedJson = JSON.parse(raw) as unknown;
      if (typeof parsedJson !== 'object' || parsedJson === null || Array.isArray(parsedJson)) {
        throw new Error(ch.jsonObjectAccounts);
      }
      updateWeixin({ accounts: parsedJson as ChannelsSettingsState['weixin']['accounts'] });
      setWxAccountsError('');
    } catch (err) {
      setWxAccountsError(err instanceof Error ? err.message : ch.jsonInvalid);
    }
  }, [form, wxAccountsDraft, updateWeixin, ch.jsonObjectAccounts, ch.jsonInvalid]);

  const onFeishuAccountsBlur = useCallback(() => {
    if (!form) return;
    const raw = feishuAccountsDraft.trim();
    if (!raw) {
      updateFeishu({ accounts: {} });
      setFeishuAccountsError('');
      return;
    }
    try {
      const parsedJson = JSON.parse(raw) as unknown;
      if (typeof parsedJson !== 'object' || parsedJson === null || Array.isArray(parsedJson)) {
        throw new Error(ch.jsonObjectAccounts);
      }
      updateFeishu({ accounts: parsedJson as ChannelsSettingsState['feishu']['accounts'] });
      setFeishuAccountsError('');
    } catch (err) {
      setFeishuAccountsError(err instanceof Error ? err.message : ch.jsonInvalid);
    }
  }, [form, feishuAccountsDraft, updateFeishu, ch.jsonObjectAccounts, ch.jsonInvalid]);

  const onDingtalkAccountsBlur = useCallback(() => {
    if (!form) return;
    const raw = dingtalkAccountsDraft.trim();
    if (!raw) {
      updateDingtalk({ accounts: {} });
      setDingtalkAccountsError('');
      return;
    }
    try {
      const parsedJson = JSON.parse(raw) as unknown;
      if (typeof parsedJson !== 'object' || parsedJson === null || Array.isArray(parsedJson)) {
        throw new Error(ch.jsonObjectAccounts);
      }
      updateDingtalk({ accounts: parsedJson as ChannelsSettingsState['dingtalk']['accounts'] });
      setDingtalkAccountsError('');
    } catch (err) {
      setDingtalkAccountsError(err instanceof Error ? err.message : ch.jsonInvalid);
    }
  }, [form, dingtalkAccountsDraft, updateDingtalk, ch.jsonObjectAccounts, ch.jsonInvalid]);

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
    weixinModalOpen,
    setWeixinModalOpen,
    telegramModalOpen,
    setTelegramModalOpen,
    feishuModalOpen,
    setFeishuModalOpen,
    dingtalkModalOpen,
    setDingtalkModalOpen,
    removeTarget,
    setRemoveTarget,
    weixinSuccessBanner,
    setWeixinSuccessBanner,
    feishuQrSetupOpen,
    setFeishuQrSetupOpen,
    feishuSetupSuccessBanner,
    dingtalkSetupSuccessBanner,
    tgAdvanced,
    setTgAdvanced,
    showToken,
    setShowToken,
    showFeishuSecret,
    setShowFeishuSecret,
    showFeishuWebhookSecrets,
    setShowFeishuWebhookSecrets,
    showDingtalkSecret,
    setShowDingtalkSecret,
    copied,
    feishuCopied,
    dingtalkCopied,
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
    dingtalkAccountsDraft,
    setDingtalkAccountsDraft,
    dingtalkAccountsError,
    chatAgents,
    updateChannelAgentRoute,
    updateTelegram,
    updateWeixin,
    updateFeishu,
    updateDingtalk,
    save,
    toggleChannelEnabled,
    removeChannel,
    copyToken,
    handleFeishuQrSetupSuccess,
    handleDingtalkQrSetupSuccess,
    copyFeishuSecret,
    copyDingtalkSecret,
    copyFeishuWebhookConfig,
    onTgAccountsBlur,
    onWxAccountsBlur,
    onFeishuAccountsBlur,
    onDingtalkAccountsBlur,
    dmOpts,
    groupOpts,
    replyOpts,
    streamOpts,
  };
}
