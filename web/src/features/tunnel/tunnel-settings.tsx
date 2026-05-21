import { AlertTriangle, Check, Copy, Globe, Loader2, Power, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useGatewayConfigSwr } from '@/features/gateway/gateway-config-swr';
import { revalidateGatewayConfig } from '@/features/gateway/gateway-config-swr';
import { SettingsFormSection } from '@/features/settings/settings-form-section';
import { MobilePairQrSection } from '@/features/tunnel/mobile-pair-qr-section';
import { TunnelConsentDialog } from '@/features/tunnel/tunnel-consent-dialog';
import {
  fetchTunnelStatus,
  patchTunnelConfig,
  recordTunnelConsent,
  startTunnel,
  stopTunnel,
  type TunnelStatusResponse,
} from '@/features/tunnel/tunnel-api';
import { useMobilePairQr } from '@/features/tunnel/use-mobile-pair-qr';
import { cn } from '@/lib/cn';
import { messages } from '@/i18n/messages';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';

function statusLabel(
  t: ReturnType<typeof messages>['tunnelSettings'],
  status: TunnelStatusResponse,
): string {
  if (status.state === 'connected') return t.statusConnected;
  if (status.state === 'connecting' || status.state === 'reconnecting') return t.statusConnecting;
  if (status.state === 'error') return t.statusError;
  return t.statusOff;
}

function statusDotClass(status: TunnelStatusResponse): string {
  if (status.state === 'connected') return 'bg-emerald-500';
  if (status.state === 'connecting' || status.state === 'reconnecting') return 'bg-amber-500 animate-pulse';
  if (status.state === 'error') return 'bg-red-500';
  return 'bg-fg-subtle';
}

function formatUptime(since: string | null): string {
  if (!since) return '—';
  const ms = Date.now() - new Date(since).getTime();
  if (ms < 0) return '—';
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return `${hrs}h ${rem}m`;
}

