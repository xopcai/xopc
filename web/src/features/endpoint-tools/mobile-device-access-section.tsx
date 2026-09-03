import { Plus, ShieldOff, Smartphone } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';
import { fetchMobileDevices, revokeMobileDevice, type MobileDevice } from './mobile-device-api';
import { MobilePairingWizard } from './mobile-pairing-wizard';

export function MobileDeviceAccessSection() {
  const [searchParams, setSearchParams] = useSearchParams();
  const language = useLocaleStore(s => s.language);
  const copy = messages(language).endpointToolsSettings.mobileAccess;
  const devices = useSWR('mobile-access-devices', fetchMobileDevices, { refreshInterval: 10_000 });
  const [pairingOpen, setPairingOpen] = useState(false);
  const [candidate, setCandidate] = useState<MobileDevice>();
  const [revoking, setRevoking] = useState(false);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (searchParams.get('startMobilePairing') !== '1') return;
    setPairingOpen(true);
    setSearchParams(current => { const next = new URLSearchParams(current); next.delete('startMobilePairing'); return next; }, { replace: true });
  }, [searchParams, setSearchParams]);
  const refresh = useCallback(() => { void devices.mutate(); }, [devices]);
  const revoke = async () => {
    if (!candidate || revoking) return;
    setRevoking(true); setError(false);
    try { await revokeMobileDevice(candidate.id); setCandidate(undefined); await devices.mutate(); }
    catch { setError(true); }
    finally { setRevoking(false); }
  };
  const active = devices.data?.filter(d => !d.revokedAt) ?? [];
  return <section className="rounded-xl border border-edge bg-surface-panel p-5">
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div><h2 className="flex items-center gap-2 text-sm font-semibold text-fg"><Smartphone className="size-4" />{copy.title}</h2><p className="mt-1 text-sm text-fg-muted">{copy.flow.intro}</p></div>
      <Button variant="primary" onClick={() => setPairingOpen(true)}><Plus className="size-4" />{copy.flow.title}</Button>
    </div>
    {error ? <p role="alert" className="mt-3 text-sm text-danger">{copy.revokeFailed}</p> : null}
    <div className="mt-5 divide-y divide-edge-subtle">
      {devices.isLoading ? <><Skeleton className="h-16" /><Skeleton className="h-16" /></> : active.length === 0 ? <p className="text-sm text-fg-muted">{copy.empty}</p> : active.map(device => <div key={device.id} className="flex items-center justify-between gap-3 py-4">
        <div className="min-w-0"><p className="truncate text-sm font-medium text-fg">{device.displayName}</p><p className="mt-1 text-xs text-fg-muted">{copy.lastSeen}: {device.lastSeenAt ? new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' }).format(device.lastSeenAt) : copy.never}</p></div>
        <Button variant="ghost" onClick={() => setCandidate(device)}><ShieldOff className="size-4" />{copy.revoke}</Button>
      </div>)}
    </div>
    <MobilePairingWizard open={pairingOpen} onOpenChange={setPairingOpen} onPaired={refresh} />
    <ConfirmDialog open={Boolean(candidate)} title={copy.revokeTitle} description={copy.revokeDescription.replace('{{name}}', candidate?.displayName ?? '')} confirmLabel={revoking ? copy.revoking : copy.revoke} cancelLabel={copy.cancel} destructive onConfirm={() => void revoke()} onCancel={() => { if (!revoking) setCandidate(undefined); }} />
  </section>;
}
