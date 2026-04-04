import * as Dialog from '@radix-ui/react-dialog';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import {
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Send,
  Trash2,
  X,
} from 'lucide-react';
import QRCode from 'qrcode';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import {
  defaultChannelsState,
  fetchChannelsSettings,
  fetchWeixinGatewayQrLoginStart,
  fetchWeixinGatewayQrLoginStatus,
  patchChannelsSettings,
  type ChannelsSettingsState,
  type DmPolicy,
  type GroupPolicy,
  type ReplyToMode,
  type StreamMode,
} from '@/features/settings/channels-config-api';
import { nativeSelectMaxWidthClass, selectControlBaseClass, settingsInputFocusClass } from '@/lib/form-field-width';
import { cn } from '@/lib/cn';
import { messages, type ChannelsSettingsMessages } from '@/i18n/messages';
import { docsGuidePageUrl } from '@/navigation';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';

function inputClassName(): string {
  return cn(
    'w-full rounded-lg border border-edge bg-surface-panel px-3 py-2 text-sm text-fg',
    'placeholder:text-fg-subtle',
    settingsInputFocusClass,
    'dark:border-edge',
  );
}

function selectClassName(): string {
  return cn(selectControlBaseClass, nativeSelectMaxWidthClass);
}

function parseIdList(raw: string): (string | number)[] {
  return raw
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => (/^-?\d+$/.test(s) ? Number(s) : s));
}

function joinAllowFrom(ids: (string | number)[]): string {
  return ids.map(String).join(', ');
}

function isTelegramConfigured(tg: ChannelsSettingsState['telegram']): boolean {
  return Boolean(tg.botToken?.trim()) || Object.keys(tg.accounts ?? {}).length > 0;
}

function isWeixinConfigured(wx: ChannelsSettingsState['weixin']): boolean {
  return wx.enabled || Object.keys(wx.accounts ?? {}).length > 0 || wx.allowFrom.length > 0;
}

function FieldLabel({ children }: { children: ReactNode }) {
  return <div className="text-sm font-medium text-fg">{children}</div>;
}

function FieldHint({ children }: { children: ReactNode }) {
  return <p className="text-xs leading-relaxed text-fg-subtle">{children}</p>;
}

type SelectFieldProps<T extends string> = {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
};

