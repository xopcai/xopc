import { Loader2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { cn } from '@/lib/cn';
import { apiUrl } from '@/lib/url';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';

/**
 * Full-width top banner that appears when a gateway restart has been triggered.
 * Polls /api/health until the gateway is back, then refreshes the page.
 */

const POLL_INTERVAL_MS = 1_500;
const POLL_TIMEOUT_MS = 90_000;

export function GatewayRestartBanner() {
  const language = useLocaleStore((s) => s.language);
  const t = messages(language).updatePanel;
  const [restarting, setRestarting] = useState(false);
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    const handler = () => {
      setRestarting(true);
      setTimedOut(false);
    };
    window.addEventListener('gateway-restart-initiated', handler);
    return () => window.removeEventListener('gateway-restart-initiated', handler);
  }, []);

  useEffect(() => {
    if (!restarting) return;

    let cancelled = false;
    const deadline = Date.now() + POLL_TIMEOUT_MS;

    // Wait a short moment before starting to poll (gateway needs time to shut down).
    const initialDelay = setTimeout(() => {
      pollHealth();
    }, 2000);

    async function pollHealth() {
      while (!cancelled && Date.now() < deadline) {
        try {
          const res = await fetch(apiUrl('/api/health'), { signal: AbortSignal.timeout(3000) });
          if (res.ok) {
            // Gateway is back — reload page.
            window.location.reload();
            return;
          }
        } catch {
          // Expected while gateway is down.
        }
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      }
      if (!cancelled) {
        setTimedOut(true);
      }
    }

    return () => {
      cancelled = true;
      clearTimeout(initialDelay);
    };
  }, [restarting]);

  const handleRetry = useCallback(() => {
    setTimedOut(false);
    // Re-trigger polling by toggling state.
    setRestarting(false);
    requestAnimationFrame(() => setRestarting(true));
  }, []);

  if (!restarting) return null;

  return (
    <div
      className={cn(
        'flex min-h-10 w-full items-center justify-center gap-2 border-b px-4 py-2 text-sm',
        timedOut
          ? 'border-red-500/20 bg-red-500/10 text-red-800 dark:text-red-200'
          : 'border-amber-500/25 bg-amber-500/10 text-amber-900 dark:text-amber-100',
      )}
    >
      {timedOut ? (
        <>
          <span>{t.restartPollTimeout}</span>
          <button
            type="button"
            onClick={handleRetry}
            className="ml-2 rounded bg-accent px-2 py-0.5 text-xs font-medium text-white hover:bg-accent/90"
          >
            {t.restartPollRetry}
          </button>
        </>
      ) : (
        <>
          <Loader2 className="size-4 animate-spin" aria-hidden />
          <span>{t.restartPolling}</span>
        </>
      )}
    </div>
  );
}
