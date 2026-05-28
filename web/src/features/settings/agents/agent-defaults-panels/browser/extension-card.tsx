import { LoaderCircle, Play, Plug, PlugZap, Puzzle, Square, Unplug } from 'lucide-react';
import { useCallback, useState } from 'react';

import { AgentDefaultsField } from '../../agent-defaults-field';
import { inputClassName } from '../../defaults-field-styles';

import { ActionResultBox, BackendModeCard } from './backend-mode-card';
import type { BrowserMessages, DoctorState, ExtensionProbe } from './types';

const DEFAULT_PORT = 19820;

export interface ExtensionCardForm {
  port: number | undefined;
  host: string;
}

export function ExtensionCard({
  m,
  probe,
  form,
  onChange,
  startBridge,
  stopBridge,
}: {
  m: BrowserMessages;
  probe: DoctorState<ExtensionProbe>;
  form: ExtensionCardForm;
  onChange: (patch: Partial<ExtensionCardForm>) => void;
  startBridge: (opts?: { host?: string; port?: number }) => Promise<void>;
  stopBridge: () => Promise<void>;
}) {
  const [busy, setBusy] = useState<'start' | 'stop' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const port = form.port ?? DEFAULT_PORT;
  const host = form.host || '127.0.0.1';
  const wsUrl = `ws://${host}:${port}/browser-ext`;

  const running = probe.kind === 'ok' && probe.data.running;
  const connected = probe.kind === 'ok' && probe.data.connected;

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

  return (
    <BackendModeCard
      icon={Puzzle}
      title={m.browserBackendExtension}
      description={m.browserExtensionDownloadHint}
      m={m}
      primaryAction={
        running ? (
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
        )
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
      <div className="flex items-center justify-between gap-3 rounded-lg border border-edge bg-surface-base px-3 py-2">
        <span className="font-mono text-xs text-fg-muted">{wsUrl}</span>
        <span className={`inline-flex items-center gap-1.5 text-xs ${badge.color}`}>
          <BadgeIcon className="size-3.5" />
          <span>{badge.label}</span>
        </span>
      </div>
      <p className="text-[11px] leading-snug text-fg-subtle">{m.browserExtensionStartHint}</p>
      {error ? <ActionResultBox kind="error" message={error} /> : null}
    </BackendModeCard>
  );
}
