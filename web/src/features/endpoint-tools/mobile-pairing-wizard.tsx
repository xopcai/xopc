import * as Dialog from '@radix-ui/react-dialog';
import { CheckCircle2, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { CopyTextRow } from '@/components/ui/copy-text-row';
import { Skeleton } from '@/components/ui/skeleton';
import { TailscaleServeSection } from '@/features/remote-access/tailscale-serve-section';
import { ReverseProxySection } from '@/features/remote-access/reverse-proxy-section';
import { encodeMobilePairQr } from '@/features/tunnel/mobile-pair-qr';
import { messages } from '@/i18n/messages';
import { useAsyncResource } from '@/lib/use-async-resource';
import { useLocaleStore } from '@/stores/locale-store';
import { cn } from '@/lib/cn';
import { SETTINGS_SHELL_CONTENT_Z, SETTINGS_SHELL_OVERLAY_Z } from '@/lib/settings-shell-dialog-layer';
import {
  cancelMobilePairingSetup, createMobilePairingSetup, decideMobilePairing,
  fetchMobilePairingReadiness, fetchMobilePairingSetup, type MobilePairingSetup,
} from './mobile-device-api';
import { MobilePairingRouteSetup } from './mobile-pairing-route-setup';

export function MobilePairingWizard({ open, onOpenChange, onPaired }: {
  open: boolean; onOpenChange: (open: boolean) => void; onPaired?: () => void;
}) {
  return <Dialog.Root open={open} onOpenChange={onOpenChange}>
    {open ? <MobilePairingWizardContent onClose={() => onOpenChange(false)} onPaired={onPaired} /> : null}
  </Dialog.Root>;
}

function MobilePairingWizardContent({ onClose, onPaired }: { onClose: () => void; onPaired?: () => void }) {
  const language = useLocaleStore(s => s.language);
  const m = messages(language);
  const copy = m.endpointToolsSettings.mobileAccess;
  const f = copy.flow;
  const readiness = useSWR('mobile-pairing-readiness', fetchMobilePairingReadiness, { refreshInterval: 1500 });
  const [setup, setSetup] = useState<MobilePairingSetup>();
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [clock, setClock] = useState(Date.now());
  const [alternative, setAlternative] = useState<'choices' | 'tailscale' | 'https' | null>(null);
  const mounted = useRef(true);
  const activeSetup = useRef<string | null>(null);
  const creating = useRef(false);
  const delivered = useRef(false);
  const status = useSWR(setup ? ['mobile-pairing-setup', setup.id] : null, () => fetchMobilePairingSetup(setup!.id), { refreshInterval: 1500 });
  const request = status.data?.request;
  const completed = request?.status === 'completed';
  const background = useSWR(completed && window.electronAPI?.system ? 'system-behavior' : null, () => window.electronAPI!.system!.getBehavior());
  const qr = useAsyncResource(() => encodeMobilePairQr(setup?.universalLink ?? ''), [setup?.universalLink], {
    enabled: Boolean(setup), initial: null as string | null, errorData: null,
  });
  useEffect(() => {
    mounted.current = true;
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => { mounted.current = false; clearInterval(timer); if (activeSetup.current) void cancelMobilePairingSetup(activeSetup.current).catch(() => {}); };
  }, []);
  const create = useCallback(async () => {
    if (creating.current) return;
    creating.current = true; setBusy(true); setError(false);
    try {
      if (activeSetup.current) await cancelMobilePairingSetup(activeSetup.current);
      activeSetup.current = null; setSetup(undefined);
      const result = await createMobilePairingSetup();
      if (result.kind === 'ready') {
        if (!mounted.current) { await cancelMobilePairingSetup(result.setup.id); return; }
        activeSetup.current = result.setup.id; setSetup(result.setup);
      } else await readiness.mutate();
    } catch { if (mounted.current) setError(true); }
    finally { creating.current = false; if (mounted.current) setBusy(false); }
  }, [readiness]);
  useEffect(() => {
    if (readiness.data?.ready && readiness.data.protocolVersions?.includes(3) && !setup && !error && !creating.current) void create();
  }, [readiness.data, setup, error, create]);
  useEffect(() => { if (completed && !delivered.current) { delivered.current = true; onPaired?.(); } }, [completed, onPaired]);
  const decide = async (decision: 'approve' | 'reject') => {
    if (!request) return;
    setBusy(true); setError(false);
    try { await decideMobilePairing(request, decision); await status.mutate(); }
    catch { setError(true); await status.mutate(); }
    finally { if (mounted.current) setBusy(false); }
  };
  const serverOffset = useRef(0);
  useEffect(() => { if (status.data) serverOffset.current = status.data.serverTime - Date.now(); }, [status.data]);
  const serverNow = clock + serverOffset.current;
  const expired = setup && serverNow >= setup.expiresAt && !request;
  const ended = request && ['expired', 'rejected', 'cancelled'].includes(request.status);
  const needsUpdate = readiness.data && !readiness.data.protocolVersions?.includes(3);
  const title = completed ? f.success : request?.status === 'pending' ? f.allowTitle : request?.status === 'approved' ? f.waiting : setup ? f.scan : f.title;
  return <Dialog.Portal>
    <Dialog.Overlay className={cn('fixed inset-0 bg-scrim backdrop-blur-[1px]', SETTINGS_SHELL_OVERLAY_Z)} />
    <Dialog.Content className={cn('fixed left-1/2 top-1/2 flex h-[min(600px,calc(100dvh-48px))] w-[min(560px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-edge bg-surface-panel shadow-popover', SETTINGS_SHELL_CONTENT_Z)}>
      <header className="flex shrink-0 items-center justify-between border-b border-edge-subtle px-6 py-3">
        <span className="text-lg font-semibold tracking-tight text-fg">xopc</span>
        <button type="button" className="flex size-10 items-center justify-center rounded-lg text-fg-muted hover:bg-surface-hover" aria-label={f.cancel} onClick={onClose}><X className="size-4" /></button>
      </header>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-8 py-7">
        {completed ? <CheckCircle2 className="mb-5 size-7 text-success" /> : null}
        <Dialog.Title className="text-xl font-semibold tracking-tight text-fg">{title}</Dialog.Title>
        <Dialog.Description className="mt-2 text-sm leading-relaxed text-fg-muted">
          {completed ? f.successHint : request ? request.displayName : setup ? f.scanHint : f.intro}
        </Dialog.Description>
        {(error || readiness.error || status.error || qr.error) ? <p role="alert" className="mt-4 text-sm text-danger">{f.failed}</p> : null}
        {needsUpdate ? <p className="mt-8 text-sm text-fg-muted">{f.update}</p> :
          !readiness.data ? <div className="mt-8 space-y-4"><Skeleton className="h-5 w-3/4" /><Skeleton className="h-40 w-full" /></div> :
          completed ? <>
            {background.data ? <label className="mt-8 flex items-center justify-between gap-4 border-y border-edge-subtle py-5 text-sm text-fg">
              {f.background}<input type="checkbox" role="switch" aria-checked={background.data.runInBackground ?? false} disabled={!background.data.backgroundSupported} checked={background.data.runInBackground ?? false} className="size-5 accent-accent"
                onChange={e => { void window.electronAPI!.system!.setBehavior({ runInBackground: e.target.checked }).then(result => background.mutate(result.behavior)).catch(() => setError(true)); }} />
            </label> : null}
            <p className="mt-4 text-xs text-fg-muted">{f.sleep}</p>
          </> : ended || expired ? <div className="mt-10 space-y-5"><p className="text-sm text-fg-muted">{expired || request?.status === 'expired' ? f.expired : f.declined}</p><Button variant="primary" onClick={() => void create()} disabled={busy}>{f.refresh}</Button></div> :
          request ? <>
            <p className="mt-2 text-xs text-fg-muted">{f.scope}</p>
            <p className="mt-10 font-mono text-4xl tracking-[0.16em] text-fg" aria-live="polite">{request.confirmationCode.slice(0, 3)} {request.confirmationCode.slice(3)}</p>
            <p className="mt-3 text-xs text-fg-muted">{f.compare}</p>
            <details className="mt-6 text-xs text-fg-muted"><summary className="cursor-pointer py-2">{f.access}</summary><p>{f.accessHint}</p></details>
          </> : setup ? <>
            <div className="my-6 flex justify-center">{qr.data ? <img src={qr.data} alt={copy.qrAlt} width={216} height={216} className="size-[216px] max-w-full rounded-lg bg-white" /> : <Skeleton className="size-[216px]" />}</div>
            <p className="text-center text-xs text-fg-muted">{setup.expiresAt - serverNow < 60_000 ? `${Math.max(0, Math.ceil((setup.expiresAt - serverNow) / 1000))}s` : f.valid}</p>
            <details className="mt-5 text-xs text-fg-muted"><summary className="cursor-pointer py-2">{f.fallback}</summary><CopyTextRow text={setup.universalLink} labels={{ copy: copy.copy, copied: copy.copied, copyFailed: m.clipboard.copyFailed }} /></details>
          </> : readiness.data.ready ? <div className="mt-8"><Skeleton className="mx-auto size-[216px]" /></div> :
          <div className="mt-6 flex flex-1 flex-col">
            {alternative === 'tailscale' ? <TailscaleServeSection embedded /> : alternative === 'https' ? <ReverseProxySection /> : alternative === 'choices' ? <div className="space-y-3">
              <Button variant="secondary" className="w-full" onClick={() => setAlternative('tailscale')}>{copy.useTailscale}</Button>
              <Button variant="secondary" className="w-full" onClick={() => setAlternative('https')}>{copy.useOwnHttps}</Button>
            </div> : <MobilePairingRouteSetup />}
            <Button variant="ghost" className="mt-3 w-full" onClick={() => setAlternative(alternative ? null : 'choices')}>{alternative ? f.back : f.existing}</Button>
          </div>}
      </div>
      {completed || request?.status === 'pending' || error ? <footer className="shrink-0 px-8 pb-6">
        {completed ? <Button className="w-full" variant="primary" onClick={onClose}>{f.done}</Button> : request?.status === 'pending' ? <div className="flex flex-col gap-2">
          <Button className="w-full" variant="primary" disabled={busy} onClick={() => void decide('approve')}>{f.allow}</Button>
          <Button className="w-full" variant="ghost" disabled={busy} onClick={() => void decide('reject')}>{f.cancel}</Button>
        </div> : <Button className="w-full" variant="primary" disabled={busy} onClick={() => void create()}>{f.retry}</Button>}
      </footer> : null}
    </Dialog.Content>
  </Dialog.Portal>;
}
