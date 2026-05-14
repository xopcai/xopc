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
  const [removeTarget, setRemoveTarget] = useState<'weixin' | 'telegram' | 'feishu' | null>(null);
  const [weixinSuccessBanner, setWeixinSuccessBanner] = useState<string | null>(null);
  const [feishuSetupSuccessBanner, setFeishuSetupSuccessBanner] = useState<string | null>(null);
  const [tgAdvanced, setTgAdvanced] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [showFeishuSecret, setShowFeishuSecret] = useState(false);
  const [showFeishuWebhookSecrets, setShowFeishuWebhookSecrets] = useState(false);
  const [copied, setCopied] = useState(false);
  const [feishuCopied, setFeishuCopied] = useState(false);
  const [feishuWebhookCopied, setFeishuWebhookCopied] = useState(false);

  const [tgAccountsDraft, setTgAccountsDraft] = useState('');
  const [tgAccountsError, setTgAccountsError] = useState('');
  const [wxAccountsDraft, setWxAccountsDraft] = useState('');
  const [wxAccountsError, setWxAccountsError] = useState('');
  const [feishuAccountsDraft, setFeishuAccountsDraft] = useState('');
  const [feishuAccountsError, setFeishuAccountsError] = useState('');

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
      setSaveOk(false);
    }
  }, [hasToken, parsed, dirty]);

  const loading = Boolean(hasToken && isLoading && cfgData === undefined && !swrError);
  const fetchError =
    swrError instanceof Error ? swrError.message : swrError ? String(swrError) : null;

  const updateChannelAgentRoute = useCallback(
    (channel: 'telegram' | 'weixin' | 'feishu', accountId: string, agentId: string) => {
      setForm((f) => {
        if (!f) return null;
        const k = channel === 'telegram' ? 'telegram' : channel === 'weixin' ? 'weixin' : 'feishu';
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
    const b = structuredClone(baseline);
    setForm(b);
    setTgAccountsDraft(JSON.stringify(b.telegram.accounts ?? {}, null, 2));
    setTgAccountsError('');
    setWxAccountsDraft(JSON.stringify(b.weixin.accounts ?? {}, null, 2));
    setWxAccountsError('');
    setFeishuAccountsDraft(JSON.stringify(b.feishu?.accounts ?? {}, null, 2));
    setFeishuAccountsError('');
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
          : { ...form, feishu: defaults.feishu };
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
    removeTarget,
    setRemoveTarget,
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
    removeChannel,
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
