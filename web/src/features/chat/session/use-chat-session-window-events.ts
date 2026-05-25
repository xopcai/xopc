// Three window-level event listeners that keep the chat session view consistent
// with out-of-band updates:
//   - `session-updated`: another tab / the session sidebar renamed this session.
//   - `session-transcript-updated`: the gateway persisted new transcript rows
//     while no stream is active (e.g. a background webchat run finished).
//   - `config-reload`: the user changed the agent's model/thinking config in the
//     settings drawer; reload it so the composer shows the new value immediately.

import { useEffect, type MutableRefObject } from 'react';

import {
  coerceReasoningLevel,
  type ReasoningLevel,
} from '@/features/chat/messages/messages.types';
import { DEFAULT_THINKING } from '@/features/chat/session/chat-session-defaults';
import type { SessionManager } from '@/features/chat/session/session-manager';

export function useChatSessionWindowEvents(opts: {
  sessionKey: string | null;
  sessionKeyRef: MutableRefObject<string | null>;
  sendingRef: MutableRefObject<boolean>;
  streamingRef: MutableRefObject<boolean>;
  sessionMgrRef: MutableRefObject<SessionManager>;
  loadSessionById: (key: string, offset: number) => Promise<unknown>;
  refreshModelThinkingSupport: (model: string) => void | Promise<void>;
  setSessionName: (name: string | null) => void;
  setSessionModel: (model: string) => void;
  setThinkingLevel: (level: string) => void;
  setReasoningLevel: (level: ReasoningLevel) => void;
}): void {
  const {
    sessionKey,
    sessionKeyRef,
    sendingRef,
    streamingRef,
    sessionMgrRef,
    loadSessionById,
    refreshModelThinkingSupport,
    setSessionName,
    setSessionModel,
    setThinkingLevel,
    setReasoningLevel,
  } = opts;

  useEffect(() => {
    const handler = (e: Event) => {
      const d = (e as CustomEvent<{ key?: string; name?: string }>).detail;
      if (!d?.key || d.name === undefined) return;
      if (d.key === sessionKey) setSessionName(d.name || null);
    };
    window.addEventListener('session-updated', handler);
    return () => window.removeEventListener('session-updated', handler);
  }, [sessionKey, setSessionName]);

  useEffect(() => {
    const handler = (e: Event) => {
      const d = (e as CustomEvent<{ key?: string }>).detail;
      if (!d?.key || d.key !== sessionKey) return;
      if (sendingRef.current || streamingRef.current) return;
      void loadSessionById(sessionKey, 0);
    };
    window.addEventListener('session-transcript-updated', handler);
    return () => window.removeEventListener('session-transcript-updated', handler);
  }, [sessionKey, sendingRef, streamingRef, loadSessionById]);

  useEffect(() => {
    const onConfigReload = () => {
      const key = sessionKeyRef.current;
      if (!key) return;
      void sessionMgrRef.current
        .loadSessionAgentConfig(key)
        .then((cfg) => {
          setSessionModel(cfg.model);
          setThinkingLevel(cfg.thinkingLevel || DEFAULT_THINKING);
          setReasoningLevel(coerceReasoningLevel(cfg.reasoningLevel));
          void refreshModelThinkingSupport(cfg.model);
        })
        .catch(() => {});
    };
    window.addEventListener('config-reload', onConfigReload);
    return () => window.removeEventListener('config-reload', onConfigReload);
  }, [
    sessionKeyRef,
    sessionMgrRef,
    refreshModelThinkingSupport,
    setSessionModel,
    setThinkingLevel,
    setReasoningLevel,
  ]);
}
