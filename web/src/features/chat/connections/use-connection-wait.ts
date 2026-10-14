import { useCallback, useEffect, useRef, useState } from 'react';
import useSWR from 'swr';
import type { ConnectionWaitSnapshot } from '@xopcai/gateway-contract';
import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';
import { readLocalSessionDraft } from '@/features/chat/session/local-session-drafts';
import { useChatSessionStore } from '@/features/chat/session/chat-session-store';
import { useLocaleStore } from '@/stores/locale-store';
import { closeOAuthAuthorizationWindow, openOAuthAuthorizationUrl, reserveOAuthAuthorizationWindow } from '@/features/settings/oauth-authorization-window';

export type ConnectionActionName = 'install_complete' | 'connect' | 'check' | 'skip' | 'cancel' | 'select_account' | 'confirm_scope' | 'replace_source';
export function useConnectionWait(conversationId: string) {
  const path = `/api/sessions/${encodeURIComponent(conversationId)}/connection-wait`;
  const localDraft = useChatSessionStore((s) => s.sessions[conversationId]?.localDraft);
  const { data, mutate, isLoading } = useSWR(localDraft ? null : [path, localDraft === false ? 'persisted' : 'unknown'], async () => {
    if (await readLocalSessionDraft(conversationId)) return null;
    const response = await fetchJson<{ payload: ConnectionWaitSnapshot }>(apiUrl(path));
    return response.payload;
  }, { refreshInterval: snapshot => snapshot?.wait ? 5_000 : 0, revalidateOnFocus: true });
  const current = useRef(data);
  current.current = data;
  const locked = useRef(false);
  const cancelling = useRef(false);
  const pending = useRef(0);
  const attempt = useRef<{ signature: string; key: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [cancellationError, setCancellationError] = useState<string>();
  const act = useCallback(async (action: ConnectionActionName, needKey?: string, accountId?: string, candidateRef?: string, instanceId?: string): Promise<boolean> => {
    const snapshot = current.current;
    const wait = snapshot?.wait;
    if (!wait || (action === 'cancel' ? cancelling.current : locked.current || cancelling.current)) return false;
    if (action === 'cancel') cancelling.current = true;
    else locked.current = true;
    pending.current += 1;
    setBusy(true);
    setError(undefined);
    if (action === 'cancel') setCancellationError(undefined);
    const popup = action === 'connect' ? reserveOAuthAuthorizationWindow() : null;
    const signature = JSON.stringify([wait.id, wait.objectiveRevision, action, needKey, accountId, candidateRef, instanceId]);
    if (attempt.current?.signature !== signature) attempt.current = { signature, key: crypto.randomUUID() };
    const idempotencyKey = attempt.current.key;
    const send = (target: ConnectionWaitSnapshot) => fetchJson<{ payload: { snapshot: ConnectionWaitSnapshot; authorizationUrl?: string } }>(apiUrl(`${path}/actions`), {
      method: 'POST', body: JSON.stringify({ action, needKey, accountId, candidateRef, instanceId, waitId: wait.id,
        expectedTranscriptId: target.transcriptId, expectedVersion: target.wait!.version,
        ...(action === 'cancel' ? { expectedObjectiveRevision: wait.objectiveRevision } : {}), idempotencyKey }),
    });
    try {
      let response;
      try { response = await send(snapshot); }
      catch (error) {
        if (action !== 'cancel' || (error as { status?: number }).status !== 409) throw error;
        const refreshed = (await fetchJson<{ payload: ConnectionWaitSnapshot }>(apiUrl(path))).payload;
        await mutate(previous => !previous || previous.transcriptId !== refreshed.transcriptId || refreshed.revision >= previous.revision ? refreshed : previous, false);
        if (refreshed.transcriptId !== snapshot.transcriptId || refreshed.wait?.id !== wait.id
          || refreshed.wait.objectiveRevision !== wait.objectiveRevision) throw error;
        // Phase updates may advance the version; never cancel a revised objective.
        response = await send(refreshed);
      }
      const next = response.payload.snapshot;
      await mutate(previous => !previous || previous.transcriptId !== next.transcriptId || next.revision >= previous.revision ? next : previous, false);
      if (response.payload.authorizationUrl) {
        if (!await openOAuthAuthorizationUrl(response.payload.authorizationUrl, popup)) throw new Error('Unable to open the authorization window. Allow pop-ups, then retry.');
      } else closeOAuthAuthorizationWindow(popup);
      if (attempt.current?.signature === signature) attempt.current = null;
      return true;
    } catch (error) {
      closeOAuthAuthorizationWindow(popup);
      if ((error as { status?: number }).status === 409 && action === 'cancel') {
        const message = useLocaleStore.getState().language === 'zh'
          ? '目标状态已变化，未能取消。请检查当前任务状态后再试。'
          : 'The objective state changed and cancellation was not confirmed. Check its current status and try again.';
        setError(message);
        setCancellationError(message);
      } else if ((error as { status?: number }).status !== 409) {
        const message = error instanceof Error ? error.message : String(error);
        setError(message);
        if (action === 'cancel') setCancellationError(message);
      }
      await mutate();
      return false;
    } finally {
      if (action === 'cancel') cancelling.current = false;
      else locked.current = false;
      pending.current -= 1;
      setBusy(pending.current > 0);
    }
  }, [path, mutate]);
  useEffect(() => {
    const refresh = (event: Event) => {
      const detail = (event as CustomEvent<{ conversationId?: string; revision?: number }>).detail;
      if (detail?.conversationId === conversationId && (detail.revision ?? Infinity) > (current.current?.revision ?? 0)) void mutate();
    };
    window.addEventListener('session-connection-wait-changed', refresh);
    const reconnect = () => { void mutate(); };
    window.addEventListener('gateway-realtime-connected', reconnect);
    return () => {
      window.removeEventListener('session-connection-wait-changed', refresh);
      window.removeEventListener('gateway-realtime-connected', reconnect);
    };
  }, [conversationId, mutate]);
  return { wait: data?.wait, isLoading, busy, error, cancellationError, act, dismissError: () => {
    setError(undefined);
    setCancellationError(undefined);
  } };
}
