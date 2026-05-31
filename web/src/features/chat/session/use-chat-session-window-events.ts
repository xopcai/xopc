// Three window-level event listeners that keep the chat session view consistent
// with out-of-band updates:
//   - `session-updated`: another tab / the session sidebar renamed this session.
//   - `session-transcript-updated`: the gateway persisted new transcript rows
//     (merged into the live slice when another device sent a user turn).
//   - `config-reload`: the user changed the agent's model/thinking config in the
//     settings drawer; reload it so the composer shows the new value immediately.

import { useEffect, type MutableRefObject } from 'react';

import { useChatSessionStore } from '@/features/chat/session/chat-session-store';
import type { SessionManager } from '@/features/chat/session/session-manager';

export function useChatSessionWindowEvents(opts: {
  sessionKey: string | null;
  sessionKeyRef: MutableRefObject<string | null>;
  sendingRef: MutableRefObject<boolean>;
  streamingRef: MutableRefObject<boolean>;
  sessionMgrRef: MutableRefObject<SessionManager>;
  loadSessionById: (key: string, offset: number) => Promise<unknown>;
  applyAgentConfig: (cfg: {
    model: string;
    thinkingLevel?: string | null;
    reasoningLevel?: string | null;
  }) => void;
}): void {
  const {
    sessionKey,
    sessionKeyRef,
    sessionMgrRef,
    loadSessionById,
    applyAgentConfig,
  } = opts;

  useEffect(() => {
    const handler = (e: Event) => {
      const d = (e as CustomEvent<{ key?: string; name?: string }>).detail;
      if (!d?.key || d.name === undefined) return;
      if (d.key === sessionKey) {
        useChatSessionStore.getState().patchSessionMeta(d.key, { name: d.name || null });
      }
    };
    window.addEventListener('session-updated', handler);
    return () => window.removeEventListener('session-updated', handler);
  }, [sessionKey]);

  useEffect(() => {
    const handler = (e: Event) => {
      const d = (e as CustomEvent<{ key?: string }>).detail;
      if (!d?.key || d.key !== sessionKey) return;
      void loadSessionById(sessionKey, 0);
    };
    window.addEventListener('session-transcript-updated', handler);
    return () => window.removeEventListener('session-transcript-updated', handler);
  }, [sessionKey, loadSessionById]);

  useEffect(() => {
    const onConfigReload = () => {
      const key = sessionKeyRef.current;
      if (!key) return;
      void sessionMgrRef.current
        .loadSessionAgentConfig(key)
        .then((cfg) => {
          applyAgentConfig(cfg);
        })
        .catch(() => {});
    };
    window.addEventListener('config-reload', onConfigReload);
    return () => window.removeEventListener('config-reload', onConfigReload);
  }, [sessionKeyRef, sessionMgrRef, applyAgentConfig]);
}