function SelectField<T extends string>({ label, value, onChange, options }: SelectFieldProps<T>) {
  return (
    <div className="flex flex-col gap-1.5">
      <FieldLabel>{label}</FieldLabel>
      <select className={selectClassName()} value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function WeixinQrLoginDialog({
  open,
  onOpenChange,
  ch,
  onLoginSuccess,
  moreSettings,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ch: ChannelsSettingsMessages;
  onLoginSuccess: () => void | Promise<void>;
  moreSettings?: ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const [sessionKey, setSessionKey] = useState<string | null>(null);
  const [qrcodeUrl, setQrcodeUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  /** PNG data URL from encoding `qrcodeUrl` (ilink payload string), not a remote image URL. */
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [qrGenFailed, setQrGenFailed] = useState(false);

  const start = useCallback(async () => {
    setError(null);
    setHint(null);
    setSessionKey(null);
    setBusy(true);
    try {
      const r = await fetchWeixinGatewayQrLoginStart();
      setQrcodeUrl(r.qrcodeUrl);
      setSessionKey(r.sessionKey);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Start failed');
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (!open) {
      setSessionKey(null);
      setQrcodeUrl(null);
      setError(null);
      setQrDataUrl(null);
      setQrGenFailed(false);
      setHint(null);
      return;
    }
    void start();
  }, [open, start]);

  useEffect(() => {
    if (!sessionKey) return;
    let cancelled = false;
    let intervalId: number | undefined;

    const poll = async () => {
      try {
        const st = await fetchWeixinGatewayQrLoginStatus(sessionKey);
        if (cancelled) return;
        if (st.phase === 'polling') {
          setQrcodeUrl(st.qrcodeUrl);
          if (st.qrStatus === 'scaned') {
            setHint(ch.weixinQrLoginScanned);
          } else {
            setHint(null);
          }
          return;
        }
        if (st.phase === 'done') {
          if (intervalId !== undefined) {
            window.clearInterval(intervalId);
            intervalId = undefined;
          }
          setSessionKey(null);
          if (st.ok) {
            setQrcodeUrl(null);
            onOpenChange(false);
            await onLoginSuccess();
          } else {
            setError(st.message);
            setQrcodeUrl(null);
          }
          return;
        }
        if (st.phase === 'unknown') {
          setHint(null);
        }
      } catch (e) {
        if (!cancelled) {
          if (intervalId !== undefined) {
            window.clearInterval(intervalId);
          }
          setError(e instanceof Error ? e.message : 'Request failed');
          setSessionKey(null);
          setQrcodeUrl(null);
        }
      }
    };

    intervalId = window.setInterval(() => void poll(), 2000);
    void poll();
    return () => {
      cancelled = true;
      if (intervalId !== undefined) {
        window.clearInterval(intervalId);
      }
    };
  }, [sessionKey, ch.weixinQrLoginScanned, ch.weixinQrLoginSuccess, onLoginSuccess, onOpenChange]);

  useEffect(() => {
    if (!qrcodeUrl) {
      setQrDataUrl(null);
      setQrGenFailed(false);
      return;
    }
    let cancelled = false;
    setQrGenFailed(false);
    void QRCode.toDataURL(qrcodeUrl, {
      width: 208,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: { dark: '#000000ff', light: '#ffffffff' },
    })
      .then((url) => {
        if (!cancelled) setQrDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) {
          setQrGenFailed(true);
          setQrDataUrl(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [qrcodeUrl]);

  const showQr = Boolean(qrcodeUrl && sessionKey);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="xopcbot-dialog-overlay fixed inset-0 z-[60] bg-scrim backdrop-blur-[1px]" />
        <Dialog.Content
          className={cn(
            'fixed left-1/2 top-1/2 z-[60] max-h-[min(90vh,52rem)] w-[min(100%-2rem,32rem)] -translate-x-1/2 -translate-y-1/2',
            'overflow-y-auto rounded-2xl border border-edge bg-surface-panel p-6 shadow-xl outline-none dark:border-edge',
          )}
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
            <Dialog.Close asChild>
              <button
                type="button"
                className="absolute right-3 top-3 z-20 rounded-lg p-1.5 text-fg-muted hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                aria-label={ch.weixinQrModalCloseAria}
              >
                <X className="size-4" />
              </button>
            </Dialog.Close>

            <Dialog.Title className="sr-only">{ch.weixinQrModalTitle}</Dialog.Title>
            <Dialog.Description className="sr-only">{ch.weixinQrModalSubtitle}</Dialog.Description>

            <div className="text-center">
              <p className="text-lg font-semibold tracking-tight text-fg">{ch.weixinQrModalTitle}</p>
              <p className="mt-1.5 text-sm text-fg-muted">{ch.weixinQrModalSubtitle}</p>
            </div>

            <div className="mt-6 flex min-h-[200px] flex-col items-center justify-center">
              {busy && !showQr ? (
                <p className="text-sm text-fg-muted">{ch.weixinQrLoginBusy}</p>
              ) : null}
              {error ? (
                <p className="text-center text-sm text-red-600 dark:text-red-400">{error}</p>
              ) : null}
              {hint && !error ? <p className="mb-3 text-center text-sm text-accent">{hint}</p> : null}
              {showQr && qrcodeUrl && !error ? (
                <div className="flex w-full flex-col items-center gap-3">
                  {qrDataUrl && !qrGenFailed ? (
                    <img
                      src={qrDataUrl}
                      alt=""
                      className="h-52 w-52 rounded-lg border border-edge-subtle bg-white object-contain p-3 dark:border-edge"
                    />
                  ) : null}
                  {!qrDataUrl && !qrGenFailed ? (
                    <p className="text-sm text-fg-muted">{ch.weixinQrEncoding}</p>
                  ) : null}
                  {qrGenFailed ? (
                    <div className="flex w-full flex-col items-center gap-3">
                      <p className="max-w-[16rem] text-center text-sm text-fg-muted">{ch.weixinQrImageError}</p>
                      <a
                        href={qrcodeUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 text-sm text-accent underline-offset-2 hover:underline"
                      >
                        <ExternalLink className="size-3.5 shrink-0" />
                        {ch.weixinQrOpenLink}
                      </a>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>

            <div className="mt-6">
              <Button
                type="button"
                variant="secondary"
                className="h-11 w-full rounded-full border-0 bg-fg text-surface-panel hover:opacity-90 dark:bg-fg dark:text-surface-panel"
                disabled={busy}
                onClick={() => void start()}
              >
                {busy ? ch.weixinQrLoginBusy : ch.weixinQrRegenerate}
              </Button>
            </div>

            {moreSettings ? (
              <div className="mt-6 border-t border-edge-subtle pt-4 dark:border-edge-subtle">{moreSettings}</div>
            ) : null}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
  );
}

type ChannelImHubCardProps = {
  icon: ReactNode;
  title: string;
  subtitle: string;
  configured: boolean;
  enabled: boolean;
  onToggle: (next: boolean) => void | Promise<void>;
  toggleDisabled: boolean;
  onConfigure: () => void;
  onEdit: () => void;
  onRemove: () => void;
  ch: ChannelsSettingsMessages;
};

function ChannelImHubCard({
  icon,
  title,
  subtitle,
  configured,
  enabled,
  onToggle,
  toggleDisabled,
  onConfigure,
  onEdit,
  onRemove,
  ch,
}: ChannelImHubCardProps) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-edge bg-surface-base px-4 py-4 dark:border-edge sm:flex-row sm:items-center sm:gap-4">
      <div className="flex min-w-0 flex-1 items-start gap-4">
        <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-surface-hover" aria-hidden>
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold text-fg">{title}</h2>
            {configured ? (
              <span className="inline-flex items-center rounded-full bg-success-soft px-2 py-0.5 text-xs font-medium text-success">
                {ch.hubConnectedBadge}
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-xs text-fg-muted">{subtitle}</p>
        </div>
      </div>

      {!configured ? (
        <div className="flex shrink-0 justify-end sm:justify-end">
          <Button type="button" variant="primary" className="shrink-0" onClick={onConfigure}>
            {ch.hubConfigureButton}
          </Button>
        </div>
      ) : (
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 sm:gap-3">
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <Button type="button" variant="ghost" className="size-9 shrink-0 p-0" aria-label={ch.menuMoreAria}>
                <MoreHorizontal className="size-5 text-fg-muted" strokeWidth={1.75} />
              </Button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                className="z-[70] min-w-[11rem] rounded-xl border border-edge bg-surface-panel p-1 shadow-popover dark:border-edge"
                sideOffset={6}
                align="end"
              >
                <DropdownMenu.Item
                  className="cursor-pointer rounded-lg px-3 py-2 text-sm text-fg outline-none hover:bg-surface-hover data-[highlighted]:bg-surface-hover"
                  onSelect={() => onEdit()}
                >
                  <span className="flex items-center gap-2">
                    <Pencil className="size-4 shrink-0 text-fg-muted" strokeWidth={1.75} />
                    {ch.menuEditConfig}
                  </span>
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  className="cursor-pointer rounded-lg px-3 py-2 text-sm text-danger outline-none hover:bg-surface-hover data-[highlighted]:bg-surface-hover"
                  onSelect={() => onRemove()}
                >
                  <span className="flex items-center gap-2">
                    <Trash2 className="size-4 shrink-0" strokeWidth={1.75} />
                    {ch.menuRemoveConfig}
                  </span>
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            aria-label={`${title} — ${ch.enableChannelAria}`}
            disabled={toggleDisabled}
            className={cn(
              'inline-flex h-6 w-10 shrink-0 items-center rounded-full border border-edge p-0.5 transition-colors',
              enabled ? 'justify-end bg-accent' : 'justify-start bg-surface-hover',
              toggleDisabled && 'cursor-not-allowed opacity-50',
            )}
            onClick={() => void onToggle(!enabled)}
          >
            <span className="size-4 rounded-full bg-surface-panel shadow-sm ring-1 ring-black/5 dark:ring-white/10" />
          </button>
        </div>
      )}
    </div>
  );
}

export function ChannelsSettingsPanel() {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const ch = m.channelsSettings;
  const token = useGatewayStore((st) => st.token);
  const hasToken = Boolean(token);

  const [form, setForm] = useState<ChannelsSettingsState | null>(null);
  const [baseline, setBaseline] = useState<ChannelsSettingsState | null>(null);
  const [loading, setLoading] = useState(true);
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

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchChannelsSettings();
      setForm(data);
      setBaseline(structuredClone(data));
      setTgAccountsDraft(JSON.stringify(data.telegram.accounts ?? {}, null, 2));
      setTgAccountsError('');
      setWxAccountsDraft(JSON.stringify(data.weixin.accounts ?? {}, null, 2));
      setWxAccountsError('');
      setSaveOk(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : ch.loadError);
      setForm(null);
      setBaseline(null);
    } finally {
      setLoading(false);
    }
  }, [ch.loadError]);

  useEffect(() => {
    if (!hasToken) {
      setLoading(false);
      setForm(null);
      setBaseline(null);
      return;
    }
    void load();
  }, [hasToken, load]);

  const dirty = useMemo(() => {
    if (!form || !baseline) return false;
    return JSON.stringify(form) !== JSON.stringify(baseline);
  }, [form, baseline]);

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
      await patchChannelsSettings(form);
      const next = structuredClone(form);
      setBaseline(next);
      setTgAccountsDraft(JSON.stringify(next.telegram.accounts ?? {}, null, 2));
      setTgAccountsError('');
      setWxAccountsDraft(JSON.stringify(next.weixin.accounts ?? {}, null, 2));
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
        await patchChannelsSettings(next);
        const synced = structuredClone(next);
        setBaseline(synced);
        setTgAccountsDraft(JSON.stringify(synced.telegram.accounts ?? {}, null, 2));
        setWxAccountsDraft(JSON.stringify(synced.weixin.accounts ?? {}, null, 2));
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
      await patchChannelsSettings(next);
      const synced = structuredClone(next);
      setForm(synced);
      setBaseline(synced);
      setTgAccountsDraft(JSON.stringify(synced.telegram.accounts ?? {}, null, 2));
      setWxAccountsDraft(JSON.stringify(synced.weixin.accounts ?? {}, null, 2));
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
        <p className="text-sm text-fg-muted">{error ?? ch.loadError}</p>
        <Button type="button" variant="secondary" onClick={() => void load()}>
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

  return (
    <div className="mx-auto flex w-full max-w-app-main flex-col gap-6 px-4 py-6">
      <header>
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
          await load();
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
              'overflow-y-auto rounded-2xl border border-edge bg-surface-panel p-6 shadow-xl outline-none dark:border-edge',
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
              'rounded-2xl border border-edge bg-surface-panel p-6 shadow-xl outline-none dark:border-edge',
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
    </div>
  );
}

function TelegramAdvanced({
  tg,
  updateTelegram,
  ch,
  dmOpts,
  groupOpts,
  replyOpts,
  streamOpts,
  tgAccountsDraft,
  setTgAccountsDraft,
  tgAccountsError,
  onTgAccountsBlur,
}: {
  tg: ChannelsSettingsState['telegram'];
  updateTelegram: (p: Partial<ChannelsSettingsState['telegram']>) => void;
  ch: ChannelsSettingsMessages;
  dmOpts: { value: DmPolicy; label: string }[];
  groupOpts: { value: GroupPolicy; label: string }[];
  replyOpts: { value: ReplyToMode; label: string }[];
  streamOpts: { value: StreamMode; label: string }[];
  tgAccountsDraft: string;
  setTgAccountsDraft: (s: string) => void;
  tgAccountsError: string;
  onTgAccountsBlur: () => void;
}) {
  return (
    <div className="space-y-4 border-t border-edge-subtle pt-4 dark:border-edge">
      <div className="flex flex-col gap-1.5">
        <FieldLabel>{ch.apiRoot}</FieldLabel>
        <input
          className={inputClassName()}
          value={tg.apiRoot}
          onChange={(e) => updateTelegram({ apiRoot: e.target.value })}
          placeholder="https://api.telegram.org"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <FieldLabel>{ch.proxy}</FieldLabel>
        <input
          className={inputClassName()}
          value={tg.proxy}
          onChange={(e) => updateTelegram({ proxy: e.target.value })}
          placeholder="http://proxy.example.com:8080"
        />
      </div>
      <SelectField label={ch.dmPolicy} value={tg.dmPolicy} onChange={(v) => updateTelegram({ dmPolicy: v })} options={dmOpts} />
      <SelectField
        label={ch.groupPolicy}
        value={tg.groupPolicy}
        onChange={(v) => updateTelegram({ groupPolicy: v })}
        options={groupOpts}
      />
      <SelectField
        label={ch.replyToMode}
        value={tg.replyToMode}
        onChange={(v) => updateTelegram({ replyToMode: v })}
        options={replyOpts}
      />
      <SelectField
        label={ch.streamMode}
        value={tg.streamMode}
        onChange={(v) => updateTelegram({ streamMode: v })}
        options={streamOpts}
      />
      <div className="flex flex-col gap-1.5">
        <FieldLabel>{ch.allowFromGroups}</FieldLabel>
        <textarea
          className={cn(inputClassName(), 'min-h-[2.75rem] resize-y font-mono text-xs')}
          rows={2}
          placeholder="-1001234567890"
          value={joinAllowFrom(tg.groupAllowFrom)}
          onChange={(e) => updateTelegram({ groupAllowFrom: parseIdList(e.target.value) })}
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <FieldLabel>{ch.historyLimit}</FieldLabel>
          <input
            type="number"
            min={10}
            max={200}
            className={inputClassName()}
            value={tg.historyLimit}
            onChange={(e) => updateTelegram({ historyLimit: parseInt(e.target.value, 10) || 50 })}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <FieldLabel>{ch.textChunkLimit}</FieldLabel>
          <input
            type="number"
            min={1000}
            max={10000}
            step={100}
            className={inputClassName()}
            value={tg.textChunkLimit}
            onChange={(e) => updateTelegram({ textChunkLimit: parseInt(e.target.value, 10) || 4000 })}
          />
        </div>
      </div>
      <label className="flex cursor-pointer items-center gap-2 text-sm text-fg">
        <input
          type="checkbox"
          className="ui-checkbox"
          checked={tg.debug}
          onChange={(e) => updateTelegram({ debug: e.target.checked })}
        />
        {ch.telegramDebug}
      </label>
      <div className="flex flex-col gap-1.5">
        <FieldLabel>{ch.multiAccountJson}</FieldLabel>
        <textarea
          className={cn(inputClassName(), 'min-h-[140px] resize-y font-mono text-xs')}
          spellCheck={false}
          value={tgAccountsDraft}
          onChange={(e) => setTgAccountsDraft(e.target.value)}
          onBlur={onTgAccountsBlur}
          placeholder='{ "personal": { "accountId": "personal", "botToken": "...", ... } }'
        />
        {tgAccountsError ? (
          <p className="text-xs text-red-600 dark:text-red-400">{tgAccountsError}</p>
        ) : (
          <FieldHint>{ch.multiAccountJsonDesc}</FieldHint>
        )}
      </div>
    </div>
  );
}

function WeixinAdvanced({
  wx,
  updateWeixin,
  ch,
  dmOpts,
  streamOpts,
  wxAccountsDraft,
  setWxAccountsDraft,
  wxAccountsError,
  onWxAccountsBlur,
}: {
  wx: ChannelsSettingsState['weixin'];
  updateWeixin: (p: Partial<ChannelsSettingsState['weixin']>) => void;
  ch: ChannelsSettingsMessages;
  dmOpts: { value: DmPolicy; label: string }[];
  streamOpts: { value: StreamMode; label: string }[];
  wxAccountsDraft: string;
  setWxAccountsDraft: (s: string) => void;
  wxAccountsError: string;
  onWxAccountsBlur: () => void;
}) {
  return (
    <div className="space-y-4 border-t border-edge-subtle pt-4 dark:border-edge">
      <div className="flex flex-col gap-1.5">
        <FieldLabel>{ch.weixinAllowFrom}</FieldLabel>
        <textarea
          className={cn(inputClassName(), 'min-h-[2.75rem] resize-y font-mono text-xs')}
          rows={2}
          placeholder="wxid_..., openid_..."
          value={wx.allowFrom.join(', ')}
          onChange={(e) =>
            updateWeixin({
              allowFrom: e.target.value
                .split(/[,\n]/)
                .map((s) => s.trim())
                .filter(Boolean),
            })
          }
        />
        <FieldHint>{ch.weixinAllowFromDesc}</FieldHint>
      </div>
      <SelectField label={ch.dmPolicy} value={wx.dmPolicy} onChange={(v) => updateWeixin({ dmPolicy: v })} options={dmOpts} />
      <SelectField
        label={ch.streamMode}
        value={wx.streamMode}
        onChange={(v) => updateWeixin({ streamMode: v })}
        options={streamOpts}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <FieldLabel>{ch.historyLimit}</FieldLabel>
          <input
            type="number"
            min={10}
            max={200}
            className={inputClassName()}
            value={wx.historyLimit}
            onChange={(e) => updateWeixin({ historyLimit: parseInt(e.target.value, 10) || 50 })}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <FieldLabel>{ch.textChunkLimit}</FieldLabel>
          <input
            type="number"
            min={1000}
            max={10000}
            step={100}
            className={inputClassName()}
            value={wx.textChunkLimit}
            onChange={(e) => updateWeixin({ textChunkLimit: parseInt(e.target.value, 10) || 4000 })}
          />
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <FieldLabel>{ch.weixinRouteTag}</FieldLabel>
        <input
          className={inputClassName()}
          value={wx.routeTag}
          onChange={(e) => updateWeixin({ routeTag: e.target.value })}
          placeholder={ch.routeTagPlaceholder}
        />
        <FieldHint>{ch.weixinRouteTagDesc}</FieldHint>
      </div>
      <label className="flex cursor-pointer items-center gap-2 text-sm text-fg">
        <input
          type="checkbox"
          className="ui-checkbox"
          checked={wx.debug}
          onChange={(e) => updateWeixin({ debug: e.target.checked })}
        />
        {ch.weixinDebug}
      </label>
      <FieldHint>{ch.weixinDebugDesc}</FieldHint>
      <div className="flex flex-col gap-1.5">
        <FieldLabel>{ch.weixinAccountsJson}</FieldLabel>
        <textarea
          className={cn(inputClassName(), 'min-h-[140px] resize-y font-mono text-xs')}
          spellCheck={false}
          value={wxAccountsDraft}
          onChange={(e) => setWxAccountsDraft(e.target.value)}
          onBlur={onWxAccountsBlur}
          placeholder='{ "personal": { "name": "...", "cdnBaseUrl": "...", "enabled": true } }'
        />
        {wxAccountsError ? (
          <p className="text-xs text-red-600 dark:text-red-400">{wxAccountsError}</p>
        ) : (
          <FieldHint>{ch.weixinAccountsJsonDesc}</FieldHint>
        )}
      </div>
    </div>
  );
}
