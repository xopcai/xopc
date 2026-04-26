import * as Dialog from '@radix-ui/react-dialog';
import {
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  MessageSquare,
  Send,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { fetchChatAgents } from '@/features/chat/chat-agents-api';
import { useGatewayConfigSwr } from '@/features/gateway/gateway-config-swr';
import { feishuRoutingAccountIds } from '@/features/settings/channel-bindings-merge';
import { telegramRoutingAccountIds } from '@/features/settings/channel-bindings-merge';
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
import { cn } from '@/lib/cn';
import { messages } from '@/i18n/messages';
import { docsGuidePageUrl } from '@/navigation';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';

import { ChannelAgentRoutingBlock } from './channel-agent-routing-block';
import { ChannelImHubCard } from './channel-im-hub-card';
import { FieldHint, FieldLabel } from './field-primitives';
import { TelegramAdvanced } from './telegram-advanced';
import { WeixinAdvanced } from './weixin-advanced';
import { WeixinQrLoginDialog } from './weixin-qr-login-dialog';
import {
  channelsInputClassName,
  isFeishuConfigured,
  isTelegramConfigured,
  isWeixinConfigured,
  joinAllowFrom,
  parseIdList,
} from './utils';
export function ChannelsSettingsPanel() {
  const inputClassName = channelsInputClassName;
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
      setFeishuAccountsDraft(JSON.stringify((parsed as any).feishu?.accounts ?? {}, null, 2));
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
      setFeishuAccountsDraft(JSON.stringify((baselineClone as any).feishu?.accounts ?? {}, null, 2));
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
      setFeishuAccountsDraft(JSON.stringify((baselineClone as any).feishu?.accounts ?? {}, null, 2));
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
      setFeishuAccountsDraft(JSON.stringify((baselineClone as any).feishu?.accounts ?? {}, null, 2));
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
    const t = form?.telegram.botToken;
    if (!t) return;
    await navigator.clipboard.writeText(t).catch(() => {});
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }, [form?.telegram.botToken]);

  const copyFeishuSecret = useCallback(async () => {
    const t = (form as any)?.feishu?.appSecret as string | undefined;
    if (!t) return;
    await navigator.clipboard.writeText(t).catch(() => {});
    setFeishuCopied(true);
    window.setTimeout(() => setFeishuCopied(false), 2000);
  }, [form]);

  const copyFeishuWebhookConfig = useCallback(async () => {
    const fs = (form as any)?.feishu as ChannelsSettingsState['feishu'] | undefined;
    if (!fs) return;
    const payload = {
      connectionMode: fs.connectionMode,
      verificationToken: (fs as any).verificationToken || '',
      encryptKey: (fs as any).encryptKey || '',
      webhookHost: (fs as any).webhookHost || '',
      webhookPort: (fs as any).webhookPort || 0,
      webhookPath: (fs as any).webhookPath || '',
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
      const parsed = JSON.parse(raw) as unknown;
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error(ch.jsonObjectAccounts);
      }
      updateTelegram({ accounts: parsed as ChannelsSettingsState['telegram']['accounts'] });
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
      const parsed = JSON.parse(raw) as unknown;
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error(ch.jsonObjectAccounts);
      }
      updateWeixin({ accounts: parsed as ChannelsSettingsState['weixin']['accounts'] });
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
      const parsed = JSON.parse(raw) as unknown;
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error(ch.jsonObjectAccounts);
      }
      updateFeishu({ accounts: parsed as any });
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

  if (!hasToken) {
    return (
      <div className="mx-auto flex w-full max-w-app-main flex-col gap-3 px-4 py-8">
        <h1 className="text-lg font-semibold text-fg">{m.settingsSections.channels}</h1>
        <p className="text-sm text-fg-muted">{ch.needToken}</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-app-main px-4 py-8">
        <div className="h-8 w-48 animate-pulse rounded bg-surface-hover" />
        <div className="mt-6 h-32 animate-pulse rounded-xl bg-surface-hover" />
        <p className="mt-4 text-sm text-fg-muted">{ch.loading}</p>
      </div>
    );
  }

  if (!form) {
    return (
      <div className="mx-auto flex w-full max-w-app-main flex-col gap-3 px-4 py-8">
        <p className="text-sm text-fg-muted">{error ?? fetchError ?? ch.loadError}</p>
        <Button type="button" variant="secondary" onClick={() => void mutate()}>
          {ch.retry}
        </Button>
      </div>
    );
  }

  const tg = form.telegram;
  const wx = form.weixin;
  const fs = (form as any).feishu as ChannelsSettingsState['feishu'];
  const weixinConfigured = isWeixinConfigured(wx);
  const telegramConfigured = isTelegramConfigured(tg);
  const feishuConfigured = isFeishuConfigured(fs);

  const weixinMoreSettings = (
    <details className="group rounded-xl border border-edge-subtle bg-surface-base open:pb-3 dark:border-edge">
      <summary className="cursor-pointer list-none px-3 py-2.5 text-sm font-medium text-fg transition-colors hover:bg-surface-hover [&::-webkit-details-marker]:hidden">
        <span className="inline-flex items-center gap-2">
          <ChevronDown className="size-4 shrink-0 text-fg-muted transition-transform group-open:rotate-180" />
          {ch.advancedShow}
        </span>
      </summary>
      <div className="space-y-4 border-t border-edge-subtle px-3 pb-3 pt-3 dark:border-edge-subtle">
        <p className="text-xs leading-relaxed text-fg-muted">{ch.weixinAdvancedHint}</p>
        <label className="flex cursor-pointer items-start gap-2 text-sm text-fg">
          <input
            type="checkbox"
            className="ui-checkbox mt-0.5"
            checked={wx.enabled}
            onChange={(e) => updateWeixin({ enabled: e.target.checked })}
          />
          <span>{ch.enableWeixinAria}</span>
        </label>
        <div className="[&>div]:border-0 [&>div]:pt-0">
          <WeixinAdvanced
            wx={wx}
            updateWeixin={updateWeixin}
            ch={ch}
            dmOpts={dmOpts}
            streamOpts={streamOpts}
            wxAccountsDraft={wxAccountsDraft}
            setWxAccountsDraft={setWxAccountsDraft}
            wxAccountsError={wxAccountsError}
            onWxAccountsBlur={onWxAccountsBlur}
            channelAgentRoutesWx={form.channelAgentRoutes.weixin}
            defaultAgentId={form.defaultAgentId}
            agentItems={chatAgents?.items ?? []}
            onAgentRouteChange={(acc, aid) => updateChannelAgentRoute('weixin', acc, aid)}
            routingDisabled={saving}
          />
        </div>
        <Button
          type="button"
          variant="primary"
          className="w-full"
          disabled={!dirty || saving}
          onClick={async () => {
            await save();
          }}
        >
          {saving ? ch.saving : ch.save}
        </Button>
      </div>
    </details>
  );

  const pageBody = (
    <>
      <header className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold tracking-tight text-fg">{m.settingsSections.channels}</h1>
        <p className="mt-1 text-sm text-fg-muted">{ch.subtitle}</p>
        <a
          href={docsGuidePageUrl(language, 'channels')}
          target="_blank"
          rel="noreferrer"
          className="mt-1 inline-flex items-center gap-1 text-sm text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          {ch.docsLink}
          <ExternalLink className="size-3.5" />
        </a>
      </header>

      {dirty ? <p className="text-xs text-amber-800 dark:text-amber-200">{ch.unsavedHint}</p> : null}
      {saveOk ? <p className="text-xs text-fg-muted">{ch.saved}</p> : null}
      {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}
      {weixinSuccessBanner ? <p className="text-xs text-accent">{weixinSuccessBanner}</p> : null}

      <div className="flex flex-col gap-3">
        <ChannelImHubCard
          icon={<MessageSquare className="size-6 text-accent" strokeWidth={1.75} />}
          title={ch.weixinTitle}
          subtitle={ch.weixinSubtitle}
          configured={weixinConfigured}
          enabled={wx.enabled}
          toggleDisabled={saving}
          onToggle={(next) => void toggleChannelEnabled('weixin', next)}
          onConfigure={() => setWeixinModalOpen(true)}
          onEdit={() => setWeixinModalOpen(true)}
          onRemove={() => setRemoveTarget('weixin')}
          ch={ch}
        />
        <ChannelImHubCard
          icon={<Send className="size-6 text-accent" strokeWidth={1.75} />}
          title={ch.telegramTitle}
          subtitle={ch.telegramSubtitle}
          configured={telegramConfigured}
          enabled={tg.enabled}
          toggleDisabled={saving}
          onToggle={(next) => void toggleChannelEnabled('telegram', next)}
          onConfigure={() => setTelegramModalOpen(true)}
          onEdit={() => setTelegramModalOpen(true)}
          onRemove={() => setRemoveTarget('telegram')}
          ch={ch}
        />
        <ChannelImHubCard
          icon={<MessageSquare className="size-6 text-accent" strokeWidth={1.75} />}
          title={ch.feishuTitle}
          subtitle={ch.feishuSubtitle}
          configured={feishuConfigured}
          enabled={fs.enabled}
          toggleDisabled={saving}
          onToggle={(next) => void toggleChannelEnabled('feishu', next)}
          onConfigure={() => setFeishuModalOpen(true)}
          onEdit={() => setFeishuModalOpen(true)}
          onRemove={() => setRemoveTarget('feishu')}
          ch={ch}
        />
      </div>

      <WeixinQrLoginDialog
        open={weixinModalOpen}
        onOpenChange={setWeixinModalOpen}
        ch={ch}
        onLoginSuccess={async () => {
          await mutate();
          setWeixinSuccessBanner(ch.weixinQrLoginSuccess);
          window.setTimeout(() => setWeixinSuccessBanner(null), 4000);
        }}
        moreSettings={weixinMoreSettings}
      />

      <Dialog.Root open={telegramModalOpen} onOpenChange={setTelegramModalOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="xopc-dialog-overlay fixed inset-0 z-[60] bg-scrim backdrop-blur-[1px]" />
          <Dialog.Content
            className={cn(
              'fixed left-1/2 top-1/2 z-[60] max-h-[min(90vh,48rem)] w-[min(100%-2rem,36rem)] -translate-x-1/2 -translate-y-1/2',
              'overflow-y-auto rounded-2xl border border-edge bg-surface-panel p-6 shadow-popover outline-none dark:border-edge',
            )}
            onOpenAutoFocus={(e) => e.preventDefault()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <Dialog.Title className="text-lg font-semibold tracking-tight text-fg">{ch.telegramTitle}</Dialog.Title>
                <Dialog.Description className="mt-1 text-sm text-fg-muted">{ch.telegramSubtitle}</Dialog.Description>
              </div>
              <Dialog.Close asChild>
                <button
                  type="button"
                  className="rounded-lg p-1.5 text-fg-muted hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                  aria-label={ch.modalCancel}
                >
                  <X className="size-4" />
                </button>
              </Dialog.Close>
            </div>

            <label className="mt-6 flex cursor-pointer items-center gap-2 text-sm text-fg">
              <input
                type="checkbox"
                className="ui-checkbox"
                checked={tg.enabled}
                onChange={(e) => updateTelegram({ enabled: e.target.checked })}
              />
              <span>{ch.enableTelegramAria}</span>
            </label>

            <div className="mt-6 space-y-4">
              <div className="flex flex-col gap-1.5">
                <FieldLabel>
                  {ch.telegramToken}
                  <span className="text-red-600 dark:text-red-400"> *</span>
                </FieldLabel>
                <div className="flex flex-wrap gap-2">
                  <input
                    className={cn(inputClassName(), 'min-w-0 flex-1 font-mono text-xs')}
                    type={showToken ? 'text' : 'password'}
                    autoComplete="off"
                    readOnly={!showToken && Boolean(tg.botToken)}
                    value={
                      showToken
                        ? tg.botToken
                        : tg.botToken
                          ? '*'.repeat(Math.max(1, tg.botToken.length))
                          : ''
                    }
                    onChange={(e) => {
                      if (!showToken && tg.botToken) return;
                      updateTelegram({ botToken: e.target.value });
                    }}
                    placeholder="123456789:ABCdefGHIjklMNOpqrsTUVwxyz"
                  />
                  {tg.botToken ? (
                    <Button type="button" variant="secondary" className="px-2 py-1 text-xs" onClick={() => void copyToken()}>
                      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                      {copied ? ch.copied : ch.copy}
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    variant="secondary"
                    className="px-2 py-1 text-xs"
                    onClick={() => setShowToken((s) => !s)}
                  >
                    {showToken ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                    {showToken ? ch.hide : ch.show}
                  </Button>
                </div>
                <FieldHint>{ch.telegramTokenDesc}</FieldHint>
              </div>

              <div className="flex flex-col gap-1.5">
                <FieldLabel>{ch.allowFromDm}</FieldLabel>
                <textarea
                  className={cn(inputClassName(), 'min-h-[2.75rem] resize-y font-mono text-xs')}
                  rows={2}
                  placeholder="123456789, 987654321"
                  value={joinAllowFrom(tg.allowFrom)}
                  onChange={(e) => updateTelegram({ allowFrom: parseIdList(e.target.value) })}
                />
                <FieldHint>{ch.allowFromDmDesc}</FieldHint>
              </div>

              {form ? (
                <ChannelAgentRoutingBlock
                  accountIds={telegramRoutingAccountIds(tg)}
                  routes={form.channelAgentRoutes.telegram}
                  defaultAgentId={form.defaultAgentId}
                  agentItems={chatAgents?.items ?? []}
                  disabled={saving}
                  onChange={(acc, aid) => updateChannelAgentRoute('telegram', acc, aid)}
                  ch={ch}
                />
              ) : null}

              <Button
                type="button"
                variant="ghost"
                className="-ml-2 h-auto justify-start px-2 py-1 text-sm text-fg-muted hover:text-fg"
                onClick={() => setTgAdvanced((a) => !a)}
              >
                <ChevronDown className={cn('mr-1 size-4 transition-transform', tgAdvanced && 'rotate-180')} />
                {tgAdvanced ? ch.advancedHide : ch.advancedShow}
              </Button>

              {tgAdvanced ? (
                <TelegramAdvanced
                  tg={tg}
                  updateTelegram={updateTelegram}
                  ch={ch}
                  dmOpts={dmOpts}
                  groupOpts={groupOpts}
                  replyOpts={replyOpts}
                  streamOpts={streamOpts}
                  tgAccountsDraft={tgAccountsDraft}
                  setTgAccountsDraft={setTgAccountsDraft}
                  tgAccountsError={tgAccountsError}
                  onTgAccountsBlur={onTgAccountsBlur}
                />
              ) : null}
            </div>

            <div className="mt-8 flex flex-wrap justify-end gap-2 border-t border-edge-subtle pt-4 dark:border-edge-subtle">
              <Button type="button" variant="secondary" onClick={() => setTelegramModalOpen(false)}>
                {ch.modalCancel}
              </Button>
              <Button
                type="button"
                variant="primary"
                disabled={!dirty || saving}
                onClick={async () => {
                  const ok = await save();
                  if (ok) setTelegramModalOpen(false);
                }}
              >
                {saving ? ch.saving : ch.save}
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root open={feishuModalOpen} onOpenChange={setFeishuModalOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="xopc-dialog-overlay fixed inset-0 z-[60] bg-scrim backdrop-blur-[1px]" />
          <Dialog.Content
            className={cn(
              'fixed left-1/2 top-1/2 z-[60] max-h-[min(90vh,48rem)] w-[min(100%-2rem,36rem)] -translate-x-1/2 -translate-y-1/2',
              'overflow-y-auto rounded-2xl border border-edge bg-surface-panel p-6 shadow-popover outline-none dark:border-edge',
            )}
            onOpenAutoFocus={(e) => e.preventDefault()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <Dialog.Title className="text-lg font-semibold tracking-tight text-fg">{ch.feishuTitle}</Dialog.Title>
                <Dialog.Description className="mt-1 text-sm text-fg-muted">{ch.feishuSubtitle}</Dialog.Description>
              </div>
              <Dialog.Close asChild>
                <button
                  type="button"
                  className="rounded-lg p-1.5 text-fg-muted hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                  aria-label={ch.modalCancel}
                >
                  <X className="size-4" />
                </button>
              </Dialog.Close>
            </div>

            <label className="mt-6 flex cursor-pointer items-center gap-2 text-sm text-fg">
              <input
                type="checkbox"
                className="ui-checkbox"
                checked={fs.enabled}
                onChange={(e) => updateFeishu({ enabled: e.target.checked })}
              />
              <span>{ch.enableFeishuAria}</span>
            </label>

            <div className="mt-6 space-y-4">
              <div className="flex flex-col gap-1.5">
                <FieldLabel>
                  {ch.feishuAppId}
                  <span className="text-red-600 dark:text-red-400"> *</span>
                </FieldLabel>
                <input
                  className={cn(inputClassName(), 'min-w-0 flex-1 font-mono text-xs')}
                  value={fs.appId}
                  onChange={(e) => updateFeishu({ appId: e.target.value })}
                  placeholder="cli_xxx"
                />
                <FieldHint>{ch.feishuAppIdDesc}</FieldHint>
              </div>

              <div className="flex flex-col gap-1.5">
                <FieldLabel>
                  {ch.feishuAppSecret}
                  <span className="text-red-600 dark:text-red-400"> *</span>
                </FieldLabel>
                <div className="flex flex-wrap gap-2">
                  <input
                    className={cn(inputClassName(), 'min-w-0 flex-1 font-mono text-xs')}
                    type={showFeishuSecret ? 'text' : 'password'}
                    autoComplete="off"
                    readOnly={!showFeishuSecret && Boolean(fs.appSecret)}
                    value={
                      showFeishuSecret
                        ? fs.appSecret
                        : fs.appSecret
                          ? '*'.repeat(Math.max(1, fs.appSecret.length))
                          : ''
                    }
                    onChange={(e) => {
                      if (!showFeishuSecret && fs.appSecret) return;
                      updateFeishu({ appSecret: e.target.value });
                    }}
                    placeholder="••••••••"
                  />
                  {fs.appSecret ? (
                    <Button
                      type="button"
                      variant="secondary"
                      className="px-2 py-1 text-xs"
                      onClick={() => void copyFeishuSecret()}
                    >
                      {feishuCopied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                      {feishuCopied ? ch.copied : ch.copy}
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    variant="secondary"
                    className="px-2 py-1 text-xs"
                    onClick={() => setShowFeishuSecret((s) => !s)}
                  >
                    {showFeishuSecret ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                    {showFeishuSecret ? ch.hide : ch.show}
                  </Button>
                </div>
                <FieldHint>{ch.feishuAppSecretDesc}</FieldHint>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <FieldLabel>{ch.feishuDomain}</FieldLabel>
                  <select
                    className={inputClassName()}
                    value={String(fs.domain || 'feishu')}
                    onChange={(e) => updateFeishu({ domain: e.target.value })}
                  >
                    <option value="feishu">feishu</option>
                    <option value="lark">lark</option>
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <FieldLabel>{ch.connectionMode}</FieldLabel>
                  <select
                    className={inputClassName()}
                    value={fs.connectionMode}
                    onChange={(e) => updateFeishu({ connectionMode: e.target.value as any })}
                  >
                    <option value="websocket">websocket</option>
                    <option value="webhook">webhook</option>
                  </select>
                  <FieldHint>{ch.connectionModeDesc}</FieldHint>
                </div>
              </div>

              {fs.connectionMode === 'webhook' ? (
                <div className="rounded-xl border border-edge-subtle bg-surface px-4 py-3 dark:border-edge-subtle">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-medium text-fg">{ch.webhookTitle}</div>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        className="px-2 py-1 text-xs"
                        onClick={() => setShowFeishuWebhookSecrets((s) => !s)}
                      >
                        {showFeishuWebhookSecrets ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                        {showFeishuWebhookSecrets ? ch.hide : ch.show}
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        className="px-2 py-1 text-xs"
                        onClick={() => void copyFeishuWebhookConfig()}
                      >
                        {feishuWebhookCopied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                        {feishuWebhookCopied ? ch.copied : ch.copy}
                      </Button>
                    </div>
                  </div>

                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <div className="flex flex-col gap-1.5">
                      <FieldLabel>{ch.verificationToken}</FieldLabel>
                      <input
                        className={cn(inputClassName(), 'min-w-0 flex-1 font-mono text-xs')}
                        type={showFeishuWebhookSecrets ? 'text' : 'password'}
                        autoComplete="off"
                        value={fs.verificationToken ?? ''}
                        onChange={(e) => updateFeishu({ verificationToken: e.target.value })}
                      />
                      <FieldHint>{ch.verificationTokenDesc}</FieldHint>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <FieldLabel>{ch.encryptKey}</FieldLabel>
                      <input
                        className={cn(inputClassName(), 'min-w-0 flex-1 font-mono text-xs')}
                        type={showFeishuWebhookSecrets ? 'text' : 'password'}
                        autoComplete="off"
                        value={fs.encryptKey ?? ''}
                        onChange={(e) => updateFeishu({ encryptKey: e.target.value })}
                      />
                      <FieldHint>{ch.encryptKeyDesc}</FieldHint>
                    </div>
                  </div>

                  <div className="mt-3 grid gap-3 sm:grid-cols-3">
                    <div className="flex flex-col gap-1.5 sm:col-span-2">
                      <FieldLabel>{ch.webhookHost}</FieldLabel>
                      <input
                        className={cn(inputClassName(), 'min-w-0 flex-1 font-mono text-xs')}
                        value={fs.webhookHost ?? ''}
                        onChange={(e) => updateFeishu({ webhookHost: e.target.value })}
                        placeholder="127.0.0.1"
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <FieldLabel>{ch.webhookPort}</FieldLabel>
                      <input
                        className={cn(inputClassName(), 'min-w-0 flex-1 font-mono text-xs')}
                        type="number"
                        inputMode="numeric"
                        value={String(fs.webhookPort ?? '')}
                        onChange={(e) =>
                          updateFeishu({ webhookPort: Number(e.target.value || '0') || 0 })
                        }
                        placeholder="3000"
                      />
                    </div>
                  </div>

                  <div className="mt-3 flex flex-col gap-1.5">
                    <FieldLabel>{ch.webhookPath}</FieldLabel>
                    <input
                      className={cn(inputClassName(), 'min-w-0 flex-1 font-mono text-xs')}
                      value={fs.webhookPath ?? ''}
                      onChange={(e) => updateFeishu({ webhookPath: e.target.value })}
                      placeholder="/feishu/events"
                    />
                    <FieldHint>{ch.webhookPathDesc}</FieldHint>
                  </div>
                </div>
              ) : null}

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <FieldLabel>{ch.renderMode}</FieldLabel>
                  <select
                    className={inputClassName()}
                    value={fs.renderMode}
                    onChange={(e) => updateFeishu({ renderMode: e.target.value as any })}
                  >
                    <option value="auto">auto</option>
                    <option value="raw">raw</option>
                    <option value="card">card</option>
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <FieldLabel>{ch.reactionNotifications}</FieldLabel>
                  <select
                    className={inputClassName()}
                    value={fs.reactionNotifications}
                    onChange={(e) => updateFeishu({ reactionNotifications: e.target.value as any })}
                  >
                    <option value="off">off</option>
                    <option value="own">own</option>
                    <option value="all">all</option>
                  </select>
                </div>
              </div>

              <label className="flex cursor-pointer items-center gap-2 text-sm text-fg">
                <input
                  type="checkbox"
                  className="ui-checkbox"
                  checked={fs.streaming}
                  onChange={(e) => updateFeishu({ streaming: e.target.checked })}
                />
                {ch.enableStreaming}
              </label>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <FieldLabel>{ch.dmPolicy}</FieldLabel>
                  <select
                    className={inputClassName()}
                    value={fs.dmPolicy}
                    onChange={(e) => updateFeishu({ dmPolicy: e.target.value as any })}
                  >
                    {dmOpts.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <FieldLabel>{ch.groupPolicy}</FieldLabel>
                  <select
                    className={inputClassName()}
                    value={fs.groupPolicy}
                    onChange={(e) => updateFeishu({ groupPolicy: e.target.value as any })}
                  >
                    {groupOpts.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <label className="flex cursor-pointer items-center gap-2 text-sm text-fg">
                <input
                  type="checkbox"
                  className="ui-checkbox"
                  checked={fs.requireMention}
                  onChange={(e) => updateFeishu({ requireMention: e.target.checked })}
                />
                {ch.requireMention}
              </label>

              <div className="flex flex-col gap-1.5">
                <FieldLabel>{ch.allowFromDm}</FieldLabel>
                <textarea
                  className={cn(inputClassName(), 'min-h-[2.75rem] resize-y font-mono text-xs')}
                  rows={2}
                  placeholder="ou_xxx, on_xxx"
                  value={joinAllowFrom(fs.allowFrom)}
                  onChange={(e) => updateFeishu({ allowFrom: parseIdList(e.target.value) })}
                />
                <FieldHint>{ch.allowFromDmDesc}</FieldHint>
              </div>

              <div className="flex flex-col gap-1.5">
                <FieldLabel>{ch.allowFromGroups}</FieldLabel>
                <textarea
                  className={cn(inputClassName(), 'min-h-[2.75rem] resize-y font-mono text-xs')}
                  rows={2}
                  placeholder="oc_xxx, oc_yyy"
                  value={joinAllowFrom(fs.groupAllowFrom)}
                  onChange={(e) => updateFeishu({ groupAllowFrom: parseIdList(e.target.value) })}
                />
                <FieldHint>{ch.allowFromGroupsDesc}</FieldHint>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <FieldLabel>{ch.historyLimit}</FieldLabel>
                  <input
                    className={cn(inputClassName(), 'min-w-0 flex-1 font-mono text-xs')}
                    type="number"
                    inputMode="numeric"
                    value={String(fs.historyLimit)}
                    onChange={(e) => updateFeishu({ historyLimit: Number(e.target.value || '0') || 0 })}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <FieldLabel>{ch.textChunkLimit}</FieldLabel>
                  <input
                    className={cn(inputClassName(), 'min-w-0 flex-1 font-mono text-xs')}
                    type="number"
                    inputMode="numeric"
                    value={String(fs.textChunkLimit)}
                    onChange={(e) => updateFeishu({ textChunkLimit: Number(e.target.value || '0') || 0 })}
                  />
                </div>
              </div>

              <div className="rounded-xl border border-edge-subtle bg-surface px-4 py-3 dark:border-edge-subtle">
                <div className="text-sm font-medium text-fg">{ch.feishuToolsTitle}</div>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {(
                    [
                      ['doc', ch.feishuToolDoc],
                      ['wiki', ch.feishuToolWiki],
                      ['drive', ch.feishuToolDrive],
                      ['perm', ch.feishuToolPerm],
                      ['bitable', ch.feishuToolBitable],
                      ['scopes', ch.feishuToolScopes],
                    ] as const
                  ).map(([key, label]) => (
                    <label key={key} className="flex cursor-pointer items-center gap-2 text-sm text-fg">
                      <input
                        type="checkbox"
                        className="ui-checkbox"
                        checked={Boolean(fs.tools?.[key])}
                        onChange={(e) =>
                          updateFeishu({
                            tools: { ...fs.tools, [key]: e.target.checked },
                          })
                        }
                      />
                      {label}
                    </label>
                  ))}
                </div>
                <div className="mt-2">
                  <FieldHint>{ch.feishuToolsDesc}</FieldHint>
                </div>
              </div>

              <div className="rounded-xl border border-edge-subtle bg-surface px-4 py-3 dark:border-edge-subtle">
                <div className="text-sm font-medium text-fg">{ch.feishuActionsTitle}</div>
                <label className="mt-2 flex cursor-pointer items-center gap-2 text-sm text-fg">
                  <input
                    type="checkbox"
                    className="ui-checkbox"
                    checked={Boolean(fs.actions?.reactions)}
                    onChange={(e) =>
                      updateFeishu({
                        actions: { ...fs.actions, reactions: e.target.checked },
                      })
                    }
                  />
                  {ch.feishuActionReactions}
                </label>
              </div>

              {form ? (
                <ChannelAgentRoutingBlock
                  accountIds={feishuRoutingAccountIds(fs)}
                  routes={(form as any).channelAgentRoutes.feishu}
                  defaultAgentId={form.defaultAgentId}
                  agentItems={chatAgents?.items ?? []}
                  disabled={saving}
                  onChange={(acc, aid) => updateChannelAgentRoute('feishu', acc, aid)}
                  ch={ch}
                />
              ) : null}

              <div className="flex flex-col gap-1.5">
                <FieldLabel>{ch.multiAccountJson}</FieldLabel>
                <textarea
                  className={cn(inputClassName(), 'min-h-[140px] resize-y font-mono text-xs')}
                  spellCheck={false}
                  value={feishuAccountsDraft}
                  onChange={(e) => setFeishuAccountsDraft(e.target.value)}
                  onBlur={onFeishuAccountsBlur}
                  placeholder='{ "default": { "appId": "...", "appSecret": "...", "enabled": true } }'
                />
                {feishuAccountsError ? (
                  <p className="text-xs text-red-600 dark:text-red-400">{feishuAccountsError}</p>
                ) : (
                  <FieldHint>{ch.multiAccountJsonDesc}</FieldHint>
                )}
              </div>
            </div>

            <div className="mt-8 flex flex-wrap justify-end gap-2 border-t border-edge-subtle pt-4 dark:border-edge-subtle">
              <Button type="button" variant="secondary" onClick={() => setFeishuModalOpen(false)}>
                {ch.modalCancel}
              </Button>
              <Button
                type="button"
                variant="primary"
                disabled={!dirty || saving}
                onClick={async () => {
                  const ok = await save();
                  if (ok) setFeishuModalOpen(false);
                }}
              >
                {saving ? ch.saving : ch.save}
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root open={removeTarget !== null} onOpenChange={(o) => !o && setRemoveTarget(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="xopc-dialog-overlay fixed inset-0 z-[70] bg-scrim backdrop-blur-[1px]" />
          <Dialog.Content
            className={cn(
              'fixed left-1/2 top-1/2 z-[70] w-[min(100%-2rem,28rem)] -translate-x-1/2 -translate-y-1/2',
              'rounded-2xl border border-edge bg-surface-panel p-6 shadow-popover outline-none dark:border-edge',
            )}
            onOpenAutoFocus={(e) => e.preventDefault()}
          >
            <Dialog.Title className="text-base font-semibold text-fg">{ch.removeChannelTitle}</Dialog.Title>
            <Dialog.Description className="mt-2 text-sm text-fg-muted">
              {removeTarget
                ? ch.removeChannelConfirm.replace(
                    '{{name}}',
                    removeTarget === 'weixin'
                      ? ch.weixinTitle
                      : removeTarget === 'telegram'
                        ? ch.telegramTitle
                        : ch.feishuTitle,
                  )
                : '\u00a0'}
            </Dialog.Description>
            <div className="mt-6 flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setRemoveTarget(null)}>
                {ch.modalCancel}
              </Button>
              <Button
                type="button"
                variant="secondary"
                className="border-danger/40 bg-danger text-white hover:bg-danger/90 dark:border-danger/40"
                disabled={saving}
                onClick={() => void removeChannel()}
              >
                {saving ? ch.saving : ch.removeChannelAction}
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );

  return <div className="mx-auto flex w-full max-w-app-main flex-col gap-6 px-4 py-6">{pageBody}</div>;
}
