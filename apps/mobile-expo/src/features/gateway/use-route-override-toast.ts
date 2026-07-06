/**
 * Snackbar feedback for manual route override changes — distinct from
 * `useRouteSwitchToast` which fires on automatic LAN↔Cloud race winner
 * changes. This one confirms the user's explicit choice from the
 * long-press menu and, for the 'auto' case, morphs into a micro state
 * machine that tracks the next probe outcome:
 *
 *   pick auto   → pending spinner + "测试最快路径"
 *               → ok        + "自动 · 选中局域网 (87 ms)"
 *               → error     + "自动 · 无法连接到网关"
 *
 * For lan/tunnel choices we skip the pending state — the user already
 * made an explicit decision; the toast just confirms it.
 */
import { useEffect, useRef, useState } from 'react';

import { useMessages } from '../../i18n/messages';

import {
  subscribeProbeOutcome,
  type ProbeOutcome,
} from './probe-coordinator';
import { subscribeRouteOverride, type RouteOverride } from './route-override';

export type RouteOverrideToastStatus = 'pending' | 'ok' | 'error';

export type RouteOverrideToast = {
  /** Stable key per emission so consecutive toasts re-mount the Snackbar. */
  key: number;
  status: RouteOverrideToastStatus;
  message: string;
  /** Drives the leading icon: 'spinner' for pending, 'check'/'error' on
   * resolution, or the route-flavoured 'lan'/'cloud' for instant
   * confirmations. */
  icon: 'spinner' | 'check' | 'error' | 'lan' | 'cloud';
} | null;

const PENDING_DISPLAY_MS = 8_000; // hold pending until probe lands or we time out
const RESOLVED_DISPLAY_MS = 2_500;
const SHEET_OVERLAP_DELAY_MS = 150;

export function useRouteOverrideToast(): RouteOverrideToast {
  const m = useMessages();
  const copy = m.gateway.routeOverride;
  const [toast, setToast] = useState<RouteOverrideToast>(null);
  /** When auto was picked, we wait for the next probe outcome. This holds
   * the toast key so we can morph the existing toast in place instead of
   * stacking a fresh one on top. */
  const awaitingAutoRef = useRef<{ key: number } | null>(null);

  useEffect(() => {
    const pendingTimers: ReturnType<typeof setTimeout>[] = [];

    const unsubOverride = subscribeRouteOverride((_profileId, override) => {
      const timer = setTimeout(() => {
        const next = buildOverrideToast(override, copy);
        setToast(next);
        if (next.status === 'pending') {
          awaitingAutoRef.current = { key: next.key };
        } else {
          awaitingAutoRef.current = null;
        }
      }, SHEET_OVERLAP_DELAY_MS);
      pendingTimers.push(timer);
    });

    const unsubProbe = subscribeProbeOutcome((outcome: ProbeOutcome) => {
      const awaiting = awaitingAutoRef.current;
      if (!awaiting) return;
      awaitingAutoRef.current = null;
      setToast({ ...resolveAutoToast(outcome, copy), key: awaiting.key });
    });

    return () => {
      unsubOverride();
      unsubProbe();
      pendingTimers.forEach(clearTimeout);
    };
  }, [copy]);

  // Auto-clear logic. Pending toasts get a generous timeout so a slow
  // probe still lands before we hide; resolved toasts dismiss quickly.
  useEffect(() => {
    if (!toast) return;
    const ttl = toast.status === 'pending' ? PENDING_DISPLAY_MS : RESOLVED_DISPLAY_MS;
    const t = setTimeout(() => {
      setToast((prev) => (prev?.key === toast.key ? null : prev));
      if (toast.status === 'pending') awaitingAutoRef.current = null;
    }, ttl);
    return () => clearTimeout(t);
  }, [toast]);

  return toast;
}

type OverrideCopy = {
  appliedAuto: string;
  appliedAutoOkLan: string;
  appliedAutoOkTunnel: string;
  appliedAutoFail: string;
  appliedLan: string;
  appliedTunnel: string;
};

function buildOverrideToast(
  override: RouteOverride,
  copy: OverrideCopy,
): NonNullable<RouteOverrideToast> {
  const key = Date.now();
  switch (override) {
    case 'auto':
      return { key, status: 'pending', message: copy.appliedAuto, icon: 'spinner' };
    case 'lan':
      return { key, status: 'ok', message: copy.appliedLan, icon: 'lan' };
    case 'tunnel':
      return { key, status: 'ok', message: copy.appliedTunnel, icon: 'cloud' };
  }
}

function resolveAutoToast(
  outcome: ProbeOutcome,
  copy: OverrideCopy,
): Omit<NonNullable<RouteOverrideToast>, 'key'> {
  if (!outcome.online || outcome.result.winner === 'none') {
    return { status: 'error', message: copy.appliedAutoFail, icon: 'error' };
  }
  const latency = outcome.result.latencyMs ?? 0;
  const formatted = Math.max(0, Math.round(latency));
  if (outcome.result.winner === 'lan') {
    return {
      status: 'ok',
      message: copy.appliedAutoOkLan.replace('{{latency}}', String(formatted)),
      icon: 'lan',
    };
  }
  return {
    status: 'ok',
    message: copy.appliedAutoOkTunnel.replace('{{latency}}', String(formatted)),
    icon: 'cloud',
  };
}
