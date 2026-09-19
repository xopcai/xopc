import * as Dialog from '@radix-ui/react-dialog';
import { CheckCircle2, ChevronRight, Clock3, Download, ExternalLink, Laptop, PanelRight, Smartphone, X, type LucideIcon } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { CopyTextRow } from '@/components/ui/copy-text-row';
import { Skeleton } from '@/components/ui/skeleton';
import { TailscaleServeSection } from '@/features/remote-access/tailscale-serve-section';
import { ReverseProxySection } from '@/features/remote-access/reverse-proxy-section';
import { encodeMobilePairQr } from '@/features/tunnel/mobile-pair-qr';
import { messages } from '@/i18n/messages';
import { openExternalHttpLink } from '@/lib/app-link';
import { useAsyncResource } from '@/lib/use-async-resource';
import { useLocaleStore } from '@/stores/locale-store';
import type { DevicePairingTargetKind } from '@xopcai/gateway-contract';
import { cn } from '@/lib/cn';
import { SETTINGS_SHELL_CONTENT_Z, SETTINGS_SHELL_OVERLAY_Z } from '@/lib/settings-shell-dialog-layer';
import {
  cancelDevicePairingSetup, createDevicePairingSetup, decideDevicePairing, downloadBrowserExtensionArchive,
  fetchDevicePairingReadiness, fetchDevicePairingSetup, type DevicePairingSetup,
} from './device-access-api';
import { DevicePairingRouteSetup } from './device-pairing-route-setup';

export function DevicePairingWizard({ open, onOpenChange, onPaired, targetKind }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPaired?: () => void;
  targetKind?: DevicePairingTargetKind;
}) {
  const navigate = useNavigate();
  const [selectedTarget, setSelectedTarget] = useState<DevicePairingTargetKind | undefined>(targetKind);
  useEffect(() => { setSelectedTarget(targetKind); }, [targetKind]);
  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) setSelectedTarget(targetKind);
    onOpenChange(nextOpen);
  };
  return <Dialog.Root open={open} onOpenChange={handleOpenChange}>
    {open ? selectedTarget
      ? <DevicePairingWizardContent targetKind={selectedTarget} onClose={() => handleOpenChange(false)} onPaired={onPaired} />
      : <DeviceKindChooser
          onChoose={setSelectedTarget}
          onChooseLocalBrowser={() => {
            handleOpenChange(false);
            navigate('/settings/agent-browser?driver=extension');
          }}
          onClose={() => handleOpenChange(false)}
        /> : null}
  </Dialog.Root>;
}

function DeviceChoice({ icon: Icon, title, hint, onClick }: {
  icon: LucideIcon;
  title: string;
  hint: string;
  onClick: () => void;
}) {
  return <button
    type="button"
    className="group flex min-h-18 w-full cursor-pointer items-center gap-4 rounded-xl border border-edge bg-surface-panel px-4 py-3.5 text-left shadow-surface transition-[background-color,border-color,box-shadow,transform] hover:border-edge-strong hover:bg-surface-active hover:shadow-elevated active:translate-y-px active:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-panel motion-reduce:active:translate-y-0"
    onClick={onClick}
  >
    <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent-fg">
      <Icon className="size-5" aria-hidden="true" />
    </span>
    <span className="min-w-0 flex-1">
      <span className="block text-sm font-semibold text-fg">{title}</span>
      <span className="mt-0.5 block text-xs leading-5 text-fg-muted">{hint}</span>
    </span>
    <ChevronRight
      className="size-4 shrink-0 text-fg-disabled transition-transform group-hover:translate-x-0.5 group-hover:text-fg-muted"
      aria-hidden="true"
    />
  </button>;
}

