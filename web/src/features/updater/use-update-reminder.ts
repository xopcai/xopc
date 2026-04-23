import { useCallback, useEffect, useMemo, useState } from 'react';

import { useUpdateStatus } from '@/features/updater/use-update-status';

const STORAGE_KEY = 'xopc.updateReminder.dismissed';

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

  useEffect(() => {
    if (electron?.state !== 'downloading') {
      setHideDownloading(false);
    }
  }, [electron?.state]);

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
    window.addEventListener('xopc:npm-update-installed', handler as EventListener);
    return () => window.removeEventListener('xopc:npm-update-installed', handler as EventListener);
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
    if (npm?.updateAvailable && npm.latestVersion) {
      if (dismissed.npm === npm.latestVersion) {
        return { kind: 'none' };
      }
      return { kind: 'npm', version: npm.latestVersion, channel: npm.channel };
    }
    return { kind: 'none' };
  }, [dismissed.npm, dismissed.electronReady, electron, hideDownloading, isElectron, npm]);

  const dismiss = useCallback(() => {
    if (show.kind === 'electron-downloading') {
      setHideDownloading(true);
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
