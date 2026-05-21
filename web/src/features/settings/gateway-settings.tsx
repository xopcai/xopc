import { AlertCircle, Check, Copy, ExternalLink, Eye, EyeOff, Loader2, Server, SlidersHorizontal } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { useGatewayConfigSwr } from '@/features/gateway/gateway-config-swr';
import {
  normalizeGatewayFromConfig,
  patchGatewaySettings,
  type GatewaySettingsState,
} from '@/features/settings/gateway-config-api';
import { MAX_CHANNEL_DEFER_LIST_SIZE } from '@/features/settings/gateway-settings.types';
import { settingsInputFocusClass } from '@/lib/form-field-width';
import { cn } from '@/lib/cn';
import { messages, type GatewaySettingsMessages } from '@/i18n/messages';
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
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveOk, setSaveOk] = useState(false);
  const [showAccessToken, setShowAccessToken] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [copied, setCopied] = useState(false);
  const dirtyRef = useRef(false);

  const { data, error: swrError, isLoading, mutate } = useGatewayConfigSwr(hasToken);

  const parsed = useMemo(
    () =>
      data?.payload?.config !== undefined
        ? structuredClone(normalizeGatewayFromConfig(data.payload.config))
        : null,
    [data],
  );

  useEffect(() => {
    if (!hasToken) {
      setForm(null);
      setBaseline(null);
      dirtyRef.current = false;
      return;
    }
    if (parsed === null) return;
    if (!dirtyRef.current) {
      setForm(parsed);
      setBaseline(structuredClone(parsed));
      setSaveOk(false);
    }
  }, [hasToken, parsed]);

  const loading = Boolean(hasToken && isLoading && data === undefined && !swrError);
  const fetchError =
    swrError instanceof Error ? swrError.message : swrError ? String(swrError) : null;

  const dirty = useMemo(() => {
    if (!form || !baseline) return false;
    return JSON.stringify(form) !== JSON.stringify(baseline);
  }, [form, baseline]);

  const updateAuth = useCallback((patch: Partial<GatewaySettingsState['auth']>) => {
    dirtyRef.current = true;
    setForm((f) => (f ? { ...f, auth: { ...f.auth, ...patch } } : null));
  }, []);

  const updateChannel = useCallback((channel: GatewaySettingsState['updateChannel']) => {
    dirtyRef.current = true;
    setForm((f) => (f ? { ...f, updateChannel: channel } : null));
  }, []);

  const updateCorsOrigins = useCallback((corsOrigins: string[]) => {
    dirtyRef.current = true;
    setForm((f) => (f ? { ...f, corsOrigins } : null));
  }, []);

  const updateHost = useCallback((host: string) => {
    dirtyRef.current = true;
    setForm((f) => (f ? { ...f, host } : null));
  }, []);

  const updatePort = useCallback((port: number) => {
    dirtyRef.current = true;
    setForm((f) => (f ? { ...f, port } : null));
  }, []);

  const updateRateLimit = useCallback((patch: Partial<GatewaySettingsState['auth']['rateLimit']>) => {
    dirtyRef.current = true;
    setForm((f) => (f ? { ...f, auth: { ...f.auth, rateLimit: { ...f.auth.rateLimit, ...patch } } } : null));
  }, []);

  const updateMaxSseConnections = useCallback((maxSseConnections: number) => {
    dirtyRef.current = true;
    setForm((f) => (f ? { ...f, maxSseConnections } : null));
  }, []);

  const updateChannelConnectDeferMode = useCallback(
    (channelConnectDeferMode: GatewaySettingsState['channelConnectDeferMode']) => {
      dirtyRef.current = true;
      setForm((f) => (f ? { ...f, channelConnectDeferMode } : null));
    },
    [],
  );

  const updateChannelConnectDeferIds = useCallback((channelConnectDeferIds: string[]) => {
    dirtyRef.current = true;
    setForm((f) => (f ? { ...f, channelConnectDeferIds } : null));
  }, []);

  const updateChannelConnectDeferSkipIds = useCallback((channelConnectDeferSkipIds: string[]) => {
    dirtyRef.current = true;
    setForm((f) => (f ? { ...f, channelConnectDeferSkipIds } : null));
  }, []);

  const save = useCallback(async () => {
    if (!form || saving) return;
    setSaving(true);
    setError(null);
    setSaveOk(false);
    try {
      await patchGatewaySettings(form);
      dirtyRef.current = false;
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

  const discard = useCallback(() => {
    if (!baseline) return;
    dirtyRef.current = false;
    setForm(structuredClone(baseline));
    setError(null);
    setSaveOk(false);
  }, [baseline]);

  const copyAccessToken = useCallback(async () => {
    const t = form?.auth.token;
    if (!t) return;
    await navigator.clipboard.writeText(t).catch(() => {});
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }, [form?.auth.token]);

  if (!hasToken) {
    return (
      <div className="mx-auto flex w-full max-w-app-main flex-col gap-3 px-4 py-8">
        <h1 className="text-lg font-semibold text-fg">{m.settingsSections.gateway}</h1>
        <p className="text-sm text-fg-muted">{g.needToken}</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="mx-auto flex w-full max-w-app-main flex-col gap-3 px-4 py-8">
        <div className="flex items-center gap-2 text-sm text-fg-muted">
          <Loader2 className="size-4 animate-spin" />
          {g.loading}
        </div>
      </div>
    );
  }

  if (!form) {
    return (
      <div className="mx-auto flex w-full max-w-app-main flex-col gap-3 px-4 py-8">
        <p className="text-sm text-fg-muted">{error ?? fetchError ?? g.loadError}</p>
        <Button type="button" variant="secondary" onClick={() => void mutate()}>
          {g.retry}
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-app-main flex-col gap-6 px-4 py-6">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-fg">{m.settingsSections.gateway}</h1>
          <p className="mt-1 text-sm text-fg-muted">{g.subtitle}</p>
          <a
            href={docsGuidePageUrl(language, 'gateway')}
            target="_blank"
            rel="noreferrer"
            className="mt-1 inline-flex items-center gap-1 text-sm text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            {g.docsLink}
            <ExternalLink className="size-3.5" />
          </a>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          {saveOk ? <span className="text-sm text-fg-muted">{g.saved}</span> : null}
          <Button type="button" variant="secondary" disabled={!dirty || saving} onClick={discard}>
            {g.discard}
          </Button>
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

      <p className="rounded-lg border border-edge bg-surface-panel/60 px-3 py-2 text-xs text-fg-subtle">
        {g.restartHint}
      </p>

      {form.auth.mode === 'none' ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
          {g.authModeNone}
        </p>
      ) : null}

      <section className="rounded-2xl bg-surface-base px-4 py-5 sm:px-5">
        <div className="mb-5 flex items-center gap-2 text-sm font-semibold text-fg">
          <Server className="size-4 text-accent" strokeWidth={1.75} />
          {m.settingsSections.gateway}
        </div>
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-fg" htmlFor="gateway-listen-host">
                {g.listenHost}
              </label>
              <input
                id="gateway-listen-host"
                className={cn(inputClassName(), 'font-mono text-xs')}
                value={form.host}
                onChange={(e) => updateHost(e.target.value)}
                placeholder={g.listenHostPlaceholder}
                autoComplete="off"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-fg" htmlFor="gateway-listen-port">
                {g.listenPort}
              </label>
              <input
                id="gateway-listen-port"
                type="number"
                min={1}
                max={65535}
                className={cn(inputClassName(), 'font-mono text-xs')}
                value={form.port}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  updatePort(Number.isFinite(n) ? Math.max(1, Math.min(65535, Math.floor(n))) : form.port);
                }}
              />
            </div>
            <p className="sm:col-span-2 text-xs text-fg-subtle">{g.listenHint}</p>
          </div>

          <div className="space-y-2 border-t border-edge pt-4">
            <label className="text-sm font-medium text-fg" htmlFor="gateway-auth-mode">
              {g.authMode}
            </label>
            <select
              id="gateway-auth-mode"
              value={form.auth.mode}
              onChange={(e) => updateAuth({ mode: e.target.value as GatewaySettingsState['auth']['mode'] })}
              className={inputClassName()}
            >
              <option value="token">{g.authModeToken}</option>
              <option value="password">{g.authModePassword}</option>
              <option value="none">{g.authModeNoneLabel}</option>
            </select>
          </div>

          {form.auth.mode === 'token' ? (
            <>
              <SecretCredentialField
                g={g}
                id="gateway-access-token"
                label={g.accessToken}
                help={g.tokenHelp}
                placeholder={g.tokenPlaceholder}
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
            </>
          ) : null}

          {form.auth.mode === 'password' ? (
            <SecretCredentialField
              g={g}
              id="gateway-auth-password"
              label={g.authPassword}
              help={g.authPasswordHelp}
              placeholder={g.authPasswordPlaceholder}
              value={form.auth.password}
              show={showPassword}
              onToggleShow={() => setShowPassword((s) => !s)}
              onChange={(password) => updateAuth({ password })}
            />
          ) : null}

          {form.auth.mode !== 'none' ? (
            <AuthRateLimitFields g={g} rateLimit={form.auth.rateLimit} onChange={updateRateLimit} />
          ) : null}

          <div className="space-y-2 border-t border-edge pt-4">
            <label className="text-sm font-medium text-fg" htmlFor="gateway-update-channel">
              {g.updateChannel}
            </label>
            <select
              id="gateway-update-channel"
              value={form.updateChannel}
              onChange={(e) => updateChannel(e.target.value as GatewaySettingsState['updateChannel'])}
              className={inputClassName()}
            >
              <option value="stable">{g.channelStable}</option>
              <option value="beta">{g.channelBeta}</option>
              <option value="dev">{g.channelDev}</option>
            </select>
            <p className="text-xs text-fg-subtle">{g.updateChannelHint}</p>
          </div>

          <CorsOriginsField
            g={g}
            origins={form.corsOrigins}
            onChange={updateCorsOrigins}
          />
        </div>
      </section>

      <section className="rounded-2xl bg-surface-base px-4 py-5 sm:px-5">
        <div className="mb-5 flex items-center gap-2 text-sm font-semibold text-fg">
          <SlidersHorizontal className="size-4 text-accent" strokeWidth={1.75} />
          {g.advancedSection}
        </div>
        <p className="mb-4 text-xs text-fg-subtle">{g.advancedSectionHint}</p>
        <GatewayAdvancedFields
          g={g}
          form={form}
          onMaxSseConnectionsChange={updateMaxSseConnections}
          onDeferModeChange={updateChannelConnectDeferMode}
          onDeferIdsChange={updateChannelConnectDeferIds}
          onSkipIdsChange={updateChannelConnectDeferSkipIds}
        />
      </section>
    </div>
  );
}

