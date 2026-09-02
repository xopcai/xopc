import { ArrowRight, Loader2, Plus, ShieldCheck, ShieldOff, Smartphone } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { CopyTextRow } from '@/components/ui/copy-text-row';
import { Skeleton } from '@/components/ui/skeleton';
import { encodeMobilePairQr } from '@/features/tunnel/mobile-pair-qr';
import { messages } from '@/i18n/messages';
import { useAsyncResource } from '@/lib/use-async-resource';
import { useLocaleStore } from '@/stores/locale-store';
import {
  createMobilePairingSetup,
  fetchMobileDevices,
  fetchMobilePairingReadiness,
  revokeMobileDevice,
  type MobileDevice,
  type MobilePairingSetup,
} from './mobile-device-api';

export function MobileDeviceAccessSection() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const language = useLocaleStore((state) => state.language);
  const copy = messages(language).endpointToolsSettings.mobileAccess;
  const devices = useSWR('mobile-access-devices', fetchMobileDevices, { refreshInterval: 10_000 });
  const readiness = useSWR('mobile-pairing-readiness', fetchMobilePairingReadiness, { refreshInterval: 5_000 });
  const [setup, setSetup] = useState<MobilePairingSetup>();
  const [needsSecureRoute, setNeedsSecureRoute] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string>();
  const [revokeCandidate, setRevokeCandidate] = useState<MobileDevice>();
  const [revoking, setRevoking] = useState(false);
  const resumedPairing = useRef(false);
  const qr = useAsyncResource(
    () => encodeMobilePairQr(setup?.universalLink ?? ''),
    [setup?.universalLink],
    { enabled: Boolean(setup?.universalLink), initial: null as string | null, errorData: null },
  );
  const formatter = useMemo(
    () => new Intl.DateTimeFormat(language === 'zh' ? 'zh-CN' : 'en', { dateStyle: 'medium', timeStyle: 'short' }),
    [language],
  );

  const createSetup = useCallback(async () => {
    if (readiness.data && !readiness.data.ready) {
      setNeedsSecureRoute(true);
      setError(undefined);
      return;
    }
    setCreating(true);
    setError(undefined);
    try {
      const result = await createMobilePairingSetup();
      if (result.kind === 'needs-secure-route') {
        setSetup(undefined);
        setNeedsSecureRoute(true);
        return;
      }
      setNeedsSecureRoute(false);
      setSetup(result.setup);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : copy.createFailed);
    } finally {
      setCreating(false);
    }
  }, [copy.createFailed, readiness.data]);

  useEffect(() => {
    if (searchParams.get('startMobilePairing') !== '1' || resumedPairing.current) return;
    resumedPairing.current = true;
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.delete('startMobilePairing');
      return next;
    }, { replace: true });
    void createSetup();
  }, [createSetup, searchParams, setSearchParams]);

  const openSecureRouteSetup = (tab: 'public' | 'tailscale' | 'reverse-proxy') => {
    navigate(`/settings/remote-access?tab=${tab}&intent=mobile-pairing`);
  };

  const confirmRevoke = async () => {
    if (!revokeCandidate || revoking) return;
    setRevoking(true);
    try {
      await revokeMobileDevice(revokeCandidate.id);
      setRevokeCandidate(undefined);
      await devices.mutate();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : copy.revokeFailed);
    } finally {
      setRevoking(false);
    }
  };

  const activeDevices = (devices.data ?? []).filter((device) => !device.revokedAt);

  return (
    <section className="rounded-2xl border border-edge bg-surface-base p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Smartphone className="size-4 text-accent" aria-hidden />
            <h2 className="text-sm font-semibold text-fg">{copy.title}</h2>
          </div>
          <p className="mt-1 text-sm text-fg-muted">{copy.hint}</p>
        </div>
        <Button variant="primary" onClick={() => void createSetup()} disabled={creating}>
          {creating ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Plus className="size-4" aria-hidden />}
          {creating ? copy.creating : copy.add}
        </Button>
      </div>

      {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}

      {needsSecureRoute ? (
        <div className="mt-4 rounded-xl border border-accent/25 bg-accent-soft p-4">
          <div className="flex items-start gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-surface-base text-accent">
              <ShieldCheck className="size-5" aria-hidden />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-medium text-fg">{copy.routeSetupTitle}</p>
                <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-medium text-white">
                  {copy.stepOne}
                </span>
              </div>
              <p className="mt-1 text-sm text-fg-muted">{copy.routeSetupHint}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button variant="primary" onClick={() => openSecureRouteSetup('public')}>
                  {copy.setupSecureLink}
                  <ArrowRight className="size-4" aria-hidden />
                </Button>
                <Button variant="secondary" onClick={() => openSecureRouteSetup('tailscale')}>
                  {copy.useTailscale}
                </Button>
                <Button variant="ghost" onClick={() => openSecureRouteSetup('reverse-proxy')}>
                  {copy.useOwnHttps}
                </Button>
              </div>
              <p className="mt-3 text-xs text-fg-subtle">{copy.routeSetupReturnHint}</p>
            </div>
          </div>
        </div>
      ) : null}

      {setup ? (
        <div className="mt-4 grid gap-4 rounded-xl border border-edge-subtle bg-surface-panel p-4 md:grid-cols-[224px_1fr]">
          {qr.data ? (
            <img src={qr.data} alt={copy.qrAlt} className="size-56 rounded-lg bg-white p-2" />
          ) : (
            <div className="flex size-56 items-center justify-center rounded-lg bg-surface-base text-sm text-fg-muted">
              {copy.encoding}
            </div>
          )}
          <div className="min-w-0 space-y-3">
            <p className="text-sm font-medium text-fg">{copy.scan}</p>
            <p className="text-xs text-fg-muted">{copy.expires.replace('{{time}}', formatter.format(setup.expiresAt))}</p>
            <div className="space-y-1">
              {setup.routes.map((route) => (
                <p key={route.id} className="break-all font-mono text-xs text-fg-muted">{route.kind} · {route.url}</p>
              ))}
            </div>
            <CopyTextRow text={setup.universalLink} labels={{
              copy: copy.copy,
              copied: copy.copied,
              copyFailed: messages(language).clipboard.copyFailed,
            }} />
          </div>
        </div>
      ) : null}

      <div className="mt-4 space-y-2">
        {devices.isLoading ? <><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /></> : null}
        {!devices.isLoading && activeDevices.length === 0 ? <p className="text-sm text-fg-muted">{copy.empty}</p> : null}
        {activeDevices.map((device) => (
          <article key={device.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-edge-subtle bg-surface-panel px-4 py-3">
            <div>
              <p className="font-medium text-fg">{device.displayName}</p>
              <p className="mt-1 text-xs text-fg-muted">
                {device.platform} · {copy.lastSeen}: {device.lastSeenAt ? formatter.format(device.lastSeenAt) : copy.never}
              </p>
            </div>
            <Button variant="secondary" className="text-danger" onClick={() => setRevokeCandidate(device)}>
              <ShieldOff className="size-4" aria-hidden />
              {copy.revoke}
            </Button>
          </article>
        ))}
      </div>

      <ConfirmDialog
        open={Boolean(revokeCandidate)}
        title={copy.revokeTitle}
        description={copy.revokeDescription.replace('{{name}}', revokeCandidate?.displayName ?? '')}
        confirmLabel={revoking ? copy.revoking : copy.revoke}
        cancelLabel={copy.cancel}
        destructive
        onConfirm={() => void confirmRevoke()}
        onCancel={() => { if (!revoking) setRevokeCandidate(undefined); }}
      />
    </section>
  );
}
