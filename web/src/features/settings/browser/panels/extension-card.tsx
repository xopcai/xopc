import {
  Download,
  LoaderCircle,
  Play,
  Plug,
  PlugZap,
  Puzzle,
  Square,
  Unplug,
} from 'lucide-react';
import { useCallback, useState } from 'react';

import { copyTextToClipboard } from '@/lib/copy-to-clipboard';

import { AgentDefaultsField } from '.././browser-settings-field';
import { inputClassName } from '../../agents/defaults-field-styles';

import { ActionResultBox, BackendModeCard } from './backend-mode-card';
import { ExtensionSetupGuide } from './extension-setup-guide';
import type { BrowserMessages, DoctorState, ExtensionArtifacts, ExtensionProbe } from './types';

const DEFAULT_PORT = 19820;
const DEFAULT_CONNECTION_TIMEOUT_MS = 30_000;

export interface ExtensionCardForm {
  port: number | undefined;
  host: string;
  connectionTimeoutMs: number | undefined;
}

export function ExtensionCard({
  m,
  probe,
  artifacts,
  onChange,
  startBridge,
  stopBridge,
  disconnectExtension,
  installArtifacts,
  refetchArtifacts,
  openExtensionChrome,
  revealExtensionFolder,
  form,
  embedded = false,
}: {
  m: BrowserMessages;
  probe: DoctorState<ExtensionProbe>;
  artifacts: DoctorState<ExtensionArtifacts>;
  form: ExtensionCardForm;
  onChange: (patch: Partial<ExtensionCardForm>) => void;
  startBridge: (opts?: { host?: string; port?: number }) => Promise<void>;
  stopBridge: () => Promise<void>;
  disconnectExtension: () => Promise<void>;
  installArtifacts: (opts?: { force?: boolean }) => Promise<ExtensionArtifacts | null>;
  refetchArtifacts: () => Promise<ExtensionArtifacts | null>;
  openExtensionChrome: () => Promise<void>;
  revealExtensionFolder: () => Promise<void>;
  embedded?: boolean;
}) {
  const [busy, setBusy] = useState<'start' | 'stop' | 'disconnect' | 'install' | 'open' | 'path' | 'folder' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [installMessage, setInstallMessage] = useState<string | null>(null);

  const port = form.port ?? DEFAULT_PORT;
  const host = form.host || '127.0.0.1';
  const wsUrl = `ws://${host}:${port}/browser-ext`;

  const running = probe.kind === 'ok' && probe.data.running;
  const connected = probe.kind === 'ok' && probe.data.connected;
  const bridgeHeld = probe.kind === 'ok' && probe.data.bridgeHeld === true;
  const portConflict = probe.kind === 'ok' && probe.data.portConflict === true;
  const canStopBridge = running || bridgeHeld;

  const artifactData =
    artifacts.kind === 'ok' ? artifacts.data : probe.kind === 'ok' ? probe.data.artifacts : undefined;
  const installed = artifactData?.installed === true;
  const extensionDir = artifactData?.extensionDir;
  const needsChromeReload = artifactData?.needsChromeReload === true;

  const badge =
    probe.kind !== 'ok'
      ? { icon: Unplug, color: 'text-fg-muted', label: '…' }
      : connected
        ? { icon: PlugZap, color: 'text-green-500', label: m.browserExtensionConnected }
        : running
          ? { icon: Plug, color: 'text-amber-500', label: m.browserExtensionWaiting }
          : { icon: Unplug, color: 'text-fg-muted', label: m.browserExtensionServerOff };
  const BadgeIcon = badge.icon;

  const onStart = useCallback(async () => {
    if (busy) return;
    setBusy('start');
    setError(null);
    try {
      await startBridge({ host, port });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, [busy, host, port, startBridge]);

  const onStop = useCallback(async () => {
    if (busy) return;
    setBusy('stop');
    setError(null);
    try {
      await stopBridge();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, [busy, stopBridge]);

  const onDisconnect = useCallback(async () => {
    if (busy) return;
    setBusy('disconnect');
    setError(null);
    try {
      await disconnectExtension();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, [busy, disconnectExtension]);

  const onInstall = useCallback(async () => {
    if (busy) return;
    setBusy('install');
    setError(null);
    setInstallMessage(null);
    try {
      const result = await installArtifacts({ force: installed });
      if (result?.extensionDir) {
        setInstallMessage(`${m.browserExtensionInstalled}: ${result.extensionDir}`);
      } else {
        setInstallMessage(m.browserExtensionInstalled);
      }
      await refetchArtifacts();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, [busy, installArtifacts, installed, m.browserExtensionInstalled, refetchArtifacts]);

  const openChromeExtensions = useCallback(async () => {
    if (busy) return;
    setBusy('open');
    setError(null);
    try {
      await openExtensionChrome();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, [busy, openExtensionChrome]);

  const onCopyPath = useCallback(async () => {
    if (!extensionDir || busy) return;
    setBusy('path');
    setError(null);
    setInstallMessage(null);
    try {
      const copied = await copyTextToClipboard(extensionDir);
      if (copied) {
        setInstallMessage(m.browserExtensionPathCopied);
      } else {
        setInstallMessage(m.browserExtensionPathCopyFailed);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, [busy, extensionDir, m.browserExtensionPathCopied, m.browserExtensionPathCopyFailed]);

  const onRevealFolder = useCallback(async () => {
    if (!extensionDir || busy) return;
    setBusy('folder');
    setError(null);
    setInstallMessage(null);
    try {
      await revealExtensionFolder();
      setInstallMessage(m.browserExtensionFolderOpened);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, [busy, extensionDir, m.browserExtensionFolderOpened, revealExtensionFolder]);

  const primaryAction = (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        className="inline-flex items-center gap-1.5 rounded-lg border border-edge bg-surface-panel px-2.5 py-1.5 text-xs font-medium text-fg hover:bg-surface-raised disabled:cursor-not-allowed disabled:opacity-60"
        disabled={busy !== null}
        onClick={() => void onInstall()}
      >
        {busy === 'install' ? (
          <LoaderCircle className="size-3.5 animate-spin" />
        ) : (
          <Download className="size-3.5" />
        )}
        {busy === 'install' ? m.browserExtensionInstalling : m.browserExtensionInstall}
      </button>
      {canStopBridge ? (
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-lg border border-edge bg-surface-panel px-2.5 py-1.5 text-xs font-medium text-fg hover:bg-surface-raised disabled:cursor-not-allowed disabled:opacity-60"
          disabled={busy !== null}
          onClick={() => void onStop()}
        >
          {busy === 'stop' ? <LoaderCircle className="size-3.5 animate-spin" /> : <Square className="size-3.5" />}
          {m.browserExtensionStopBridge}
        </button>
      ) : (
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-lg border border-edge bg-surface-panel px-2.5 py-1.5 text-xs font-medium text-fg hover:bg-surface-raised disabled:cursor-not-allowed disabled:opacity-60"
          disabled={busy !== null}
          onClick={() => void onStart()}
        >
          {busy === 'start' ? <LoaderCircle className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
          {busy === 'start' ? m.browserExtensionStarting : m.browserExtensionStartBridge}
        </button>
      )}
      {connected ? (
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-lg border border-edge bg-surface-panel px-2.5 py-1.5 text-xs font-medium text-fg hover:bg-surface-raised disabled:cursor-not-allowed disabled:opacity-60"
          disabled={busy !== null}
          onClick={() => void onDisconnect()}
        >
          {busy === 'disconnect' ? (
            <LoaderCircle className="size-3.5 animate-spin" />
          ) : (
            <Unplug className="size-3.5" />
          )}
          {m.browserExtensionDisconnect}
        </button>
      ) : null}
    </div>
  );

  return (
    <BackendModeCard
      icon={Puzzle}
      title={m.browserBackendExtension}
      description={m.browserExtensionDownloadHint}
      m={m}
      embedded={embedded}
      primaryAction={primaryAction}
      advancedTitle={m.browserAdvancedShow}
      advanced={
        <div className="grid gap-5 sm:grid-cols-2">
          <AgentDefaultsField label={m.label.browserExtensionPort} description={m.desc.browserExtensionPort}>
            <input
              type="number"
              className={inputClassName()}
              min={1024}
              max={65535}
              value={form.port ?? ''}
              placeholder={String(DEFAULT_PORT)}
              onChange={(e) => {
                const v = e.target.value;
                onChange({ port: v === '' ? undefined : Number.parseInt(v, 10) });
              }}
            />
          </AgentDefaultsField>
          <AgentDefaultsField label={m.label.browserExtensionHost} description={m.desc.browserExtensionHost}>
            <input
              type="text"
              className={inputClassName()}
              value={form.host}
              placeholder="127.0.0.1"
              onChange={(e) => onChange({ host: e.target.value })}
              autoComplete="off"
            />
          </AgentDefaultsField>
          <AgentDefaultsField
            label={m.label.browserExtensionConnectionTimeout}
            description={m.desc.browserExtensionConnectionTimeout}
          >
            <input
              type="number"
              className={inputClassName()}
              min={1}
              step={1}
              value={
                form.connectionTimeoutMs != null
                  ? Math.round(form.connectionTimeoutMs / 1000)
                  : ''
              }
              placeholder={String(DEFAULT_CONNECTION_TIMEOUT_MS / 1000)}
              onChange={(e) => {
                const v = e.target.value;
                onChange({
                  connectionTimeoutMs:
                    v === '' ? undefined : Math.max(1, Number.parseInt(v, 10)) * 1000,
                });
              }}
            />
          </AgentDefaultsField>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3 rounded-lg bg-surface-base px-3 py-2 shadow-surface">
          <span className="font-mono text-xs text-fg-muted">{wsUrl}</span>
          <span className={`inline-flex items-center gap-1.5 text-xs ${badge.color}`}>
            <BadgeIcon className="size-3.5" />
            <span>{badge.label}</span>
          </span>
        </div>

        <ExtensionSetupGuide
          m={m}
          installed={installed}
          extensionDir={extensionDir}
          connected={connected}
          busy={busy !== null}
          pathBusy={busy === 'path'}
          folderBusy={busy === 'folder'}
          onOpenChrome={() => void openChromeExtensions()}
          onCopyPath={() => void onCopyPath()}
          onRevealFolder={() => void onRevealFolder()}
        />

        {needsChromeReload ? (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-800 dark:text-amber-200">
            {m.browserExtensionNeedsChromeReload}
          </div>
        ) : null}
        {portConflict ? (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-800 dark:text-amber-200">
            {m.browserExtensionPortConflict.replace('{{port}}', String(port))}
          </div>
        ) : null}
        {installMessage ? <ActionResultBox kind="success" message={installMessage} /> : null}
        {error ? <ActionResultBox kind="error" message={error} /> : null}
      </div>
    </BackendModeCard>
  );
}
