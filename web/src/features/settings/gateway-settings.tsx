import { AlertCircle, Check, Copy, ExternalLink, Eye, EyeOff, Loader2, Server, Smartphone } from 'lucide-react';
import QRCode from 'qrcode';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import useSWR, { useSWRConfig } from 'swr';

import { Button } from '@/components/ui/button';
import { useGatewayConfigSwr } from '@/features/gateway/gateway-config-swr';
import {
  normalizeGatewayFromConfig,
  patchGatewaySettings,
  type GatewaySettingsState,
} from '@/features/settings/gateway-config-api';
import { fetchTunnelQr, fetchTunnelStatus } from '@/features/tunnel/tunnel-api';
import { settingsInputFocusClass } from '@/lib/form-field-width';
import { cn } from '@/lib/cn';
import {
  buildMobileGatewayPairDeepLink,
  getBaseUrl,
  isLoopbackHttpOrigin,
} from '@/lib/url';
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
          {(form.host || form.port != null) && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <div className="mb-1 text-sm font-medium text-fg">{g.listenHost}</div>
                <div className="rounded-lg bg-surface-hover/80 px-3 py-2 font-mono text-xs text-fg-muted dark:bg-surface-hover/50">
                  {form.host || '—'}
                </div>
              </div>
              <div>
                <div className="mb-1 text-sm font-medium text-fg">{g.listenPort}</div>
                <div className="rounded-lg bg-surface-hover/80 px-3 py-2 font-mono text-xs text-fg-muted dark:bg-surface-hover/50">
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

          {token ? <MobileGatewayPairCard g={g} gatewayToken={token} /> : null}

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
        </div>
      </section>
    </div>
  );
}

