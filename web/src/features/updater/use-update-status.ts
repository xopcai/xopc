import { useCallback, useEffect, useState } from 'react';

import { apiUrl } from '@/lib/url';
import { apiFetch } from '@/lib/fetch';

// --- Types ---

export type NpmUpdateStatus = {
  currentVersion: string;
  updateAvailable: boolean;
  latestVersion: string | null;
  channel: string | null;
};

export type ElectronUpdateState =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error';

export type ElectronUpdateStatus = {
  state: ElectronUpdateState;
  version?: string;
  releaseNotes?: string;
  percent?: number;
  bytesPerSecond?: number;
  transferred?: number;
  total?: number;
  message?: string;
};

export type UpdateStatus = {
  npm: NpmUpdateStatus | null;
  electron: ElectronUpdateStatus | null;
  isElectron: boolean;
};

export type NpmUpdateRunResult =
  | { ok: true; result: Record<string, unknown> | null }
  | { ok: false; error: string; message: string; status: number; result?: Record<string, unknown> | null };

const isElectronEnv =
  typeof window !== 'undefined' && (window as unknown as { electronAPI?: { updater?: unknown } }).electronAPI?.updater !== undefined;

export function useUpdateStatus(): UpdateStatus & {
  checkNow: () => Promise<void>;
  runNpmUpdate: () => Promise<NpmUpdateRunResult>;
  npmUpdateRunning: boolean;
  electronCheck: () => void;
  electronQuitAndInstall: () => void;
} {
  const [npm, setNpm] = useState<NpmUpdateStatus | null>(null);
  const [npmUpdateRunning, setNpmUpdateRunning] = useState(false);
  const [electron, setElectron] = useState<ElectronUpdateStatus | null>(
    isElectronEnv ? { state: 'idle' } : null,
  );

  useEffect(() => {
    void fetchNpmStatus().then(setNpm).catch(() => {});

    const handler = (e: Event) => {
      const detail = (e as CustomEvent<unknown>).detail;
      if (detail === null) {
        setNpm((prev) =>
          prev ? { ...prev, updateAvailable: false, latestVersion: null, channel: null } : prev,
        );
      } else if (detail && typeof detail === 'object') {
        const d = detail as { currentVersion?: string; latestVersion?: string; channel?: string };
        setNpm({
          currentVersion: d.currentVersion ?? '',
          updateAvailable: true,
          latestVersion: d.latestVersion ?? null,
          channel: d.channel ?? null,
        });
      }
    };
    window.addEventListener('update-available', handler);
    return () => window.removeEventListener('update-available', handler);
  }, []);

  useEffect(() => {
    if (!isElectronEnv) return;
    const api = (window as unknown as { electronAPI: { updater: {
      getStatus: () => Promise<ElectronUpdateStatus>;
      onStatusChanged: (cb: (s: ElectronUpdateStatus) => void) => () => void;
    } } }).electronAPI.updater;

    void api.getStatus().then((s) => setElectron(s));

    const cleanup = api.onStatusChanged((s) => setElectron(s));
    return cleanup;
  }, []);

  const checkNow = useCallback(async () => {
    try {
      const res = await apiFetch(apiUrl('/api/update/check'), { method: 'POST' });
      if (res.ok) {
        const json = (await res.json()) as { payload?: NpmUpdateStatus };
        if (json.payload) setNpm(json.payload);
      }
    } catch {
      /* silent */
    }
  }, []);

  const runNpmUpdate = useCallback(async (): Promise<NpmUpdateRunResult> => {
    setNpmUpdateRunning(true);
    try {
      const res = await apiFetch(apiUrl('/api/update/run'), { method: 'POST' });
      const json = (await res.json()) as {
        ok?: boolean;
        error?: string;
        message?: string;
        result?: Record<string, unknown> | null;
      };
      if (json.ok) {
        const r = json.result ?? null;
        if (r && typeof r === 'object' && r.status === 'ok' && typeof r.installedVersion === 'string') {
          window.dispatchEvent(
            new CustomEvent('xopc:npm-update-installed', { detail: { version: r.installedVersion } }),
          );
        } else if (
          r &&
          typeof r === 'object' &&
          r.status === 'up-to-date' &&
          typeof r.latestVersion === 'string'
        ) {
          window.dispatchEvent(
            new CustomEvent('xopc:npm-update-installed', { detail: { version: r.latestVersion } }),
          );
        }
        return { ok: true, result: r };
      }
      return {
        ok: false,
        error: String(json.error ?? 'unknown'),
        message: String(json.message ?? (res.ok ? 'Update failed' : `HTTP ${res.status}`)),
        status: res.status,
        result: json.result ?? null,
      };
    } catch (err) {
      return {
        ok: false,
        error: 'network',
        message: err instanceof Error ? err.message : String(err),
        status: 0,
      };
    } finally {
      setNpmUpdateRunning(false);
    }
  }, []);

  const electronCheck = useCallback(() => {
    if (isElectronEnv) {
      void (window as unknown as { electronAPI: { updater: { check: () => void } } }).electronAPI.updater.check();
    }
  }, []);

  const electronQuitAndInstall = useCallback(() => {
    if (isElectronEnv) {
      void (window as unknown as { electronAPI: { updater: { quitAndInstall: () => void } } }).electronAPI.updater.quitAndInstall();
    }
  }, []);

  return {
    npm,
    electron,
    isElectron: isElectronEnv,
    checkNow,
    runNpmUpdate,
    npmUpdateRunning,
    electronCheck,
    electronQuitAndInstall,
  };
}

async function fetchNpmStatus(): Promise<NpmUpdateStatus> {
  const res = await apiFetch(apiUrl('/api/update/status'));
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = (await res.json()) as { payload: NpmUpdateStatus };
  return json.payload;
}
