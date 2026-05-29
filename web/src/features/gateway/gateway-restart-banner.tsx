import { Loader2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

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
  const pollGenRef = useRef(0);

  const startHealthPoll = useCallback(() => {
    const gen = ++pollGenRef.current;
    setRestarting(true);
    setTimedOut(false);

    void (async () => {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      const deadline = Date.now() + POLL_TIMEOUT_MS;
      while (gen === pollGenRef.current && Date.now() < deadline) {
        try {
          const res = await fetch(apiUrl('/api/health'), { signal: AbortSignal.timeout(3000) });
          if (res.ok) {
            window.location.reload();
            return;
          }
        } catch {
          // Expected while gateway is down.
        }
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      }
      if (gen === pollGenRef.current) {
        setTimedOut(true);
      }
    })();
  }, []);

  useEffect(() => {
    const handler = () => startHealthPoll();
    window.addEventListener('gateway-restart-initiated', handler);
    return () => {
      pollGenRef.current += 1;
      window.removeEventListener('gateway-restart-initiated', handler);
    };
  }, [startHealthPoll]);

  const handleRetry = useCallback(() => {
    startHealthPoll();
  }, [startHealthPoll]);

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
