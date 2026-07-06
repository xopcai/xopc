/**
 * Listen for auto-route changes and surface a toast so the user knows when
 * the app silently switched to the cloud route (or back to LAN). Without
 * this, mysterious latency changes feel like the app is misbehaving.
 *
 * Returns the latest toast message; consumer renders it in their Snackbar.
 * The hook clears its own message after `displayMs`.
 */
import { useEffect, useRef, useState } from 'react';

import { useMessages } from '../../i18n/messages';

import { subscribeProbeOutcome, type ProbeOutcome } from './probe-coordinator';

export type RouteSwitchToast = { message: string; key: number } | null;

const DISPLAY_MS = 3_500;

export function useRouteSwitchToast(): RouteSwitchToast {
  const m = useMessages();
  const [toast, setToast] = useState<RouteSwitchToast>(null);
  const prevWinnerRef = useRef<'lan' | 'tunnel' | 'none' | null>(null);

  useEffect(() => {
    const unsub = subscribeProbeOutcome((outcome: ProbeOutcome) => {
      const next = outcome.result.winner;
      const prev = prevWinnerRef.current;
      if (prev != null && (next === 'lan' || next === 'tunnel') && prev !== next) {
        if (next === 'tunnel' && prev === 'lan') {
          setToast({ message: m.gateway.state.autoSwitchedToCloud, key: Date.now() });
        } else if (next === 'lan' && prev === 'tunnel') {
          setToast({ message: m.gateway.state.autoSwitchedToLan, key: Date.now() });
        }
      }
      prevWinnerRef.current = next;
    });
    return unsub;
  }, [m.gateway.state.autoSwitchedToCloud, m.gateway.state.autoSwitchedToLan]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), DISPLAY_MS);
    return () => clearTimeout(t);
  }, [toast]);

  return toast;
}
