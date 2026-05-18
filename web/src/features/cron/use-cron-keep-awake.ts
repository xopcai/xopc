import { useCallback, useEffect, useRef, useState } from 'react';

import { isElectronCronDisplayWakeAvailable } from '@/lib/electron-env';

type WakeMode = 'none' | 'electron' | 'navigator';

export function useCronKeepAwake(opts: { onUnavailable: () => void }) {
  const { onUnavailable } = opts;
  const [keepAwake, setKeepAwake] = useState(false);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const wakeModeRef = useRef<WakeMode>('none');
  const keepAwakeRef = useRef(keepAwake);
  const wakeSupported = typeof navigator !== 'undefined' && 'wakeLock' in navigator;
  const featureAvailable = wakeSupported || isElectronCronDisplayWakeAvailable();

  const releaseWakeLock = useCallback(async () => {
    if (wakeModeRef.current === 'electron') {
      try {
        await window.electronAPI?.cron?.setDisplaySleepPrevented?.(false);
      } catch {
        /* ignore */
      }
      wakeModeRef.current = 'none';
      return;
    }
    try {
      await wakeLockRef.current?.release();
    } catch {
      /* ignore */
    }
    wakeLockRef.current = null;
    wakeModeRef.current = 'none';
  }, []);

  const acquireWakeLock = useCallback(async () => {
    const electronWake =
      typeof window !== 'undefined' ? window.electronAPI?.cron?.setDisplaySleepPrevented : undefined;
    if (electronWake) {
      try {
        await electronWake(true);
        wakeModeRef.current = 'electron';
        return;
      } catch {
        onUnavailable();
        setKeepAwake(false);
        return;
      }
    }
    if (!wakeSupported) return;
    try {
      const sentinel = await navigator.wakeLock.request('screen');
      wakeLockRef.current = sentinel;
      wakeModeRef.current = 'navigator';
      sentinel.addEventListener('release', () => {
        wakeLockRef.current = null;
        wakeModeRef.current = 'none';
      });
    } catch {
      onUnavailable();
      setKeepAwake(false);
    }
  }, [onUnavailable, wakeSupported]);

  keepAwakeRef.current = keepAwake;

  useEffect(() => {
    if (!keepAwake) {
      void releaseWakeLock();
      return;
    }
    void acquireWakeLock();
    const onVis = () => {
      if (document.visibilityState === 'visible' && keepAwakeRef.current) void acquireWakeLock();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      void releaseWakeLock();
    };
  }, [keepAwake, acquireWakeLock, releaseWakeLock]);

  return { keepAwake, setKeepAwake, featureAvailable };
}
