import {
  Download,
  ExternalLink,
  FolderOpen,
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

import { AgentDefaultsField } from '../../agent-defaults-field';
import { inputClassName } from '../../defaults-field-styles';

import { ActionResultBox, BackendModeCard } from './backend-mode-card';
import type { BrowserMessages, DoctorState, ExtensionArtifacts, ExtensionProbe } from './types';

const DEFAULT_PORT = 19820;

export interface ExtensionCardForm {
  port: number | undefined;
  host: string;
}

export function ExtensionCard({
  m,
  probe,
  artifacts,
  onChange,
  startBridge,
  stopBridge,
  installArtifacts,
  refetchArtifacts,
  openExtensionChrome,
  revealExtensionFolder,
  form,
}: {
  m: BrowserMessages;
  probe: DoctorState<ExtensionProbe>;
  artifacts: DoctorState<ExtensionArtifacts>;
  form: ExtensionCardForm;
  onChange: (patch: Partial<ExtensionCardForm>) => void;
  startBridge: (opts?: { host?: string; port?: number }) => Promise<void>;
  stopBridge: () => Promise<void>;
  installArtifacts: (opts?: { force?: boolean }) => Promise<ExtensionArtifacts | null>;
  refetchArtifacts: () => Promise<ExtensionArtifacts | null>;
  openExtensionChrome: () => Promise<void>;
  revealExtensionFolder: () => Promise<void>;
}) {
  const [busy, setBusy] = useState<'start' | 'stop' | 'install' | 'open' | 'folder' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [installMessage, setInstallMessage] = useState<string | null>(null);

  const port = form.port ?? DEFAULT_PORT;
  const host = form.host || '127.0.0.1';
  const wsUrl = `ws://${host}:${port}/browser-ext`;

  const running = probe.kind === 'ok' && probe.data.running;
  const connected = probe.kind === 'ok' && probe.data.connected;

  const artifactData = artifacts.kind === 'ok' ? artifacts.data : probe.kind === 'ok' ? probe.data.artifacts : undefined;
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

  const onRevealFolder = useCallback(async () => {
    if (!extensionDir || busy) return;
    setBusy('folder');
    setError(null);
    setInstallMessage(null);
    try {
      const copied = await copyTextToClipboard(extensionDir);
      await revealExtensionFolder();
      setInstallMessage(
        copied ? m.browserExtensionPathCopied : m.browserExtensionFolderOpened,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, [busy, extensionDir, m.browserExtensionFolderOpened, m.browserExtensionPathCopied, revealExtensionFolder]);

  return (
    <BackendModeCard
      icon={Puzzle}
      title={m.browserBackendExtension}
      description={m.browserExtensionDownloadHint}
      m={m}
      primaryAction={
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
          {running ? (
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
        </div>
      }
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
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3 rounded-lg border border-edge bg-surface-base px-3 py-2">
          <span className="font-mono text-xs text-fg-muted">{wsUrl}</span>
          <span className={`inline-flex items-center gap-1.5 text-xs ${badge.color}`}>
            <BadgeIcon className="size-3.5" />
            <span>{badge.label}</span>
          </span>
        </div>

        <div className="rounded-lg border border-edge bg-surface-base px-3 py-3">
          <p className="text-xs font-medium text-fg">{m.browserExtensionInstallGuideTitle}</p>
          <ol className="mt-2.5 list-decimal space-y-2.5 pl-4 text-[11px] leading-relaxed text-fg-muted">
            <li className="text-fg">{m.browserExtensionInstallStep1}</li>
            <li>
              <span className="text-fg">{m.browserExtensionInstallStep2}</span>
              {extensionDir ? (
                <div className="mt-2 rounded-md border border-edge bg-surface-raised px-2.5 py-2">
                  <p className="text-[10px] font-medium uppercase tracking-wide text-fg-subtle">
                    {m.browserExtensionInstallStep2FolderLabel}
                  </p>
                  <p className="mt-1 break-all font-mono text-[11px] text-fg">{extensionDir}</p>
                  <div className="mt-2 flex flex-wrap gap-3">
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 text-[11px] text-accent hover:underline disabled:opacity-60"
                      disabled={busy !== null}
                      onClick={() => void openChromeExtensions()}
                    >
                      <ExternalLink className="size-3" />
                      {m.browserExtensionOpenChrome}
                    </button>
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 text-[11px] text-accent hover:underline disabled:opacity-60"
                      disabled={busy !== null}
                      onClick={() => void onRevealFolder()}
                      title={extensionDir}
                    >
                      {busy === 'folder' ? (
                        <LoaderCircle className="size-3 animate-spin" />
                      ) : (
                        <FolderOpen className="size-3" />
                      )}
                      {m.browserExtensionRevealFolder}
                    </button>
                  </div>
                </div>
              ) : null}
            </li>
            <li className="text-fg">{m.browserExtensionInstallStep3}</li>
          </ol>
        </div>

        {needsChromeReload ? (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-800 dark:text-amber-200">
            {m.browserExtensionNeedsChromeReload}
          </div>
        ) : null}
        {installMessage ? <ActionResultBox kind="success" message={installMessage} /> : null}
        {error ? <ActionResultBox kind="error" message={error} /> : null}
      </div>
    </BackendModeCard>
  );
}
