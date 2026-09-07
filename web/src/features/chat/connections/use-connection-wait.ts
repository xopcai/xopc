import { useCallback, useEffect, useRef, useState } from 'react';
import useSWR from 'swr';
import type { ConnectionWaitSnapshot } from '@xopcai/gateway-contract';
import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';
import { closeOAuthAuthorizationWindow, openOAuthAuthorizationUrl, reserveOAuthAuthorizationWindow } from '@/features/settings/oauth-authorization-window';

export type ConnectionActionName = 'connect' | 'check' | 'continue' | 'skip' | 'cancel' | 'select_account' | 'confirm_scope' | 'replace_source';
export function useConnectionWait(sessionKey: string) {
  const path = `/api/sessions/${encodeURIComponent(sessionKey)}/connection-wait`;
  const { data, mutate, isLoading } = useSWR(path, async path => {
    const response = await fetchJson<{ payload: ConnectionWaitSnapshot }>(apiUrl(path));
    return response.payload;
  }, { refreshInterval: snapshot => snapshot?.wait ? 5_000 : 0, revalidateOnFocus: true });
  const current = useRef(data);
  current.current = data;
  const locked = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const act = useCallback(async (action: ConnectionActionName, needKey?: string, accountId?: string, candidateRef?: string) => {
    const snapshot = current.current;
    const wait = snapshot?.wait;
    if (!wait || locked.current) return;
    locked.current = true;
    setBusy(true);
    setError(undefined);
    const popup = action === 'connect' ? reserveOAuthAuthorizationWindow() : null;
    try {
      const response = await fetchJson<{ payload: { snapshot: ConnectionWaitSnapshot; authorizationUrl?: string } }>(apiUrl(`${path}/actions`), {
        method: 'POST', body: JSON.stringify({ action, needKey, accountId, candidateRef, waitId: wait.id,
          expectedSessionId: snapshot.sessionId, expectedVersion: wait.version, idempotencyKey: crypto.randomUUID() }),
      });
      const next = response.payload.snapshot;
      await mutate(previous => !previous || previous.sessionId !== next.sessionId || next.revision >= previous.revision ? next : previous, false);
      if (response.payload.authorizationUrl) {
        if (!await openOAuthAuthorizationUrl(response.payload.authorizationUrl, popup)) throw new Error('Unable to open the authorization window. Allow pop-ups, then retry.');
      } else closeOAuthAuthorizationWindow(popup);
    } catch (error) {
      closeOAuthAuthorizationWindow(popup);
      if ((error as { status?: number }).status !== 409) setError(error instanceof Error ? error.message : String(error));
      await mutate();
    } finally { locked.current = false; setBusy(false); }
  }, [path, mutate]);
  useEffect(() => {
    const refresh = (event: Event) => {
      const detail = (event as CustomEvent<{ sessionKey?: string; revision?: number }>).detail;
      if (detail?.sessionKey === sessionKey && (detail.revision ?? Infinity) > (current.current?.revision ?? 0)) void mutate();
    };
    window.addEventListener('session-connection-wait-changed', refresh);
    return () => window.removeEventListener('session-connection-wait-changed', refresh);
  }, [sessionKey, mutate]);
  return { wait: data?.wait, isLoading, busy, error, act };
}