export function TunnelSettingsPanel() {
  const language = useLocaleStore((s) => s.language);
  const t = messages(language).tunnelSettings;
  const token = useGatewayStore((st) => st.token);
  const hasToken = Boolean(token);

  const [actionError, setActionError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [savingAutoStart, setSavingAutoStart] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [consentOpen, setConsentOpen] = useState(false);
  const [autoStartConfirmOpen, setAutoStartConfirmOpen] = useState(false);

  const pairQr = useMobilePairQr(token ?? '');

  const { data: cfgData } = useGatewayConfigSwr(hasToken);
  const tunnelCfg = useMemo(() => {
    const c = cfgData?.payload?.config;
    if (!c || typeof c !== 'object' || Array.isArray(c)) return { autoStart: false };
    const tunnel = (c as { tunnel?: unknown }).tunnel;
    if (!tunnel || typeof tunnel !== 'object' || Array.isArray(tunnel)) return { autoStart: false };
    return {
      autoStart: Boolean((tunnel as { autoStart?: unknown }).autoStart),
    };
  }, [cfgData]);

  const {
    data: status,
    error: statusErr,
    isLoading,
    mutate: mutStatus,
  } = useSWR(hasToken ? 'tunnel-status' : null, fetchTunnelStatus, { refreshInterval: 60_000 });

  useEffect(() => {
    const onTunnelStatus = () => {
      void mutStatus();
    };
    window.addEventListener('tunnel-status', onTunnelStatus);
    return () => window.removeEventListener('tunnel-status', onTunnelStatus);
  }, [mutStatus]);

  const consentBullets = useMemo(
    () => [t.consentBullet1, t.consentBullet2, t.consentBullet3] as const,
    [t.consentBullet1, t.consentBullet2, t.consentBullet3],
  );

  const runStart = useCallback(async () => {
    setActionError(null);
    setStarting(true);
    try {
      const res = await startTunnel();
      await mutStatus();
      void revalidateGatewayConfig();
      await pairQr.refreshQr(res.qrPayload);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setStarting(false);
    }
  }, [mutStatus, pairQr.refreshQr]);

  const handleStartClick = useCallback(() => {
    if (status?.consentRequired) {
      setConsentOpen(true);
      return;
    }
    void runStart();
  }, [status?.consentRequired, runStart]);

  const handleConsentConfirm = useCallback(async () => {
    setConsentOpen(false);
    setActionError(null);
    try {
      await recordTunnelConsent();
      await mutStatus();
      await runStart();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    }
  }, [mutStatus, runStart]);

  const handleStop = useCallback(async () => {
    setActionError(null);
    setStopping(true);
    try {
      await stopTunnel();
      await pairQr.refreshQr();
      await mutStatus();
      void revalidateGatewayConfig();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setStopping(false);
    }
  }, [mutStatus, pairQr.refreshQr]);

  const applyAutoStart = useCallback(
    async (next: boolean) => {
      setSavingAutoStart(true);
      setActionError(null);
      try {
        await patchTunnelConfig({ autoStart: next });
        void revalidateGatewayConfig();
      } catch (e) {
        setActionError(e instanceof Error ? e.message : String(e));
      } finally {
        setSavingAutoStart(false);
      }
    },
    [],
  );

  const toggleAutoStart = useCallback(() => {
    if (tunnelCfg.autoStart) {
      void applyAutoStart(false);
      return;
    }
    if (status?.consentRequired) {
      setActionError(t.consentExpiredBanner);
      return;
    }
    if (!status?.canAutoStart) {
      setActionError(t.autoStartHint);
      return;
    }
    setAutoStartConfirmOpen(true);
  }, [applyAutoStart, status?.canAutoStart, status?.consentRequired, t, tunnelCfg.autoStart]);

  const copyLink = useCallback(async () => {
    if (!status?.publicUrl) return;
    await navigator.clipboard.writeText(status.publicUrl).catch(() => {});
    setLinkCopied(true);
    window.setTimeout(() => setLinkCopied(false), 2000);
  }, [status?.publicUrl]);

  if (!hasToken) {
    return (
      <div className="mx-auto w-full max-w-app-main px-4 py-8">
        <p className="text-sm text-fg-muted">{t.needToken}</p>
      </div>
    );
  }

  const st = status ?? {
    enabled: false,
    state: 'disconnected' as const,
    subdomain: null,
    publicUrl: null,
    connectedSince: null,
    frpcPid: null,
    lastHeartbeatAt: null,
    lastError: null,
    consentRequired: true,
    config: { autoStart: tunnelCfg.autoStart, brokerUrl: 'https://frp.xopc.ai/api' },
  };

  const showConsentExpired =
    status?.consentRequired && (st.enabled || tunnelCfg.autoStart || status?.consent?.acceptedAt);

  return (
    <div className="mx-auto flex w-full max-w-app-main flex-col gap-6 px-4 py-8">
      <div>
        <h1 className="text-lg font-semibold text-fg">{t.title}</h1>
        <p className="mt-1 text-sm text-fg-muted">{t.subtitle}</p>
      </div>

      <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-fg-muted">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
        <div>
          <p className="font-medium text-fg">{t.riskBannerTitle}</p>
          <p className="mt-1">{t.riskBannerBody}</p>
        </div>
      </div>

      {showConsentExpired ? (
        <div className="rounded-lg border border-edge bg-surface-panel px-3 py-2 text-xs text-fg-muted">
          {t.consentExpiredBanner}
        </div>
      ) : null}

      <SettingsFormSection>
        <h2 className="mb-3 text-sm font-semibold text-fg">{t.statusTitle}</h2>
        {isLoading && !status ? (
          <p className="flex items-center gap-2 text-sm text-fg-muted">
            <Loader2 className="size-4 animate-spin" />
            {t.loading}
          </p>
        ) : null}
        {statusErr ? (
          <p className="text-sm text-red-600 dark:text-red-400">
            {statusErr instanceof Error ? statusErr.message : String(statusErr)}
          </p>
        ) : null}
        <div className="flex items-center gap-2 text-sm font-medium text-fg">
          <span className={cn('size-2.5 rounded-full', statusDotClass(st))} aria-hidden />
          {statusLabel(t, st)}
        </div>
        {st.publicUrl ? (
          <p className="font-mono text-xs text-fg-subtle break-all">{st.publicUrl}</p>
        ) : null}
        {st.connectedSince ? (
          <p className="text-xs text-fg-subtle">
            {t.uptime}: {formatUptime(st.connectedSince)}
          </p>
        ) : null}
        {st.lastError && st.state === 'error' ? (
          <p className="text-xs text-red-600 dark:text-red-400">{st.lastError}</p>
        ) : null}
        <p className="text-xs text-fg-subtle">{t.lanHint}</p>
      </SettingsFormSection>

      <MobilePairQrSection pairQr={pairQr} />

      <div className="flex flex-wrap gap-2">
        {!st.enabled ? (
          <Button type="button" disabled={starting} onClick={handleStartClick}>
            {starting ? <Loader2 className="size-4 animate-spin" /> : <Power className="size-4" />}
            {t.start}
          </Button>
        ) : (
          <Button type="button" variant="secondary" disabled={stopping} onClick={() => void handleStop()}>
            {stopping ? <Loader2 className="size-4 animate-spin" /> : null}
            {t.stop}
          </Button>
        )}
        {st.publicUrl ? (
          <Button type="button" variant="secondary" onClick={() => void copyLink()}>
            {linkCopied ? <Check className="size-4" /> : <Copy className="size-4" />}
            {linkCopied ? t.copied : t.copyUrl}
          </Button>
        ) : null}
        {st.enabled ? (
          <Button type="button" variant="ghost" onClick={() => void pairQr.refreshQr()}>
            <RefreshCw className="size-4" />
            {t.refreshQr}
          </Button>
        ) : null}
      </div>

      <SettingsFormSection>
        <h2 className="mb-3 text-sm font-semibold text-fg">{t.optionsTitle}</h2>
        <label
          className={cn(
            'flex items-center gap-3 text-sm text-fg',
            !tunnelCfg.autoStart && !status?.canAutoStart ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
          )}
        >
          <input
            type="checkbox"
            className="size-4 rounded border-edge accent-accent"
            checked={tunnelCfg.autoStart}
            disabled={savingAutoStart || (!tunnelCfg.autoStart && !status?.canAutoStart)}
            onChange={toggleAutoStart}
          />
          {t.autoStart}
        </label>
        {!status?.canAutoStart && !tunnelCfg.autoStart ? (
          <p className="mt-2 text-xs text-fg-subtle">{t.autoStartHint}</p>
        ) : null}
      </SettingsFormSection>

      {actionError ? <p className="text-sm text-red-600 dark:text-red-400">{actionError}</p> : null}

      <div className="flex items-start gap-2 rounded-lg border border-edge-subtle bg-surface-panel px-3 py-2 text-xs text-fg-subtle">
        <Globe className="mt-0.5 size-4 shrink-0 text-accent" />
        <span>{t.brokerNote}</span>
      </div>

      <TunnelConsentDialog
        key={consentOpen ? 'consent-open' : 'consent-closed'}
        open={consentOpen}
        title={t.consentTitle}
        intro={t.consentIntro}
        bullets={consentBullets}
        checkboxLabel={t.consentCheckbox}
        confirmLabel={showConsentExpired ? t.consentReconfirm : t.consentConfirm}
        cancelLabel={t.consentCancel}
        onConfirm={() => void handleConsentConfirm()}
        onCancel={() => setConsentOpen(false)}
      />

      <ConfirmDialog
        open={autoStartConfirmOpen}
        title={t.autoStartConfirmTitle}
        description={t.autoStartConfirmBody}
        confirmLabel={t.autoStartConfirmLabel}
        cancelLabel={t.consentCancel}
        onConfirm={() => {
          setAutoStartConfirmOpen(false);
          void applyAutoStart(true);
        }}
        onCancel={() => setAutoStartConfirmOpen(false)}
      />
    </div>
  );
}
