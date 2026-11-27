import * as Dialog from '@radix-ui/react-dialog';
import * as Popover from '@radix-ui/react-popover';
import { CheckCircle2, ChevronLeft, ChevronRight, Clock3, Download, ExternalLink, FolderOpen, Laptop, Loader2, PanelRight, RefreshCw, Smartphone, X, type LucideIcon } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import useSWR, { useSWRConfig } from 'swr';

import { Button } from '@/components/ui/button';
import { CopyTextRow } from '@/components/ui/copy-text-row';
import { Skeleton } from '@/components/ui/skeleton';
import { TailscaleServeSection } from '@/features/remote-access/tailscale-serve-section';
import { ReverseProxySection } from '@/features/remote-access/reverse-proxy-section';
import {
  fetchBrowserExtensionStatus,
  installBrowserExtension,
  openBrowserExtension,
} from '@/features/settings/browser/browser-control-api';
import { encodeMobilePairQr } from '@/features/tunnel/mobile-pair-qr';
import { messages } from '@/i18n/messages';
import { openExternalHttpLink } from '@/lib/app-link';
import { useAsyncResource } from '@/lib/use-async-resource';
import { useLocaleStore } from '@/stores/locale-store';
import type { DevicePairingTargetKind } from '@xopcai/gateway-contract';
import { cn } from '@/lib/cn';
import { SETTINGS_SHELL_CONTENT_Z, SETTINGS_SHELL_MODAL_POPOVER_Z, SETTINGS_SHELL_OVERLAY_Z } from '@/lib/settings-shell-dialog-layer';
import {
  cancelDevicePairingSetup, createDevicePairingSetup, decideDevicePairing, DEVICE_PAIRING_READINESS_KEY,
  downloadBrowserExtensionArchive, fetchDevicePairingReadiness, fetchDevicePairingSetup, type DevicePairingSetup,
} from './device-access-api';
import { DevicePairingRouteSetup } from './device-pairing-route-setup';

const WIZARD_DIALOG_CLASS = 'xopc-dialog-content fixed left-1/2 top-1/2 flex h-[min(600px,calc(100dvh-48px))] w-[min(560px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-edge bg-surface-overlay';
const LOCAL_BROWSER_SETTINGS_PATH = '/settings/agent-browser?driver=extension&browser-status=1';

type WizardStep = DevicePairingTargetKind | 'local-browser';

export function DevicePairingWizard({ open, onOpenChange, onPaired, targetKind }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPaired?: () => void;
  targetKind?: DevicePairingTargetKind;
}) {
  const navigate = useNavigate();
  const [selectedStep, setSelectedStep] = useState<WizardStep | undefined>(targetKind);
  useEffect(() => { setSelectedStep(targetKind); }, [targetKind]);
  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) setSelectedStep(targetKind);
    onOpenChange(nextOpen);
  };
  const openLocalBrowserSettings = () => {
    handleOpenChange(false);
    navigate(LOCAL_BROWSER_SETTINGS_PATH);
  };
  return <Dialog.Root open={open} onOpenChange={handleOpenChange}>
    {open ? selectedStep === 'local-browser'
      ? <LocalBrowserPairingContent
          onBack={() => setSelectedStep(undefined)}
          onSwitchToRemoteBrowser={() => setSelectedStep('browser')}
          onManageSettings={openLocalBrowserSettings}
          onClose={() => handleOpenChange(false)}
          onPaired={onPaired}
        />
      : selectedStep
        ? <DevicePairingWizardContent
            targetKind={selectedStep}
            onBack={targetKind ? undefined : () => setSelectedStep(undefined)}
            onClose={() => handleOpenChange(false)}
            onPaired={onPaired}
          />
        : <DeviceKindChooser
            onChoose={setSelectedStep}
            onChooseLocalBrowser={() => setSelectedStep('local-browser')}
            onManageLocalBrowser={openLocalBrowserSettings}
            onClose={() => handleOpenChange(false)}
          /> : null}
  </Dialog.Root>;
}

