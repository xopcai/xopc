import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

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
  | { kind: 'electron-error'; message: string }
  | { kind: 'npm-restarting'; version: string }
  | { kind: 'npm-restart-required'; version: string }
  | { kind: 'npm'; version: string; channel: string | null };

const ELECTRON_ERROR_PREVIEW_LEN = 160;

function truncateElectronErrorMessage(message: string): string {
  const t = message.trim();
  if (t.length <= ELECTRON_ERROR_PREVIEW_LEN) return t;
  return `${t.slice(0, ELECTRON_ERROR_PREVIEW_LEN - 1)}…`;
}

/**
 * Single source of truth for update reminder bars (left + right rails).
 * Dismiss persists in localStorage per version so the same build is not nagged again.
 */
export function useUpdateReminder() {
  const { npm, electron, isElectron, electronQuitAndInstall, runNpmUpdate, npmUpdateRunning } =
    useUpdateStatus();
  const [dismissed, setDismissed] = useState<Dismissed>(readDismissed);
  const [dismissUi, setDismissUi] = useState({ downloading: false, electronError: false });
  const [pendingNpmRestart, setPendingNpmRestart] = useState<{
    version: string;
    automatic: boolean;
  } | null>(() => {
    if (typeof window === 'undefined' || isElectronEnv) return null;
    try {
      const raw = sessionStorage.getItem(NPM_PENDING_RESTART_KEY);
      if (!raw) return null;
      const p = JSON.parse(raw) as { installedVersion?: string; automaticRestart?: boolean };
      const v = typeof p.installedVersion === 'string' ? p.installedVersion.trim() : '';
      return v ? { version: v, automatic: p.automaticRestart === true } : null;
    } catch {
      return null;
    }
  });

  const trackedElectronStateRef = useRef(electron?.state);
  if (trackedElectronStateRef.current !== electron?.state) {
    trackedElectronStateRef.current = electron?.state;
    if (electron?.state !== 'downloading' && dismissUi.downloading) {
      setDismissUi((ui) => ({ ...ui, downloading: false }));
    }
    if (electron?.state !== 'error' && dismissUi.electronError) {
      setDismissUi((ui) => ({ ...ui, electronError: false }));
    }
  }

  const clearedPendingRestartRef = useRef<string | null>(null);
  if (
    pendingNpmRestart &&
    npm?.currentVersion === pendingNpmRestart.version &&
    clearedPendingRestartRef.current !== pendingNpmRestart.version
  ) {
    clearedPendingRestartRef.current = pendingNpmRestart.version;
    try {
      sessionStorage.removeItem(NPM_PENDING_RESTART_KEY);
    } catch {
      /* ignore */
    }
    setPendingNpmRestart(null);
  }

  useEffect(() => {
    if (isElectron) return;
    const sync = () => {
      try {
        const raw = sessionStorage.getItem(NPM_PENDING_RESTART_KEY);
        if (!raw) {
          setPendingNpmRestart(null);
          return;
        }
        const p = JSON.parse(raw) as { installedVersion?: string; automaticRestart?: boolean };
        const v = typeof p.installedVersion === 'string' ? p.installedVersion.trim() : '';
        setPendingNpmRestart(
          v ? { version: v, automatic: p.automaticRestart === true } : null,
        );
      } catch {
        setPendingNpmRestart(null);
      }
    };
    sync();
    window.addEventListener('xopc:npm-update-installed', sync);
    return () => window.removeEventListener('xopc:npm-update-installed', sync);
  }, [isElectron]);

  useEffect(() => {
    const onRecheck = () => {
      setDismissUi((ui) => ({ ...ui, downloading: false }));
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
    if (isElectron && electron?.state === 'downloading' && !dismissUi.downloading) {
      return { kind: 'electron-downloading', percent: Math.round(electron.percent ?? 0) };
    }
    if (isElectron && electron?.state === 'error' && electron.message && !dismissUi.electronError) {
      return { kind: 'electron-error', message: truncateElectronErrorMessage(electron.message) };
    }
    if (
      !isElectron &&
      pendingNpmRestart &&
      npm &&
      npm.currentVersion !== pendingNpmRestart.version
    ) {
      return pendingNpmRestart.automatic
        ? { kind: 'npm-restarting', version: pendingNpmRestart.version }
        : { kind: 'npm-restart-required', version: pendingNpmRestart.version };
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
    dismissUi.downloading,
    dismissUi.electronError,
    isElectron,
    npm,
    pendingNpmRestart,
  ]);

  const dismiss = useCallback(() => {
    if (show.kind === 'electron-downloading') {
      setDismissUi((ui) => ({ ...ui, downloading: true }));
      return;
    }
    if (show.kind === 'electron-error') {
      setDismissUi((ui) => ({ ...ui, electronError: true }));
      return;
    }
    if (show.kind === 'npm-restart-required' || show.kind === 'npm-restarting') {
      try {
        sessionStorage.removeItem(NPM_PENDING_RESTART_KEY);
      } catch {
        /* ignore */
      }
      setPendingNpmRestart(null);
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