function GatewayAdvancedFields({
  g,
  form,
  onMaxSseConnectionsChange,
  onDeferModeChange,
  onDeferIdsChange,
  onSkipIdsChange,
}: {
  g: GatewaySettingsMessages;
  form: GatewaySettingsState;
  onMaxSseConnectionsChange: (value: number) => void;
  onDeferModeChange: (mode: GatewaySettingsState['channelConnectDeferMode']) => void;
  onDeferIdsChange: (ids: string[]) => void;
  onSkipIdsChange: (ids: string[]) => void;
}) {
  return (
    <div className="space-y-4">
      <div>
        <label className="mb-1 block text-sm font-medium text-fg" htmlFor="gateway-max-sse">
          {g.maxSseConnections}
        </label>
        <input
          id="gateway-max-sse"
          type="number"
          min={1}
          className={cn(inputClassName(), 'max-w-xs font-mono text-xs')}
          value={form.maxSseConnections}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (Number.isFinite(n)) onMaxSseConnectionsChange(Math.max(1, Math.floor(n)));
          }}
        />
        <p className="mt-1 text-xs text-fg-subtle">{g.maxSseConnectionsHint}</p>
      </div>

      <div className="space-y-2 border-t border-edge pt-4">
        <label className="text-sm font-medium text-fg" htmlFor="gateway-channel-defer-mode">
          {g.channelConnectDeferMode}
        </label>
        <select
          id="gateway-channel-defer-mode"
          value={form.channelConnectDeferMode}
          onChange={(e) =>
            onDeferModeChange(e.target.value as GatewaySettingsState['channelConnectDeferMode'])
          }
          className={inputClassName()}
        >
          <option value="auto">{g.channelConnectDeferModeAuto}</option>
          <option value="off">{g.channelConnectDeferModeOff}</option>
          <option value="explicit">{g.channelConnectDeferModeExplicit}</option>
        </select>
        <p className="text-xs text-fg-subtle">{g.channelConnectDeferModeHint}</p>
      </div>

      {form.channelConnectDeferMode === 'explicit' ? (
        <GatewayStringListField
          title={g.channelConnectDeferIds}
          hint={g.channelConnectDeferIdsHint}
          emptyText={g.channelIdListEmpty}
          placeholder={g.channelIdListPlaceholder}
          values={form.channelConnectDeferIds}
          maxItems={MAX_CHANNEL_DEFER_LIST_SIZE}
          onChange={onDeferIdsChange}
        />
      ) : null}

      {form.channelConnectDeferMode !== 'off' ? (
        <GatewayStringListField
          title={g.channelConnectDeferSkipIds}
          hint={g.channelConnectDeferSkipIdsHint}
          emptyText={g.channelIdListEmpty}
          placeholder={g.channelIdListPlaceholder}
          values={form.channelConnectDeferSkipIds}
          maxItems={MAX_CHANNEL_DEFER_LIST_SIZE}
          onChange={onSkipIdsChange}
        />
      ) : null}
    </div>
  );
}