function DeviceKindChooser({ onChoose, onChooseLocalBrowser, onClose }: {
  onChoose: (target: DevicePairingTargetKind) => void;
  onChooseLocalBrowser: () => void;
  onClose: () => void;
}) {
  const language = useLocaleStore(s => s.language);
  const copy = messages(language).endpointToolsSettings.deviceAccess;
  return <Dialog.Portal>
    <Dialog.Overlay className={cn('xopc-dialog-overlay fixed inset-0 bg-scrim backdrop-blur-[1px]', SETTINGS_SHELL_OVERLAY_Z)} />
    <Dialog.Content className={cn('xopc-dialog-content fixed left-1/2 top-1/2 flex h-[min(28rem,calc(100dvh-2rem))] w-[min(40rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-edge bg-surface-overlay', SETTINGS_SHELL_CONTENT_Z)}>
      <header className="flex shrink-0 items-center justify-between border-b border-edge-subtle px-6 py-3">
        <span className="text-lg font-semibold tracking-tight text-fg">xopc</span>
        <button type="button" className="flex size-10 items-center justify-center rounded-lg text-fg-muted hover:bg-surface-hover" aria-label={copy.cancel} onClick={onClose}><X className="size-4" /></button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6 sm:px-8">
        <Dialog.Title className="text-lg font-semibold tracking-tight text-fg sm:text-xl">{copy.chooseTitle}</Dialog.Title>
        <Dialog.Description className="mt-1.5 text-sm leading-6 text-fg-muted">{copy.chooseHint}</Dialog.Description>
        <div className="mt-5 flex flex-col gap-2.5">
          <DeviceChoice
            icon={Laptop}
            title={copy.localBrowserTitle}
            hint={copy.localBrowserHint}
            onClick={onChooseLocalBrowser}
          />
          <DeviceChoice
            icon={Smartphone}
            title={copy.mobileTitle}
            hint={copy.mobileHint}
            onClick={() => onChoose('mobile')}
          />
          <DeviceChoice
            icon={PanelRight}
            title={copy.remoteBrowserTitle}
            hint={copy.remoteBrowserHint}
            onClick={() => onChoose('browser')}
          />
        </div>
      </div>
    </Dialog.Content>
  </Dialog.Portal>;
}

