import { AlertCircle, Check, Copy, ExternalLink, Eye, EyeOff, Loader2, Server } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  fetchGatewaySettings,
  patchGatewaySettings,
  type GatewaySettingsState,
} from '@/features/settings/gateway-config-api';
import { cn } from '@/lib/cn';
import { messages, type GatewaySettingsMessages } from '@/i18n/messages';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';

const DOCS_URL = 'https://github.com/xopc/xopcbot/blob/main/docs/gateway.md';

function inputClassName(): string {
  return cn(
    'w-full rounded-lg border border-edge bg-surface-panel px-3 py-2 text-sm text-fg',
    'placeholder:text-fg-subtle focus:border-edge-strong focus:outline-none focus:ring-2 focus:ring-accent/30',
    'dark:border-edge',
  );
}

export function GatewaySettingsPanel() {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const g = m.gatewaySettings;
  const token = useGatewayStore((st) => st.token);
  const tokenExpired = useGatewayStore((st) => st.tokenExpired);
  const openTokenDialog = useGatewayStore((st) => st.openTokenDialog);
  const hasToken = Boolean(token);

  const [form, setForm] = useState<GatewaySettingsState | null>(null);
  const [baseline, setBaseline] = useState<GatewaySettingsState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveOk, setSaveOk] = useState(false);
  const [showAccessToken, setShowAccessToken] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchGatewaySettings();
      setForm(structuredClone(data));
      setBaseline(structuredClone(data));
      setSaveOk(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : g.loadError);
      setForm(null);
      setBaseline(null);
    } finally {
      setLoading(false);
    }
  }, [g.loadError]);

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

  const updateHeartbeat = useCallback((patch: Partial<GatewaySettingsState['heartbeat']>) => {
    setForm((f) => (f ? { ...f, heartbeat: { ...f.heartbeat, ...patch } } : null));
  }, []);

  const updateAuth = useCallback((patch: Partial<GatewaySettingsState['auth']>) => {
    setForm((f) => (f ? { ...f, auth: { ...f.auth, ...patch } } : null));
  }, []);

  const save = useCallback(async () => {
    if (!form || saving) return;
    setSaving(true);
    setError(null);
    setSaveOk(false);
    try {
      await patchGatewaySettings(form);
      const next = structuredClone(form);
      setBaseline(next);
      setSaveOk(true);
      window.setTimeout(() => setSaveOk(false), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : g.saveError);
    } finally {
      setSaving(false);
    }
  }, [form, saving, g.saveError]);

  const copyAccessToken = useCallback(async () => {
    const t = form?.auth.token;
    if (!t) return;
    await navigator.clipboard.writeText(t).catch(() => {});
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }, [form?.auth.token]);

  if (!hasToken) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-3 px-4 py-8">
        <h1 className="text-lg font-semibold text-fg">{m.settingsSections.gateway}</h1>
        <p className="text-sm text-fg-muted">{g.needToken}</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-3 px-4 py-8">
        <div className="flex items-center gap-2 text-sm text-fg-muted">
          <Loader2 className="size-4 animate-spin" />
          {g.loading}
        </div>
      </div>
    );
  }

  if (!form) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-3 px-4 py-8">
        <p className="text-sm text-fg-muted">{error ?? g.loadError}</p>
        <Button type="button" variant="secondary" onClick={() => void load()}>
          {g.retry}
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-fg">{m.settingsSections.gateway}</h1>
          <p className="mt-1 text-sm text-fg-muted">{g.subtitle}</p>
          <a
            href={DOCS_URL}
            target="_blank"
            rel="noreferrer"
            className="mt-1 inline-flex items-center gap-1 text-sm text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            {g.docsLink}
            <ExternalLink className="size-3.5" />
          </a>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {saveOk ? <span className="text-sm text-fg-muted">{g.saved}</span> : null}
          <Button type="button" variant="primary" disabled={!dirty || saving} onClick={() => void save()}>
            {saving ? g.saving : g.save}
          </Button>
        </div>
      </header>

      {tokenExpired ? (
        <div
          className="flex flex-col gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 dark:border-red-900/50 dark:bg-red-950/40"
          role="alert"
        >
          <div className="flex items-start gap-2">
            <AlertCircle className="mt-0.5 size-4 shrink-0 text-red-600 dark:text-red-400" />
            <p className="text-sm text-red-900 dark:text-red-100">{g.tokenExpired}</p>
          </div>
          <div>
            <Button type="button" variant="secondary" className="text-sm" onClick={() => openTokenDialog()}>
              {g.updateToken}
            </Button>
          </div>
        </div>
      ) : null}

      {dirty ? <p className="text-xs text-amber-800 dark:text-amber-200">{g.unsavedHint}</p> : null}
      {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}

      {form.auth.mode === 'none' ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
          {g.authModeNone}
        </p>
      ) : null}

      <section className="rounded-xl border border-edge bg-surface-panel shadow-sm dark:border-edge dark:shadow-none">
        <div className="border-b border-edge-subtle px-4 py-3 dark:border-edge">
          <div className="flex items-center gap-2 text-sm font-semibold text-fg">
            <Server className="size-4 text-accent" strokeWidth={1.75} />
            {m.settingsSections.gateway}
          </div>
        </div>
        <div className="space-y-4 px-4 py-4">
          {(form.host || form.port != null) && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <div className="mb-1 text-sm font-medium text-fg">{g.listenHost}</div>
                <div className="rounded-lg border border-edge-subtle bg-surface-base px-3 py-2 font-mono text-xs text-fg-muted dark:border-edge">
                  {form.host || '—'}
                </div>
              </div>
              <div>
                <div className="mb-1 text-sm font-medium text-fg">{g.listenPort}</div>
                <div className="rounded-lg border border-edge-subtle bg-surface-base px-3 py-2 font-mono text-xs text-fg-muted dark:border-edge">
                  {form.port != null ? String(form.port) : '—'}
                </div>
              </div>
              <p className="sm:col-span-2 text-xs text-fg-subtle">{g.listenHint}</p>
            </div>
          )}

          <AccessTokenField
            g={g}
            value={form.auth.token}
            show={showAccessToken}
            copied={copied}
            onToggleShow={() => setShowAccessToken((s) => !s)}
            onCopy={() => void copyAccessToken()}
            onChange={(token) => updateAuth({ token })}
          />

          <Button type="button" variant="secondary" className="w-full sm:w-auto" onClick={() => openTokenDialog()}>
            {g.changeToken}
          </Button>

          <label className="flex cursor-pointer items-center gap-2 text-sm text-fg">
            <input
              type="checkbox"
              className="size-4 rounded border-edge text-accent focus:ring-accent/30"
              checked={form.heartbeat.enabled}
              onChange={(e) => updateHeartbeat({ enabled: e.target.checked })}
            />
            {g.enableHeartbeat}
          </label>

          <div>
            <div className="mb-1 text-sm font-medium text-fg">{g.heartbeatInterval}</div>
            <input
              type="number"
              min={1000}
              step={1000}
              className={inputClassName()}
              value={form.heartbeat.intervalMs}
              onChange={(e) =>
                updateHeartbeat({ intervalMs: parseInt(e.target.value, 10) || 60000 })
              }
            />
            <p className="mt-1 text-xs text-fg-subtle">{g.heartbeatHint}</p>
          </div>
        </div>
      </section>
    </div>
  );
}

function AccessTokenField({
  g,
  value,
  show,
  copied,
  onToggleShow,
  onCopy,
  onChange,
}: {
  g: GatewaySettingsMessages;
  value: string;
  show: boolean;
  copied: boolean;
  onToggleShow: () => void;
  onCopy: () => void;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="text-sm font-medium text-fg">{g.accessToken}</div>
      <div className="flex flex-wrap gap-2">
        <input
          className={cn(inputClassName(), 'min-w-0 flex-1 font-mono text-xs')}
          type={show ? 'text' : 'password'}
          autoComplete="off"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={g.tokenPlaceholder}
        />
        {value ? (
          <Button type="button" variant="secondary" className="px-2 py-1 text-xs" onClick={onCopy}>
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            {copied ? g.copied : g.copy}
          </Button>
        ) : null}
        <Button type="button" variant="secondary" className="px-2 py-1 text-xs" onClick={onToggleShow}>
          {show ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
          {show ? g.hide : g.show}
        </Button>
      </div>
      <p className="text-xs text-fg-subtle">{g.tokenHelp}</p>
    </div>
  );
}
