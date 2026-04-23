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

const isElectronEnv =
  typeof window !== 'undefined' && (window as unknown as { electronAPI?: { updater?: unknown } }).electronAPI?.updater !== undefined;

export function useUpdateStatus(): UpdateStatus & {
  checkNow: () => Promise<void>;
  electronCheck: () => void;
  electronQuitAndInstall: () => void;
} {
  const [npm, setNpm] = useState<NpmUpdateStatus | null>(null);
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
