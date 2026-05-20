import { Check, Copy, Globe, Loader2, Power, RefreshCw } from 'lucide-react';
import QRCode from 'qrcode';
import { useCallback, useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { useGatewayConfigSwr } from '@/features/gateway/gateway-config-swr';
import { revalidateGatewayConfig } from '@/features/gateway/gateway-config-swr';
import { SettingsFormSection } from '@/features/settings/settings-form-section';
import {
  fetchTunnelQr,
  fetchTunnelStatus,
  patchTunnelConfig,
  startTunnel,
  stopTunnel,
  type TunnelStatusResponse,
} from '@/features/tunnel/tunnel-api';
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
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [qrPayload, setQrPayload] = useState('');
  const [linkCopied, setLinkCopied] = useState(false);

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

  const refreshQr = useCallback(async (payload?: string) => {
    try {
      const qr = payload ? { qrPayload: payload } : await fetchTunnelQr();
      setQrPayload(qr.qrPayload);
      if (!qr.qrPayload) {
        setQrDataUrl(null);
        return;
      }
      const url = await QRCode.toDataURL(qr.qrPayload, {
        width: 216,
        margin: 2,
        errorCorrectionLevel: 'M',
        color: { dark: '#000000ff', light: '#ffffffff' },
      });
      setQrDataUrl(url);
    } catch {
      setQrDataUrl(null);
    }
  }, []);

  useEffect(() => {
    if (status?.enabled && status.state === 'connected') {
      void refreshQr();
    } else if (!status?.enabled) {
      setQrDataUrl(null);
      setQrPayload('');
    }
  }, [status?.enabled, status?.state, refreshQr]);

  const handleStart = useCallback(async () => {
    setActionError(null);
    setStarting(true);
    try {
      const res = await startTunnel();
      await mutStatus();
      await refreshQr(res.qrPayload);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setStarting(false);
    }
  }, [mutStatus, refreshQr]);

  const handleStop = useCallback(async () => {
    setActionError(null);
    setStopping(true);
    try {
      await stopTunnel();
      setQrDataUrl(null);
      setQrPayload('');
      await mutStatus();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setStopping(false);
    }
  }, [mutStatus]);

  const toggleAutoStart = useCallback(async () => {
    setSavingAutoStart(true);
    setActionError(null);
    try {
      await patchTunnelConfig({ autoStart: !tunnelCfg.autoStart });
      void revalidateGatewayConfig();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingAutoStart(false);
    }
  }, [tunnelCfg.autoStart]);

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
    config: { autoStart: tunnelCfg.autoStart, brokerUrl: 'https://frp.xopc.ai/api' },
  };

  return (
    <div className="mx-auto flex w-full max-w-app-main flex-col gap-6 px-4 py-8">
      <div>
        <h1 className="text-lg font-semibold text-fg">{t.title}</h1>
        <p className="mt-1 text-sm text-fg-muted">{t.subtitle}</p>
      </div>

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

      <SettingsFormSection>
        <h2 className="mb-3 text-sm font-semibold text-fg">{t.qrTitle}</h2>
        {qrDataUrl ? (
          <img
            src={qrDataUrl}
            alt=""
            className="size-56 rounded-lg border border-edge-subtle bg-white object-contain p-3 dark:border-edge"
          />
        ) : (
          <p className="text-sm text-fg-muted">{st.enabled ? t.qrLoading : t.qrInactive}</p>
        )}
        <p className="text-xs text-fg-subtle">{t.qrHint}</p>
      </SettingsFormSection>

      <div className="flex flex-wrap gap-2">
        {!st.enabled ? (
          <Button type="button" disabled={starting} onClick={() => void handleStart()}>
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
          <Button type="button" variant="ghost" onClick={() => void refreshQr()}>
            <RefreshCw className="size-4" />
            {t.refreshQr}
          </Button>
        ) : null}
      </div>

      <SettingsFormSection>
        <h2 className="mb-3 text-sm font-semibold text-fg">{t.optionsTitle}</h2>
        <label className="flex cursor-pointer items-center gap-3 text-sm text-fg">
          <input
            type="checkbox"
            className="size-4 rounded border-edge accent-accent"
            checked={tunnelCfg.autoStart}
            disabled={savingAutoStart}
            onChange={() => void toggleAutoStart()}
          />
          {t.autoStart}
        </label>
      </SettingsFormSection>

      {actionError ? <p className="text-sm text-red-600 dark:text-red-400">{actionError}</p> : null}

      {qrPayload ? (
        <details className="rounded-lg border border-edge bg-surface-panel px-3 py-2">
          <summary className="cursor-pointer text-xs font-medium text-fg-muted">{t.deeplinkTitle}</summary>
          <p className="mt-2 break-all font-mono text-[10px] leading-relaxed text-fg-subtle">{qrPayload}</p>
        </details>
      ) : null}

      <div className="flex items-start gap-2 rounded-lg border border-edge-subtle bg-surface-panel px-3 py-2 text-xs text-fg-subtle">
        <Globe className="mt-0.5 size-4 shrink-0 text-accent" />
        <span>{t.brokerNote}</span>
      </div>
    </div>
  );
}