function GatewayStringListField({
  title,
  hint,
  emptyText,
  placeholder,
  values,
  maxItems,
  onChange,
  children,
}: {
  title: string;
  hint: string;
  emptyText: string;
  placeholder: string;
  values: string[];
  maxItems: number;
  onChange: (values: string[]) => void;
  children?: ReactNode;
}) {
  const addValue = useCallback(
    (raw: string) => {
      const next = raw.trim();
      if (!next || values.includes(next) || values.length >= maxItems) return;
      onChange([...values, next]);
    },
    [maxItems, onChange, values],
  );

  return (
    <div className="space-y-2 border-t border-edge pt-4">
      <div className="text-sm font-medium text-fg">{title}</div>
      <p className="text-xs text-fg-subtle">{hint}</p>
      {values.length === 0 ? (
        <p className="text-xs text-fg-muted">{emptyText}</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {values.map((value) => (
            <span
              key={value}
              className="inline-flex items-center gap-1 rounded-md border border-edge bg-surface-panel px-2 py-0.5 font-mono text-xs text-fg"
            >
              {value}
              <button
                type="button"
                className="text-fg-muted hover:text-fg"
                aria-label={`Remove ${value}`}
                onClick={() => onChange(values.filter((x) => x !== value))}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <input
        className={cn(inputClassName(), 'font-mono text-xs')}
        placeholder={placeholder}
        disabled={values.length >= maxItems}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            addValue((e.target as HTMLInputElement).value);
            (e.target as HTMLInputElement).value = '';
          }
        }}
      />
      {children}
    </div>
  );
}

function CorsOriginsField({
  g,
  origins,
  onChange,
}: {
  g: GatewaySettingsMessages;
  origins: string[];
  onChange: (origins: string[]) => void;
}) {
  const hasWildcard = origins.includes('*');

  return (
    <GatewayStringListField
      title={g.corsOrigins}
      hint={g.corsOriginsHint}
      emptyText={g.corsOriginsEmpty}
      placeholder={g.corsOriginsPlaceholder}
      values={origins}
      maxItems={128}
      onChange={onChange}
    >
      {hasWildcard ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
          {g.corsOriginsWildcardWarning}
        </p>
      ) : null}
    </GatewayStringListField>
  );
}

function AuthRateLimitFields({
  g,
  rateLimit,
  onChange,
}: {
  g: GatewaySettingsMessages;
  rateLimit: GatewaySettingsState['auth']['rateLimit'];
  onChange: (patch: Partial<GatewaySettingsState['auth']['rateLimit']>) => void;
}) {
  return (
    <div className="space-y-3 border-t border-edge pt-4">
      <div>
        <div className="text-sm font-medium text-fg">{g.rateLimitTitle}</div>
        <p className="mt-1 text-xs text-fg-subtle">{g.rateLimitHint}</p>
      </div>
      <label className="flex cursor-pointer items-center gap-2 text-sm text-fg">
        <input
          type="checkbox"
          className="ui-checkbox"
          checked={rateLimit.enabled}
          onChange={(e) => onChange({ enabled: e.target.checked })}
        />
        {g.rateLimitEnabled}
      </label>
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-fg-muted" htmlFor="gateway-rate-max">
            {g.rateLimitMaxAttempts}
          </label>
          <input
            id="gateway-rate-max"
            type="number"
            min={1}
            className={inputClassName()}
            value={rateLimit.maxAttempts}
            disabled={!rateLimit.enabled}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (Number.isFinite(n)) onChange({ maxAttempts: Math.max(1, Math.floor(n)) });
            }}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-fg-muted" htmlFor="gateway-rate-window">
            {g.rateLimitWindowMinutes}
          </label>
          <input
            id="gateway-rate-window"
            type="number"
            min={1}
            className={inputClassName()}
            value={Math.round(rateLimit.windowMs / 60_000)}
            disabled={!rateLimit.enabled}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (Number.isFinite(n) && n > 0) onChange({ windowMs: Math.floor(n) * 60_000 });
            }}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-fg-muted" htmlFor="gateway-rate-block">
            {g.rateLimitBlockMinutes}
          </label>
          <input
            id="gateway-rate-block"
            type="number"
            min={1}
            className={inputClassName()}
            value={Math.round(rateLimit.blockDurationMs / 60_000)}
            disabled={!rateLimit.enabled}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (Number.isFinite(n) && n > 0) onChange({ blockDurationMs: Math.floor(n) * 60_000 });
            }}
          />
        </div>
      </div>
    </div>
  );
}

function SecretCredentialField({
  g,
  id,
  label,
  help,
  placeholder,
  value,
  show,
  copied,
  onToggleShow,
  onCopy,
  onChange,
}: {
  g: GatewaySettingsMessages;
  id: string;
  label: string;
  help: string;
  placeholder: string;
  value: string;
  show: boolean;
  copied?: boolean;
  onToggleShow: () => void;
  onCopy?: () => void;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-medium text-fg" htmlFor={id}>
        {label}
      </label>
      <div className="flex flex-wrap gap-2">
        <input
          id={id}
          className={cn(inputClassName(), 'min-w-0 flex-1 font-mono text-xs')}
          type={show ? 'text' : 'password'}
          autoComplete="off"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
        />
        {value && onCopy ? (
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
      <p className="text-xs text-fg-subtle">{help}</p>
    </div>
  );
}