function MobileGatewayPairCard({
  g,
  gatewayToken,
}: {
  g: GatewaySettingsMessages;
  gatewayToken: string;
}) {
  const hasToken = Boolean(gatewayToken);
  const { mutate: globalMutate } = useSWRConfig();
  const { data: tunnelStatus } = useSWR(hasToken ? 'gateway-pair-tunnel-status' : null, fetchTunnelStatus, {
    refreshInterval: 60_000,
  });

  useEffect(() => {
    const onTunnelStatus = () => {
      void globalMutate('gateway-pair-tunnel-status');
      void globalMutate('gateway-pair-tunnel-qr');
    };
    window.addEventListener('tunnel-status', onTunnelStatus);
    return () => window.removeEventListener('tunnel-status', onTunnelStatus);
  }, [globalMutate]);
  const tunnelActive =
    tunnelStatus?.state === 'connected' && Boolean(tunnelStatus.publicUrl?.trim());
  const { data: tunnelQr } = useSWR(
    tunnelActive && hasToken ? 'gateway-pair-tunnel-qr' : null,
    fetchTunnelQr,
    { refreshInterval: 15_000 },
  );

  const [pairBaseUrl, setPairBaseUrl] = useState(getBaseUrl);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [qrGenFailed, setQrGenFailed] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);

  const trimmedBase = pairBaseUrl.trim();
  const baseOk = useMemo(() => {
    try {
      const u = new URL(trimmedBase);
      return u.protocol === 'http:' || u.protocol === 'https:';
    } catch {
      return false;
    }
  }, [trimmedBase]);

  const deepLink = useMemo(() => {
    if (!gatewayToken) return '';
    if (tunnelActive && tunnelQr?.qrPayload?.trim()) {
      return tunnelQr.qrPayload.trim();
    }
    if (!baseOk) return '';
    return buildMobileGatewayPairDeepLink({
      baseUrl: trimmedBase,
      gatewayToken,
      lanUrl: null,
    });
  }, [baseOk, gatewayToken, trimmedBase, tunnelActive, tunnelQr?.qrPayload]);

  useEffect(() => {
    if (!deepLink) {
      setQrDataUrl(null);
      setQrGenFailed(false);
      return;
    }
    let cancelled = false;
    setQrGenFailed(false);
    void QRCode.toDataURL(deepLink, {
      width: 216,
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
  }, [deepLink]);

  const localhostWarn = baseOk && isLoopbackHttpOrigin(trimmedBase);

  const copyDeepLink = useCallback(async () => {
    if (!deepLink) return;
    await navigator.clipboard.writeText(deepLink).catch(() => {});
    setLinkCopied(true);
    window.setTimeout(() => setLinkCopied(false), 2000);
  }, [deepLink]);

  return (
    <div className="space-y-3 border-t border-edge pt-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-fg">
        <Smartphone className="size-4 text-accent" strokeWidth={1.75} />
        {g.mobilePairTitle}
      </div>
      <p className="text-xs text-fg-subtle">
        {tunnelActive ? g.mobilePairTunnelActive : g.mobilePairSubtitle}
      </p>

      {tunnelActive ? (
        <div className="space-y-2 rounded-lg border border-edge bg-surface-panel px-3 py-3">
          <div>
            <div className="text-xs font-medium text-fg-muted">{g.mobilePairTunnelPublicUrl}</div>
            <div className="mt-0.5 break-all font-mono text-xs text-fg">{tunnelStatus?.publicUrl}</div>
          </div>
          {tunnelQr?.lanUrl ? (
            <div>
              <div className="text-xs font-medium text-fg-muted">{g.mobilePairTunnelLanUrl}</div>
              <div className="mt-0.5 break-all font-mono text-xs text-fg">{tunnelQr.lanUrl}</div>
            </div>
          ) : null}
        </div>
      ) : (
        <>
          <p className="text-xs text-fg-subtle">
            {g.mobilePairTunnelHint}{' '}
            <Link
              to="/settings/tunnel"
              className="text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            >
              {g.mobilePairOpenTunnelSettings}
            </Link>
          </p>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-fg" htmlFor="gateway-mobile-pair-base">
              {g.mobilePairBaseUrlLabel}
            </label>
            <input
              id="gateway-mobile-pair-base"
              className={cn(inputClassName(), 'font-mono text-xs')}
              type="text"
              autoComplete="off"
              spellCheck={false}
              value={pairBaseUrl}
              onChange={(e) => setPairBaseUrl(e.target.value)}
            />
            <p className="text-xs text-fg-subtle">{g.mobilePairBaseUrlHint}</p>
            {!baseOk ? (
              <p className="text-xs text-amber-800 dark:text-amber-200">{g.mobilePairInvalidBaseUrl}</p>
            ) : null}
            {localhostWarn ? (
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
                {g.mobilePairLocalhostWarning}
              </p>
            ) : null}
          </div>
        </>
      )}

      <p className="text-xs text-fg-subtle">{g.mobilePairSecurityNote}</p>

      {deepLink ? (
        <div className="flex flex-col items-center gap-3 sm:items-start">
          {qrDataUrl && !qrGenFailed ? (
            <img
              src={qrDataUrl}
              alt=""
              className="size-56 rounded-lg border border-edge-subtle bg-white object-contain p-3 dark:border-edge"
            />
          ) : null}
          {!qrDataUrl && !qrGenFailed ? <p className="text-sm text-fg-muted">{g.mobilePairEncoding}</p> : null}
          {qrGenFailed ? <p className="text-center text-sm text-fg-muted sm:text-left">{g.mobilePairImageError}</p> : null}
          <Button
            type="button"
            variant="secondary"
            className="w-full sm:w-auto"
            disabled={!deepLink}
            onClick={() => void copyDeepLink()}
          >
            {linkCopied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            {linkCopied ? g.mobilePairCopied : g.mobilePairCopyLink}
          </Button>
        </div>
      ) : null}

      <p className="break-all font-mono text-[10px] leading-relaxed text-fg-subtle">{g.mobilePairSchemeHint}</p>
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
