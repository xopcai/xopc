import { PanelRight, ShieldOff, Smartphone } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';
import type { DevicePairingTargetKind } from '@xopcai/gateway-contract';
import { fetchConnectedDevices, revokeConnectedDevice, type ConnectedDevice } from './device-access-api';
import { DevicePairingWizard } from './device-pairing-wizard';

export function DeviceAccessSection() {
  const [searchParams, setSearchParams] = useSearchParams();
  const language = useLocaleStore(s => s.language);
  const copy = messages(language).endpointToolsSettings.deviceAccess;
  const devices = useSWR('connected-devices', fetchConnectedDevices, { refreshInterval: 10_000 });
  const [pairingOpen, setPairingOpen] = useState(false);
  const [pairingTarget, setPairingTarget] = useState<DevicePairingTargetKind>();
  const [candidate, setCandidate] = useState<ConnectedDevice>();
  const [revoking, setRevoking] = useState(false);
  const [error, setError] = useState(false);
  useEffect(() => {
    const target = searchParams.get('startDevicePairing');
    if (target !== 'mobile' && target !== 'browser') return;
    setPairingTarget(target);
    setPairingOpen(true);
    setSearchParams(current => { const next = new URLSearchParams(current); next.delete('startDevicePairing'); return next; }, { replace: true });
  }, [searchParams, setSearchParams]);
  const refresh = useCallback(() => { void devices.mutate(); }, [devices]);
  const revoke = async () => {
    if (!candidate || revoking) return;
    setRevoking(true); setError(false);
    try { await revokeConnectedDevice(candidate.id); setCandidate(undefined); await devices.mutate(); }
    catch { setError(true); }
    finally { setRevoking(false); }
  };
  const active = devices.data?.filter(d => !d.revokedAt) ?? [];
  return <section className="rounded-xl border border-edge bg-surface-panel p-5">
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div><h2 className="text-sm font-semibold text-fg">{copy.title}</h2><p className="mt-1 text-sm text-fg-muted">{copy.hint}</p></div>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => { setPairingTarget('mobile'); setPairingOpen(true); }}><Smartphone className="size-4" />{copy.addMobile}</Button>
        <Button variant="primary" onClick={() => { setPairingTarget('browser'); setPairingOpen(true); }}><PanelRight className="size-4" />{copy.addBrowser}</Button>
      </div>
    </div>
    {error ? <p role="alert" className="mt-3 text-sm text-danger">{copy.revokeFailed}</p> : null}
    <div className="mt-5 divide-y divide-edge-subtle">
      {devices.isLoading ? <><Skeleton className="h-16" /><Skeleton className="h-16" /></> : active.length === 0 ? <p className="text-sm text-fg-muted">{copy.empty}</p> : active.map(device => <div key={device.id} className="flex items-center justify-between gap-3 py-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-subtle text-fg-muted">{device.platform === 'chrome' ? <PanelRight className="size-4" /> : <Smartphone className="size-4" />}</span>
          <div className="min-w-0"><p className="truncate text-sm font-medium text-fg">{device.displayName}</p><p className="mt-1 text-xs text-fg-muted">{device.platform === 'chrome' ? copy.browserTitle : copy.mobileTitle} · {copy.lastSeen}: {device.lastSeenAt ? new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' }).format(device.lastSeenAt) : copy.never}</p></div>
        </div>
        <Button variant="ghost" onClick={() => setCandidate(device)}><ShieldOff className="size-4" />{copy.revoke}</Button>
      </div>)}
    </div>
    <DevicePairingWizard open={pairingOpen} onOpenChange={setPairingOpen} onPaired={refresh} targetKind={pairingTarget} />
    <ConfirmDialog open={Boolean(candidate)} title={copy.revokeTitle} description={copy.revokeDescription.replace('{{name}}', candidate?.displayName ?? '')} confirmLabel={revoking ? copy.revoking : copy.revoke} cancelLabel={copy.cancel} destructive onConfirm={() => void revoke()} onCancel={() => { if (!revoking) setCandidate(undefined); }} />
  </section>;
}
