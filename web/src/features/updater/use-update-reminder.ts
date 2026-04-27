import { useCallback, useEffect, useMemo, useState } from 'react';

import { NPM_PENDING_RESTART_KEY, useUpdateStatus } from '@/features/updater/use-update-status';

const STORAGE_KEY = 'xopc.updateReminder.dismissed';

const isElectronEnv =
  typeof window !== 'undefined' &&
  (window as unknown as { electronAPI?: { updater?: unknown } }).electronAPI?.updater !== undefined;

/** About / menu “check updates”: clear Electron dismissal so the top bar can show again after a manual check. */
export const XOPC_ELECTRON_UPDATE_RECHECK_EVENT = 'xopc:electron-update-recheck';

type Dismissed = {
  /** Dismissed npm "available" reminder for this registry version string. */
  npm?: string;
  /** Dismissed Electron "ready to install" for this app version. */
  electronReady?: string;
};

function readDismissed(): Dismissed {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const p = JSON.parse(raw) as Dismissed;
    return p && typeof p === 'object' ? p : {};
  } catch {
    return {};
  }
}

export type UpdateReminderView =
  | { kind: 'none' }
  | { kind: 'electron-ready'; version: string }
  | { kind: 'electron-downloading'; percent: number }
  | { kind: 'npm-restart-required'; version: string }
  | { kind: 'npm'; version: string; channel: string | null };

/**
 * Single source of truth for update reminder bars (left + right rails).
 * Dismiss persists in localStorage per version so the same build is not nagged again.
 */
export function useUpdateReminder() {
  const { npm, electron, isElectron, electronQuitAndInstall, runNpmUpdate, npmUpdateRunning } =
    useUpdateStatus();
  const [dismissed, setDismissed] = useState<Dismissed>(readDismissed);
  const [hideDownloading, setHideDownloading] = useState(false);
  const [pendingNpmRestartVersion, setPendingNpmRestartVersion] = useState<string | null>(() => {
    if (typeof window === 'undefined' || isElectronEnv) return null;
    try {
      const raw = sessionStorage.getItem(NPM_PENDING_RESTART_KEY);
      if (!raw) return null;
      const p = JSON.parse(raw) as { installedVersion?: string };
      const v = typeof p.installedVersion === 'string' ? p.installedVersion.trim() : '';
      return v || null;
    } catch {
      return null;
    }
  });

  useEffect(() => {
    if (electron?.state !== 'downloading') {
      setHideDownloading(false);
    }
  }, [electron?.state]);

  useEffect(() => {
    if (isElectron) return;
    const sync = () => {
      try {
        const raw = sessionStorage.getItem(NPM_PENDING_RESTART_KEY);
        if (!raw) {
          setPendingNpmRestartVersion(null);
          return;
        }
        const p = JSON.parse(raw) as { installedVersion?: string };
        const v = typeof p.installedVersion === 'string' ? p.installedVersion.trim() : '';
        setPendingNpmRestartVersion(v || null);
      } catch {
        setPendingNpmRestartVersion(null);
      }
    };
    sync();
    window.addEventListener('xopc:npm-update-installed', sync);
    return () => window.removeEventListener('xopc:npm-update-installed', sync);
  }, [isElectron]);

  useEffect(() => {
    if (!npm?.currentVersion || !pendingNpmRestartVersion) return;
    if (npm.currentVersion === pendingNpmRestartVersion) {
      try {
        sessionStorage.removeItem(NPM_PENDING_RESTART_KEY);
      } catch {
        /* ignore */
      }
      setPendingNpmRestartVersion(null);
    }
  }, [npm?.currentVersion, pendingNpmRestartVersion]);

  useEffect(() => {
    const onRecheck = () => {
      setHideDownloading(false);
      setDismissed((prev) => {
        const next: Dismissed = { ...prev };
        delete next.electronReady;
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        } catch {
          /* ignore */
        }
        return next;
      });
    };
    window.addEventListener(XOPC_ELECTRON_UPDATE_RECHECK_EVENT, onRecheck);
    return () => window.removeEventListener(XOPC_ELECTRON_UPDATE_RECHECK_EVENT, onRecheck);
  }, []);

  /** After one-click npm install, hide the bar for the installed version until the next check. */
  useEffect(() => {
    const handler = (e: Event) => {
      const v = (e as CustomEvent<{ version?: string }>).detail?.version?.trim();
      if (!v) return;
      setDismissed((prev) => {
        const next: Dismissed = { ...prev, npm: v };
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        } catch {
          /* ignore */
        }
        return next;
      });
    };
    window.addEventListener('xopc:npm-update-installed', handler);
    return () => window.removeEventListener('xopc:npm-update-installed', handler);
  }, []);

  const show: UpdateReminderView = useMemo(() => {
    if (isElectron && electron?.state === 'downloaded' && electron.version) {
      if (dismissed.electronReady === electron.version) {
        return { kind: 'none' };
      }
      return { kind: 'electron-ready', version: electron.version };
    }
    if (isElectron && electron?.state === 'downloading' && !hideDownloading) {
      return { kind: 'electron-downloading', percent: Math.round(electron.percent ?? 0) };
    }
    if (
      !isElectron &&
      pendingNpmRestartVersion &&
      npm &&
      npm.currentVersion !== pendingNpmRestartVersion
    ) {
      return { kind: 'npm-restart-required', version: pendingNpmRestartVersion };
    }
    if (!isElectron && npm?.updateAvailable && npm.latestVersion) {
      if (dismissed.npm === npm.latestVersion) {
        return { kind: 'none' };
      }
      return { kind: 'npm', version: npm.latestVersion, channel: npm.channel };
    }
    return { kind: 'none' };
  }, [
    dismissed.npm,
    dismissed.electronReady,
    electron,
    hideDownloading,
    isElectron,
    npm,
    pendingNpmRestartVersion,
  ]);

  const dismiss = useCallback(() => {
    if (show.kind === 'electron-downloading') {
      setHideDownloading(true);
      return;
    }
    if (show.kind === 'npm-restart-required') {
      try {
        sessionStorage.removeItem(NPM_PENDING_RESTART_KEY);
      } catch {
        /* ignore */
      }
      setPendingNpmRestartVersion(null);
      return;
    }
    if (show.kind === 'none') return;
    const next: Dismissed = { ...dismissed };
    if (show.kind === 'npm') {
      next.npm = show.version;
    } else if (show.kind === 'electron-ready') {
      next.electronReady = show.version;
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
    setDismissed(next);
  }, [dismissed, show]);

  return {
    show,
    dismiss,
    electronQuitAndInstall,
    runNpmUpdate,
    npmUpdateRunning,
  };
}

export type UpdateReminderController = ReturnType<typeof useUpdateReminder>;
