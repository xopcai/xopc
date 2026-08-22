import { useEffect, useState } from 'react';

import { useMessages } from '../../i18n/messages';

import { subscribeRouteOverride, type RouteOverride } from './route-override';

export type RouteOverrideToast = {
  key: number;
  message: string;
  icon: 'check' | 'lan' | 'cloud';
} | null;

const DISPLAY_MS = 2_500;
const SHEET_OVERLAP_DELAY_MS = 150;

/** Confirms explicit route preferences without exposing background probing. */
export function useRouteOverrideToast(): RouteOverrideToast {
  const copy = useMessages().gateway.routeOverride;
  const [toast, setToast] = useState<RouteOverrideToast>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = subscribeRouteOverride((_profileId, override) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setToast(buildToast(override, copy)), SHEET_OVERLAP_DELAY_MS);
    });
    return () => {
      unsubscribe();
      if (timer) clearTimeout(timer);
    };
  }, [copy]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => {
      setToast((current) => current?.key === toast.key ? null : current);
    }, DISPLAY_MS);
    return () => clearTimeout(timer);
  }, [toast]);

  return toast;
}

function buildToast(
  override: RouteOverride,
  copy: { appliedAuto: string; appliedLan: string; appliedTunnel: string },
): NonNullable<RouteOverrideToast> {
  const key = Date.now();
  if (override === 'lan') return { key, message: copy.appliedLan, icon: 'lan' };
  if (override === 'tunnel') return { key, message: copy.appliedTunnel, icon: 'cloud' };
  return { key, message: copy.appliedAuto, icon: 'check' };
}
