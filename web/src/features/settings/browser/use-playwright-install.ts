import { useCallback, useRef, useState } from 'react';

import {
  cancelPlaywrightChromiumInstall,
  installPlaywrightChromium,
  type BrowserInstallProgress,
} from './browser-control-api';

export function usePlaywrightInstall(onComplete: () => void) {
  const [running, setRunning] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [progress, setProgress] = useState<BrowserInstallProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const install = useCallback(async () => {
    if (abortRef.current) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    setProgress(null);
    setError(null);
    try {
      const result = await installPlaywrightChromium(setProgress, controller.signal);
      if (!result.ok) {
        if (result.error !== 'cancelled') setError(result.message ?? result.error);
        return;
      }
      onComplete();
    } catch (cause) {
      if (!controller.signal.aborted) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setRunning(false);
      setCancelling(false);
    }
  }, [onComplete]);

  const cancel = useCallback(async () => {
    if (!abortRef.current) return;
    setCancelling(true);
    await cancelPlaywrightChromiumInstall().catch(() => {});
    abortRef.current.abort();
  }, []);

  return { running, cancelling, progress, error, install, cancel };
}