function DeviceChoice({ icon: Icon, title, hint, badge, badgeTone = 'neutral', onClick }: {
  icon: LucideIcon;
  title: string;
  hint: string;
  badge?: string;
  badgeTone?: 'accent' | 'success' | 'neutral';
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
      <span className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-fg">{title}</span>
        {badge ? <span className={cn(
          'rounded-full px-2 py-0.5 text-[11px] font-medium leading-4',
          badgeTone === 'accent' && 'bg-accent-soft text-accent-fg',
          badgeTone === 'success' && 'bg-success-soft text-success',
          badgeTone === 'neutral' && 'bg-surface-hover text-fg-muted',
        )}>{badge}</span> : null}
      </span>
      <span className="mt-0.5 block text-xs leading-5 text-fg-muted">{hint}</span>
    </span>
    <ChevronRight
      className="size-4 shrink-0 text-fg-disabled transition-transform group-hover:translate-x-0.5 group-hover:text-fg-muted"
      aria-hidden="true"
    />
  </button>;
}

function DeviceKindChooser({ onChoose, onChooseLocalBrowser, onManageLocalBrowser, onClose }: {
  onChoose: (target: DevicePairingTargetKind) => void;
  onChooseLocalBrowser: () => void;
  onManageLocalBrowser: () => void;
  onClose: () => void;
}) {
  const language = useLocaleStore(s => s.language);
  const copy = messages(language).endpointToolsSettings.deviceAccess;
  const readiness = useSWR(DEVICE_PAIRING_READINESS_KEY, fetchDevicePairingReadiness, {
    revalidateOnFocus: true,
    shouldRetryOnError: false,
  });
  const devices = readiness.data?.devices;
  const localBrowserConnected = devices?.localBrowserConnected === true;
  const mobileCount = devices?.mobileCount ?? 0;
  const remoteBrowserCount = devices?.remoteBrowserConnectedCount ?? 0;
  const loadingInitial = readiness.isLoading && !readiness.data;

  return <Dialog.Portal>
    <Dialog.Overlay className={cn('xopc-dialog-overlay fixed inset-0 bg-scrim', SETTINGS_SHELL_OVERLAY_Z)} />
    <Dialog.Content className={cn(WIZARD_DIALOG_CLASS, SETTINGS_SHELL_CONTENT_Z)}>
      <header className="flex shrink-0 items-center justify-between border-b border-edge-subtle px-6 py-3">
        <span className="text-lg font-semibold tracking-tight text-fg">xopc</span>
        <button type="button" className="flex size-10 items-center justify-center rounded-lg text-fg-muted hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent" aria-label={copy.cancel} onClick={onClose}><X className="size-4" /></button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-7 sm:px-8">
        <Dialog.Title className="text-xl font-semibold tracking-tight text-fg">{copy.chooseTitle}</Dialog.Title>
        <Dialog.Description className="mt-2 text-sm leading-6 text-fg-muted">
          {localBrowserConnected ? copy.chooseHintConnected : copy.chooseHint}
        </Dialog.Description>
        {loadingInitial ? (
          <div className="mt-6 space-y-3" aria-busy="true">
            <Skeleton className="h-[4.75rem] w-full rounded-xl" />
            <Skeleton className="h-[4.75rem] w-full rounded-xl" />
            <Skeleton className="mt-5 h-5 w-2/3 rounded-md" />
          </div>
        ) : (
          <>
            <div className="mt-6 flex flex-col gap-3">
              <DeviceChoice
                icon={Smartphone}
                title={copy.mobileTitle}
                hint={mobileCount > 0 ? copy.mobileHintAddAnother : copy.mobileHint}
                badge={mobileCount > 0
                  ? copy.connectedCountBadge.replace('{{count}}', String(mobileCount))
                  : copy.recommendedBadge}
                badgeTone={mobileCount > 0 ? 'success' : 'accent'}
                onClick={() => onChoose('mobile')}
              />
              {localBrowserConnected ? (
                <DeviceChoice
                  icon={PanelRight}
                  title={copy.remoteBrowserTitle}
                  hint={copy.remoteBrowserHint}
                  badge={remoteBrowserCount > 0
                    ? copy.connectedCountBadge.replace('{{count}}', String(remoteBrowserCount))
                    : undefined}
                  badgeTone="neutral"
                  onClick={() => onChoose('browser')}
                />
              ) : (
                <DeviceChoice
                  icon={Laptop}
                  title={copy.localBrowserTitle}
                  hint={copy.localBrowserHint}
                  onClick={onChooseLocalBrowser}
                />
              )}
            </div>
            {!localBrowserConnected ? (
              <div className="mt-6 flex flex-wrap items-center justify-between gap-2 border-t border-edge-subtle pt-4 text-xs text-fg-muted">
                <span>{copy.remoteBrowserFooterPrompt}</span>
                <button
                  type="button"
                  className="inline-flex cursor-pointer items-center gap-0.5 rounded-md px-1.5 py-1 font-medium text-accent-fg transition-colors hover:bg-accent-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  onClick={() => onChoose('browser')}
                >
                  {copy.remoteBrowserFooterAction}
                  <ChevronRight className="size-3.5" aria-hidden="true" />
                </button>
              </div>
            ) : null}
          </>
        )}
      </div>
      {localBrowserConnected ? (
        <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-edge-subtle bg-surface-panel/70 px-6 py-3.5 sm:px-8">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-xs font-medium text-fg">
              <span className="size-2 shrink-0 rounded-full bg-success" aria-hidden="true" />
              <span>{copy.localBrowserConnected}</span>
            </p>
            <p className="mt-0.5 text-[11px] leading-4 text-fg-subtle">{copy.localBrowserConnectedHint}</p>
          </div>
          <Button variant="ghost" className="h-8 shrink-0 gap-1 px-2.5 text-xs text-fg-muted hover:text-fg" onClick={onManageLocalBrowser}>
            {copy.manageBrowser}
            <ChevronRight className="size-3.5" aria-hidden="true" />
          </Button>
        </footer>
      ) : null}
    </Dialog.Content>
  </Dialog.Portal>;
}

function LocalBrowserPairingContent({
  onBack,
  onSwitchToRemoteBrowser,
  onManageSettings,
  onClose,
  onPaired,
}: {
  onBack: () => void;
  onSwitchToRemoteBrowser: () => void;
  onManageSettings: () => void;
  onClose: () => void;
  onPaired?: () => void;
}) {
  const { mutate } = useSWRConfig();
  const language = useLocaleStore(s => s.language);
  const copy = messages(language).endpointToolsSettings.deviceAccess;
  const f = copy.flow;
  const status = useSWR('browser-extension-status', fetchBrowserExtensionStatus, {
    refreshInterval: 2_000,
    revalidateOnFocus: true,
    shouldRetryOnError: false,
  });
  const [busyAction, setBusyAction] = useState<'install' | 'chrome' | 'folder' | null>(null);
  const [actionError, setActionError] = useState<'install' | 'open' | null>(null);
  const [openedNotice, setOpenedNotice] = useState(false);
  const delivered = useRef(false);

  const localConnected = status.data?.localConnected === true;
  const localManagementAvailable = status.data?.localManagementAvailable !== false;
  const artifacts = status.data?.artifacts;
  const extensionFilesReady = artifacts?.installed === true && artifacts?.needsRefresh !== true;
  const nativeHostReady = artifacts?.nativeHost?.installed === true;
  const needsPrepare = !extensionFilesReady || !nativeHostReady;
  const needsReload = artifacts?.needsChromeReload === true
    || (status.data?.socketConnected === true && !status.data?.connected);
  const loadingInitial = status.isLoading && !status.data;

  useEffect(() => {
    if (localConnected && !delivered.current) {
      delivered.current = true;
      void mutate(DEVICE_PAIRING_READINESS_KEY);
      onPaired?.();
    }
  }, [localConnected, mutate, onPaired]);

  const prepareExtension = async (force = false) => {
    setBusyAction('install');
    setActionError(null);
    setOpenedNotice(false);
    try {
      await installBrowserExtension(force);
      await status.mutate();
    } catch {
      setActionError('install');
    } finally {
      setBusyAction(null);
    }
  };

  const openInstallUi = async (action: 'chrome' | 'folder') => {
    setBusyAction(action);
    setActionError(null);
    try {
      await openBrowserExtension(action);
      setOpenedNotice(true);
    } catch {
      setActionError('open');
    } finally {
      setBusyAction(null);
    }
  };

  const title = localConnected ? copy.localBrowserSuccess : copy.localBrowserFlowTitle;
  const description = localConnected
    ? copy.localBrowserSuccessHint
    : !localManagementAvailable
      ? copy.localBrowserRemoteOnlyHint
      : needsReload
        ? copy.localBrowserReloadHint
        : !needsPrepare
          ? copy.localBrowserReadyHint
          : copy.localBrowserFlowHint;

  return <Dialog.Portal>
    <Dialog.Overlay className={cn('xopc-dialog-overlay fixed inset-0 bg-scrim', SETTINGS_SHELL_OVERLAY_Z)} />
    <Dialog.Content className={cn(WIZARD_DIALOG_CLASS, SETTINGS_SHELL_CONTENT_Z)}>
      <header className="flex shrink-0 items-center justify-between border-b border-edge-subtle px-6 py-3">
        {!localConnected ? (
          <button
            type="button"
            className="-ml-2 inline-flex min-h-10 cursor-pointer items-center gap-1 rounded-lg px-2 text-sm font-medium text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            onClick={onBack}
          >
            <ChevronLeft className="size-4" aria-hidden="true" />
            <span>{f.back}</span>
          </button>
        ) : (
          <span className="text-lg font-semibold tracking-tight text-fg">xopc</span>
        )}
        <button
          type="button"
          className="flex size-10 items-center justify-center rounded-lg text-fg-muted hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          aria-label={f.cancel}
          onClick={onClose}
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </header>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-8 py-7">
        {localConnected ? <CheckCircle2 className="mb-5 size-7 text-success" aria-hidden="true" /> : null}
        <Dialog.Title className="text-xl font-semibold tracking-tight text-fg">{title}</Dialog.Title>
        <Dialog.Description className="mt-2 text-sm leading-relaxed text-fg-muted">{description}</Dialog.Description>
        {actionError === 'install' ? <p role="alert" className="mt-4 text-sm text-danger">{copy.localBrowserInstallFailed}</p> : null}
        {actionError === 'open' ? <p role="alert" className="mt-4 text-sm text-danger">{copy.localBrowserOpenFailed}</p> : null}
        {openedNotice && !localConnected ? <p role="status" className="mt-4 rounded-lg bg-surface-inset px-3 py-2 text-xs text-fg-muted">{copy.localBrowserOpenedNotice}</p> : null}
        {loadingInitial ? (
          <div className="mt-6 space-y-4" aria-busy="true">
            <div className="grid gap-2.5 sm:grid-cols-2">
              <Skeleton className="h-14 rounded-xl" />
              <Skeleton className="h-14 rounded-xl" />
            </div>
            <Skeleton className="h-24 w-full rounded-xl" />
          </div>
        ) : localConnected ? (
          <p className="mt-6 text-xs leading-5 text-fg-muted">{copy.localBrowserConnectedHint}</p>
        ) : !localManagementAvailable ? null : (
          <>
            <div className="mt-6 grid gap-2.5 sm:grid-cols-2">
              <div className="rounded-xl bg-surface-inset px-3.5 py-2.5">
                <p className="text-xs text-fg-subtle">{copy.localBrowserStatusFiles}</p>
                <p className={cn('mt-1 flex items-center gap-1.5 text-sm font-medium', !needsPrepare ? 'text-success' : 'text-fg')}>
                  <span className={cn('size-1.5 rounded-full', !needsPrepare ? 'bg-success' : 'bg-warning')} aria-hidden="true" />
                  {!needsPrepare ? copy.localBrowserStatusReady : copy.localBrowserStatusPending}
                </p>
              </div>
              <div className="rounded-xl bg-surface-inset px-3.5 py-2.5">
                <p className="text-xs text-fg-subtle">{copy.localBrowserStatusConnection}</p>
                <p className={cn('mt-1 flex items-center gap-1.5 text-sm font-medium', needsReload ? 'text-warning' : 'text-fg-muted')}>
                  <span className={cn('size-1.5 rounded-full', needsReload ? 'bg-warning' : 'bg-fg-subtle')} aria-hidden="true" />
                  {needsReload ? copy.localBrowserStatusReload : copy.localBrowserStatusWaiting}
                </p>
              </div>
            </div>
            {needsPrepare ? (
              <ol className="mt-6 space-y-3 text-sm leading-6 text-fg-muted">
                <li><span className="mr-2 text-fg-subtle">1.</span>{copy.localBrowserPrepareStep1}</li>
                <li><span className="mr-2 text-fg-subtle">2.</span>{copy.localBrowserPrepareStep2}</li>
              </ol>
            ) : (
              <>
                <ol className="mt-6 space-y-2.5 text-sm leading-6 text-fg-muted">
                  <li><span className="mr-2 text-fg-subtle">1.</span>{copy.localBrowserLoadStep1}</li>
                  <li><span className="mr-2 text-fg-subtle">2.</span>{copy.localBrowserLoadStep2}</li>
                  <li><span className="mr-2 text-fg-subtle">3.</span>{copy.localBrowserLoadStep3}</li>
                </ol>
                {artifacts?.extensionDir ? (
                  <p className="mt-4 break-all rounded-lg bg-surface-inset px-3 py-2 font-mono text-[11px] text-fg-subtle">
                    {artifacts.extensionDir}
                  </p>
                ) : null}
              </>
            )}
          </>
        )}
      </div>
      <footer className="shrink-0 space-y-2 border-t border-edge-subtle px-8 py-5">
        {localConnected ? (
          <div className="flex flex-col gap-2">
            <Button className="w-full" variant="primary" onClick={onClose}>{f.done}</Button>
            <Button className="w-full" variant="ghost" onClick={onManageSettings}>
              {copy.manageBrowser}
              <ChevronRight className="size-3.5" aria-hidden="true" />
            </Button>
          </div>
        ) : !localManagementAvailable ? (
          <Button className="w-full" variant="primary" onClick={onSwitchToRemoteBrowser}>
            {copy.localBrowserSwitchRemote}
          </Button>
        ) : needsPrepare ? (
          <Button
            className="w-full"
            variant="primary"
            disabled={busyAction !== null || loadingInitial}
            onClick={() => void prepareExtension(Boolean(artifacts?.installed))}
          >
            {busyAction === 'install' ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Download className="size-4" aria-hidden="true" />}
            {busyAction === 'install' ? copy.localBrowserPreparing : copy.localBrowserPrepareAction}
          </Button>
        ) : (
          <>
            <div className="grid gap-2 sm:grid-cols-2">
              <Button
                className="w-full"
                variant="primary"
                disabled={busyAction !== null}
                onClick={() => void openInstallUi('chrome')}
              >
                {busyAction === 'chrome' ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <ExternalLink className="size-4" aria-hidden="true" />}
                {copy.localBrowserOpenChrome}
              </Button>
              <Button
                className="w-full"
                variant="secondary"
                disabled={busyAction !== null}
                onClick={() => void openInstallUi('folder')}
              >
                {busyAction === 'folder' ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <FolderOpen className="size-4" aria-hidden="true" />}
                {copy.localBrowserOpenFolder}
              </Button>
            </div>
            <div className="flex items-center justify-between pt-1 text-xs">
              <button
                type="button"
                className="inline-flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-1 text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg disabled:opacity-50"
                disabled={busyAction !== null}
                onClick={() => void prepareExtension(true)}
              >
                <RefreshCw className={cn('size-3', busyAction === 'install' && 'animate-spin')} aria-hidden="true" />
                {copy.localBrowserRefreshFiles}
              </button>
              <button
                type="button"
                className="inline-flex cursor-pointer items-center gap-0.5 rounded-md px-1.5 py-1 text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
                onClick={onManageSettings}
              >
                {copy.manageBrowser}
                <ChevronRight className="size-3.5" aria-hidden="true" />
              </button>
            </div>
          </>
        )}
      </footer>
    </Dialog.Content>
  </Dialog.Portal>;
}

function DevicePairingWizardContent({ targetKind, onBack, onClose, onPaired }: {
  targetKind: DevicePairingTargetKind;
  onBack?: () => void;
  onClose: () => void;
  onPaired?: () => void;
}) {
  const { mutate } = useSWRConfig();
  const language = useLocaleStore(s => s.language);
  const m = messages(language);
  const copy = m.endpointToolsSettings.deviceAccess;
  const f = copy.flow;
  const [started, setStarted] = useState(targetKind === 'mobile');
  const [downloadOpen, setDownloadOpen] = useState(false);
  const readiness = useSWR(started ? DEVICE_PAIRING_READINESS_KEY : null, fetchDevicePairingReadiness, { refreshInterval: 1500 });
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
    enabled: downloadOpen && targetKind === 'mobile', initial: null as string | null, errorData: null,
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
  useEffect(() => {
    if (connected && !delivered.current) {
      delivered.current = true;
      void mutate(DEVICE_PAIRING_READINESS_KEY);
      onPaired?.();
    }
  }, [connected, mutate, onPaired]);
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
  const preparationTitle = copy.browserPrepareTitle;
  const preparationHint = copy.browserPrepareHint;
  const needsRouteSetup = Boolean(started && readiness.data && !readiness.data.ready && !setup && !connected && !request && !ended && !expired);
  const title = !started
    ? preparationTitle
    : connected
      ? targetCopy.success
      : request?.status === 'pending'
        ? targetCopy.allowTitle
        : credentialsCommitted || request?.status === 'approved'
          ? f.waiting
          : setup
            ? targetCopy.connect
            : needsRouteSetup
              ? copy.routeSetupTitle
              : f.title;
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
    <Dialog.Overlay className={cn('xopc-dialog-overlay fixed inset-0 bg-scrim', SETTINGS_SHELL_OVERLAY_Z)} />
    <Dialog.Content className={cn(WIZARD_DIALOG_CLASS, SETTINGS_SHELL_CONTENT_Z)}>
      <header className="flex shrink-0 items-center justify-between border-b border-edge-subtle px-6 py-3">
        {onBack && !connected ? (
          <button
            type="button"
            className="-ml-2 inline-flex min-h-10 cursor-pointer items-center gap-1 rounded-lg px-2 text-sm font-medium text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            onClick={onBack}
          >
            <ChevronLeft className="size-4" aria-hidden="true" />
            <span>{f.back}</span>
          </button>
        ) : (
          <span className="text-lg font-semibold tracking-tight text-fg">xopc</span>
        )}
        <div className="flex items-center gap-2">
          {targetKind === 'mobile' ? <Popover.Root open={downloadOpen} onOpenChange={setDownloadOpen}>
            <Popover.Trigger asChild>
              <Button variant="ghost" className="min-h-10">
                <Download className="size-4" aria-hidden="true" />{copy.mobileDownloadAction}
              </Button>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content align="end" sideOffset={8} aria-label={copy.mobileDownloadAction} className={cn('w-[min(26rem,calc(100vw-2rem))] max-h-[var(--radix-popover-content-available-height)] overflow-y-auto rounded-xl border border-edge bg-surface-overlay p-6 sm:p-7 shadow-elevated', SETTINGS_SHELL_MODAL_POPOVER_Z)}>
                <p className="text-base font-semibold text-fg">{copy.mobileDownloadAction}</p>
                <div className="my-6 flex justify-center">
                  {appDownloadQr.data ? <img src={appDownloadQr.data} alt={copy.mobileDownloadQrAlt} width={216} height={216} className="size-[216px] max-w-full rounded-lg bg-white" /> : appDownloadQr.error ? <p role="status" className="text-sm text-warning">{f.qrFailed}</p> : <Skeleton className="size-[216px] max-w-full" />}
                </div>
                <p className="mt-3 text-sm leading-6 text-fg-muted">{copy.mobileDownloadHint}</p>
                <Button variant="secondary" className="mt-5 w-full" onClick={() => void openExternalHttpLink(mobileDownloadUrl)}>
                  <ExternalLink className="size-4" aria-hidden="true" />{copy.mobileDownload}
                </Button>
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root> : null}
          <button type="button" className="flex size-10 items-center justify-center rounded-lg text-fg-muted hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent" aria-label={f.cancel} onClick={onClose}><X className="size-4" aria-hidden="true" /></button>
        </div>
      </header>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-8 py-7">
        {connected ? <CheckCircle2 className="mb-5 size-7 text-success" /> : null}
        {needsRouteSetup ? (
          <div className="mb-4 flex flex-wrap items-center gap-1.5 text-xs font-medium" aria-label={copy.stepOne}>
            <span className="rounded-full bg-accent-soft px-2.5 py-0.5 text-accent-fg">{copy.stepSetupRoute}</span>
            <ChevronRight className="size-3.5 text-fg-subtle" aria-hidden="true" />
            <span className="rounded-full bg-surface-hover px-2.5 py-0.5 text-fg-muted">
              {targetKind === 'mobile' ? copy.stepMobileScan : copy.stepBrowserInvite}
            </span>
          </div>
        ) : null}
        <Dialog.Title className="text-xl font-semibold tracking-tight text-fg">{title}</Dialog.Title>
        <Dialog.Description className="mt-2 text-sm leading-relaxed text-fg-muted">
          {!started
            ? preparationHint
            : connected
              ? targetCopy.successHint
              : credentialsCommitted
                ? f.waitingForDevice
                : request
                  ? request.displayName
                  : setup
                    ? targetCopy.connectHint
                    : needsRouteSetup
                      ? copy.routeSetupReturnHint
                      : f.intro}
        </Dialog.Description>
        {errorMessage ? <p role="alert" className="mt-4 text-sm text-danger">{errorMessage}</p> : null}
        {started && readiness.error ? <p role="alert" className="mt-4 text-sm text-danger">{f.readinessFailed}</p> : null}
        {started && status.error ? <p role="status" className="mt-4 text-sm text-warning">{f.statusUnavailable}</p> : null}
        {!started ? <div className="mt-7">
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
        {!started ? <Button className="w-full" variant="primary" onClick={() => { setError(null); setStarted(true); }}>{copy.browserReady}</Button> : connected ? <Button className="w-full" variant="primary" onClick={onClose}>{f.done}</Button> : request?.status === 'pending' ? <div className="flex flex-col gap-2">
          <Button className="w-full" variant="primary" disabled={busy} onClick={() => void decide('approve')}>{f.allow}</Button>
          <Button className="w-full" variant="ghost" disabled={busy} onClick={() => void decide('reject')}>{f.cancel}</Button>
        </div> : readiness.error ? <Button className="w-full" variant="primary" onClick={() => void readiness.mutate()}>{f.retry}</Button>
          : <Button className="w-full" variant="primary" disabled={busy} onClick={() => void create()}>{f.retry}</Button>}
      </footer> : null}
    </Dialog.Content>
  </Dialog.Portal>;
}
