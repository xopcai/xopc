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
  const [removeTarget, setRemoveTarget] = useState<'weixin' | 'telegram' | null>(null);
  const [weixinSuccessBanner, setWeixinSuccessBanner] = useState<string | null>(null);
  const [tgAdvanced, setTgAdvanced] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [copied, setCopied] = useState(false);

  const [tgAccountsDraft, setTgAccountsDraft] = useState('');
  const [tgAccountsError, setTgAccountsError] = useState('');
  const [wxAccountsDraft, setWxAccountsDraft] = useState('');
  const [wxAccountsError, setWxAccountsError] = useState('');

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
      setSaveOk(false);
    }
  }, [hasToken, parsed, dirty]);

  const loading = Boolean(hasToken && isLoading && cfgData === undefined && !swrError);
  const fetchError =
    swrError instanceof Error ? swrError.message : swrError ? String(swrError) : null;

  const updateChannelAgentRoute = useCallback(
    (channel: 'telegram' | 'weixin', accountId: string, agentId: string) => {
      setForm((f) => {
        if (!f) return null;
        const k = channel === 'telegram' ? 'telegram' : 'weixin';
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
    async (which: 'weixin' | 'telegram', enabled: boolean) => {
      if (!form || saving) return;
      const prev = form;
      const next: ChannelsSettingsState =
        which === 'weixin'
          ? { ...form, weixin: { ...form.weixin, enabled } }
          : { ...form, telegram: { ...form.telegram, enabled } };
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
        : { ...form, telegram: defaults.telegram };
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
  const weixinConfigured = isWeixinConfigured(wx);
  const telegramConfigured = isTelegramConfigured(tg);

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
          <Dialog.Overlay className="xopcbot-dialog-overlay fixed inset-0 z-[60] bg-scrim backdrop-blur-[1px]" />
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
                <p className="mt-3 text-xs leading-relaxed text-fg-subtle whitespace-pre-line">{ch.telegramCliConfigHint}</p>
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
                    value={tg.botToken}
                    onChange={(e) => updateTelegram({ botToken: e.target.value })}
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

      <Dialog.Root open={removeTarget !== null} onOpenChange={(o) => !o && setRemoveTarget(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="xopcbot-dialog-overlay fixed inset-0 z-[70] bg-scrim backdrop-blur-[1px]" />
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
                    removeTarget === 'weixin' ? ch.weixinTitle : ch.telegramTitle,
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