function DevicePairingWizardContent({ targetKind, onClose, onPaired }: {
  targetKind: DevicePairingTargetKind;
  onClose: () => void;
  onPaired?: () => void;
}) {
  const language = useLocaleStore(s => s.language);
  const m = messages(language);
  const copy = m.endpointToolsSettings.deviceAccess;
  const f = copy.flow;
  const [started, setStarted] = useState(false);
  const readiness = useSWR(started ? 'device-pairing-readiness' : null, fetchDevicePairingReadiness, { refreshInterval: 1500 });
  const [setup, setSetup] = useState<DevicePairingSetup>();
  const [error, setError] = useState<'create' | 'decision' | 'background' | 'download' | null>(null);
  const [busy, setBusy] = useState(false);
  const [clock, setClock] = useState(Date.now());
  const [alternative, setAlternative] = useState<'choices' | 'tailscale' | 'https' | null>(null);
  const mounted = useRef(true);
  const activeSetup = useRef<string | null>(null);
  const creating = useRef(false);
  const delivered = useRef(false);
  const status = useSWR(setup ? ['device-pairing-setup', setup.id] : null, () => fetchDevicePairingSetup(setup!.id), { refreshInterval: 1500 });
  const request = status.data?.request;
  const credentialsCommitted = request?.status === 'completed';
  const connected = credentialsCommitted && request.connectedAt !== undefined;
  const background = useSWR(connected && window.electronAPI?.system ? 'system-behavior' : null, () => window.electronAPI!.system!.getBehavior());
  const mobileInvitation = setup?.targetKind === 'mobile' ? setup.universalLink : '';
  const qr = useAsyncResource(() => encodeMobilePairQr(mobileInvitation), [mobileInvitation], {
    enabled: Boolean(mobileInvitation), initial: null as string | null, errorData: null,
  });
  const mobileDownloadUrl = language === 'zh' ? 'https://xopc.ai/zh#download' : 'https://xopc.ai/en#download';
  const browserDocsUrl = language === 'zh'
    ? 'https://xopcai.github.io/xopc/zh/browser-extension'
    : 'https://xopcai.github.io/xopc/browser-extension';
  const appDownloadQr = useAsyncResource(() => encodeMobilePairQr(mobileDownloadUrl), [mobileDownloadUrl], {
    enabled: !started && targetKind === 'mobile', initial: null as string | null, errorData: null,
  });
  useEffect(() => {
    mounted.current = true;
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => { mounted.current = false; clearInterval(timer); if (activeSetup.current) void cancelDevicePairingSetup(activeSetup.current).catch(() => {}); };
  }, []);
  const create = useCallback(async () => {
    if (creating.current) return;
    creating.current = true; setBusy(true); setError(null);
    try {
      if (activeSetup.current) await cancelDevicePairingSetup(activeSetup.current);
      activeSetup.current = null; setSetup(undefined);
      const result = await createDevicePairingSetup(targetKind);
      if (result.kind === 'ready') {
        if (!mounted.current) { await cancelDevicePairingSetup(result.setup.id); return; }
        activeSetup.current = result.setup.id; setSetup(result.setup);
      } else await readiness.mutate();
    } catch { if (mounted.current) setError('create'); }
    finally { creating.current = false; if (mounted.current) setBusy(false); }
  }, [readiness, targetKind]);
  useEffect(() => {
    if (readiness.data?.ready && !setup && error !== 'create' && !creating.current) void create();
  }, [readiness.data, setup, error, create]);
  useEffect(() => { if (connected && !delivered.current) { delivered.current = true; onPaired?.(); } }, [connected, onPaired]);
  const decide = async (decision: 'approve' | 'reject') => {
    if (!request) return;
    setBusy(true); setError(null);
    try { await decideDevicePairing(request, decision); await status.mutate(); }
    catch { setError('decision'); await status.mutate(); }
    finally { if (mounted.current) setBusy(false); }
  };
  const serverOffset = useRef(0);
  useEffect(() => { if (status.data) serverOffset.current = status.data.serverTime - Date.now(); }, [status.data]);
  const serverNow = clock + serverOffset.current;
  const expired = setup && serverNow >= setup.expiresAt && !request;
  const ended = request && ['expired', 'rejected', 'cancelled'].includes(request.status);
  const expiresSoon = setup ? setup.expiresAt - serverNow < 60_000 : false;
  const expiryLabel = setup
    ? expiresSoon
      ? `${Math.max(0, Math.ceil((setup.expiresAt - serverNow) / 1000))}s`
      : f.valid
    : '';
  const targetCopy = targetKind === 'mobile' ? {
    connect: copy.mobileScan, connectHint: copy.mobileScanHint, allowTitle: copy.mobileAllowTitle,
    success: copy.mobileSuccess, successHint: copy.mobileSuccessHint,
  } : {
    connect: copy.browserConnect, connectHint: copy.browserConnectHint, allowTitle: copy.browserAllowTitle,
    success: copy.browserSuccess, successHint: copy.browserSuccessHint,
  };
  const preparationTitle = targetKind === 'mobile' ? copy.mobilePrepareTitle : copy.browserPrepareTitle;
  const preparationHint = targetKind === 'mobile' ? copy.mobilePrepareHint : copy.browserPrepareHint;
  const title = !started ? preparationTitle : connected ? targetCopy.success : request?.status === 'pending' ? targetCopy.allowTitle : credentialsCommitted || request?.status === 'approved' ? f.waiting : setup ? targetCopy.connect : f.title;
  const errorMessage = error === 'create' ? f.createFailed
    : error === 'decision' ? f.decisionFailed
      : error === 'background' ? f.backgroundFailed
        : error === 'download' ? copy.browserDownloadFailed
          : null;
  const downloadExtension = async () => {
    setBusy(true); setError(null);
    try { await downloadBrowserExtensionArchive(); }
    catch { setError('download'); }
    finally { if (mounted.current) setBusy(false); }
  };
  return <Dialog.Portal>
    <Dialog.Overlay className={cn('xopc-dialog-overlay fixed inset-0 bg-scrim backdrop-blur-[1px]', SETTINGS_SHELL_OVERLAY_Z)} />
    <Dialog.Content className={cn('xopc-dialog-content fixed left-1/2 top-1/2 flex h-[min(600px,calc(100dvh-48px))] w-[min(560px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-edge bg-surface-overlay', SETTINGS_SHELL_CONTENT_Z)}>
      <header className="flex shrink-0 items-center justify-between border-b border-edge-subtle px-6 py-3">
        <span className="text-lg font-semibold tracking-tight text-fg">xopc</span>
        <button type="button" className="flex size-10 items-center justify-center rounded-lg text-fg-muted hover:bg-surface-hover" aria-label={f.cancel} onClick={onClose}><X className="size-4" /></button>
      </header>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-8 py-7">
        {connected ? <CheckCircle2 className="mb-5 size-7 text-success" /> : null}
        <Dialog.Title className="text-xl font-semibold tracking-tight text-fg">{title}</Dialog.Title>
        <Dialog.Description className="mt-2 text-sm leading-relaxed text-fg-muted">
          {!started ? preparationHint : connected ? targetCopy.successHint : credentialsCommitted ? f.waitingForDevice : request ? request.displayName : setup ? targetCopy.connectHint : f.intro}
        </Dialog.Description>
        {errorMessage ? <p role="alert" className="mt-4 text-sm text-danger">{errorMessage}</p> : null}
        {started && readiness.error ? <p role="alert" className="mt-4 text-sm text-danger">{f.readinessFailed}</p> : null}
        {started && status.error ? <p role="status" className="mt-4 text-sm text-warning">{f.statusUnavailable}</p> : null}
        {!started ? targetKind === 'mobile' ? <div className="mt-7 flex flex-col items-center">
          {appDownloadQr.data ? <img src={appDownloadQr.data} alt={copy.mobileDownloadQrAlt} width={144} height={144} className="size-36 rounded-lg bg-white" /> : <Skeleton className="size-36" />}
          <Button variant="secondary" className="mt-5 w-full" onClick={() => void openExternalHttpLink(mobileDownloadUrl)}>
            <ExternalLink className="size-4" />{copy.mobileDownload}
          </Button>
          <p className="mt-3 text-center text-xs leading-5 text-fg-muted">{copy.mobileDownloadHint}</p>
        </div> : <div className="mt-7">
          <Button variant="secondary" className="w-full" disabled={busy} onClick={() => void downloadExtension()}>
            <Download className="size-4" />{copy.browserDownload}
          </Button>
          <ol className="mt-5 space-y-3 text-sm leading-6 text-fg-muted">
            <li><span className="mr-2 text-fg-subtle">1.</span>{copy.browserInstallStep1}</li>
            <li><span className="mr-2 text-fg-subtle">2.</span>{copy.browserInstallStep2}</li>
            <li><span className="mr-2 text-fg-subtle">3.</span>{copy.browserInstallStep3}</li>
          </ol>
          <button type="button" className="mt-5 inline-flex items-center gap-1 text-xs text-accent hover:underline" onClick={() => void openExternalHttpLink(browserDocsUrl)}>
            {copy.browserInstallHelp}<ExternalLink className="size-3" />
          </button>
        </div> : !readiness.data ? <div className="mt-8 space-y-4"><Skeleton className="h-5 w-3/4" /><Skeleton className="h-40 w-full" /></div> :
          connected ? <>
            {background.data ? <label className="mt-8 flex items-center justify-between gap-4 border-y border-edge-subtle py-5 text-sm text-fg">
              {copy.background}<input type="checkbox" role="switch" aria-checked={background.data.runInBackground ?? false} disabled={!background.data.backgroundSupported} checked={background.data.runInBackground ?? false} className="size-5 accent-accent"
                onChange={e => { void window.electronAPI!.system!.setBehavior({ runInBackground: e.target.checked }).then(result => background.mutate(result.behavior)).catch(() => setError('background')); }} />
            </label> : null}
            <p className="mt-4 text-xs text-fg-muted">{copy.sleep}</p>
          </> : ended || expired ? <div className="mt-10 space-y-5"><p className="text-sm text-fg-muted">{expired || request?.status === 'expired' ? f.expired : f.declined}</p><Button variant="primary" onClick={() => void create()} disabled={busy}>{f.refresh}</Button></div> :
          request ? <>
            <p className="mt-2 text-xs text-fg-muted">{f.scope}</p>
            <p className="mt-10 font-mono text-4xl tracking-[0.16em] text-fg" aria-live="polite">{request.confirmationCode.slice(0, 3)} {request.confirmationCode.slice(3)}</p>
            <p className="mt-3 text-xs text-fg-muted">{f.compare}</p>
            <details className="mt-6 text-xs text-fg-muted"><summary className="cursor-pointer py-2">{f.access}</summary><p>{f.accessHint}</p></details>
          </> : setup?.targetKind === 'mobile' ? <>
            <div className="my-6 flex flex-col items-center">
              <div className="rounded-[1.75rem] border border-edge bg-surface-hover/55 p-2.5 shadow-surface">
                <div className="rounded-[1.25rem] bg-white p-2 shadow-sm ring-1 ring-black/5">
                  {qr.data
                    ? <img src={qr.data} alt={copy.qrAlt} width={240} height={240} className="size-[240px] max-w-full rounded-xl bg-white" />
                    : qr.error ? null : <Skeleton className="size-[240px] rounded-xl" />}
                </div>
              </div>
              {!qr.error ? <p
                className={cn('mt-4 inline-flex min-h-8 items-center gap-1.5 rounded-full px-3 text-xs font-medium', expiresSoon ? 'bg-warning-soft text-warning' : 'bg-surface-hover text-fg-muted')}
                aria-live="polite"
              >
                <Clock3 className="size-3.5" aria-hidden="true" />
                {expiryLabel}
              </p> : null}
            </div>
            {qr.error ? <p role="status" className="text-center text-sm text-warning">{f.qrFailed}</p> : null}
            {qr.error ? <div className="mt-5"><CopyTextRow text={setup.universalLink} labels={{ copy: copy.copy, copied: copy.copied, copyFailed: m.clipboard.copyFailed }} /></div>
              : <details className="group mx-auto mt-1 w-full max-w-sm rounded-xl border border-edge bg-surface-panel text-xs text-fg-muted">
                <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-3.5 transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent [&::-webkit-details-marker]:hidden">
                  <span>{f.fallback}</span>
                  <ChevronRight className="size-3.5 shrink-0 transition-transform group-open:rotate-90" aria-hidden="true" />
                </summary>
                <div className="border-t border-edge-subtle p-3"><CopyTextRow text={setup.universalLink} labels={{ copy: copy.copy, copied: copy.copied, copyFailed: m.clipboard.copyFailed }} /></div>
              </details>}
          </> : setup ? <>
            <ol className="mt-7 space-y-2 text-sm leading-6 text-fg-muted">
              <li><span className="mr-2 text-fg-subtle">1.</span>{copy.browserConnectStep1}</li>
              <li><span className="mr-2 text-fg-subtle">2.</span>{copy.browserConnectStep2}</li>
              <li><span className="mr-2 text-fg-subtle">3.</span>{copy.browserConnectStep3}</li>
            </ol>
            <div className="mt-6"><CopyTextRow text={setup.browserInvitation} labels={{ copy: copy.copy, copied: copy.copied, copyFailed: m.clipboard.copyFailed }} /></div>
            <p className="mt-3 text-center text-xs text-fg-muted">{setup.expiresAt - serverNow < 60_000 ? `${Math.max(0, Math.ceil((setup.expiresAt - serverNow) / 1000))}s` : f.valid}</p>
          </> : readiness.data.ready ? <div className="mt-8"><Skeleton className="mx-auto size-[216px]" /></div> :
          <div className="mt-6 flex flex-1 flex-col">
            {alternative === 'tailscale' ? <TailscaleServeSection embedded /> : alternative === 'https' ? <ReverseProxySection /> : alternative === 'choices' ? <div className="space-y-3">
              <Button variant="secondary" className="w-full" onClick={() => setAlternative('tailscale')}>{copy.useTailscale}</Button>
              <Button variant="secondary" className="w-full" onClick={() => setAlternative('https')}>{copy.useOwnHttps}</Button>
            </div> : <DevicePairingRouteSetup />}
            <Button variant="ghost" className="mt-3 w-full" onClick={() => setAlternative(alternative ? null : 'choices')}>{alternative ? f.back : f.existing}</Button>
          </div>}
      </div>
      {!started || readiness.error || connected || request?.status === 'pending' || error === 'create' || error === 'decision' ? <footer className="shrink-0 px-8 pb-6">
        {!started ? <Button className="w-full" variant="primary" onClick={() => { setError(null); setStarted(true); }}>{targetKind === 'mobile' ? copy.mobileReady : copy.browserReady}</Button> : connected ? <Button className="w-full" variant="primary" onClick={onClose}>{f.done}</Button> : request?.status === 'pending' ? <div className="flex flex-col gap-2">
          <Button className="w-full" variant="primary" disabled={busy} onClick={() => void decide('approve')}>{f.allow}</Button>
          <Button className="w-full" variant="ghost" disabled={busy} onClick={() => void decide('reject')}>{f.cancel}</Button>
        </div> : readiness.error ? <Button className="w-full" variant="primary" onClick={() => void readiness.mutate()}>{f.retry}</Button>
          : <Button className="w-full" variant="primary" disabled={busy} onClick={() => void create()}>{f.retry}</Button>}
      </footer> : null}
    </Dialog.Content>
  </Dialog.Portal>;
}
