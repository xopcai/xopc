// Initial chat-session bootstrap. Three branches:
//   1. `/chat/new` route — adopt an existing empty session for this agent if
//      one exists, otherwise create one. The URL is then replaced with the
//      resolved session key.
//   2. `/chat/:key` route — load that session and try to resume any in-flight
//      agent run for it.
//   3. No key in URL — pick the most-recent populated session (or fall back to
//      creating one) and redirect to it.
//
// Cancellation: each render bumps `initGenRef` so a stale async chain (e.g.
// `isNewRoute` toggled mid-fetch) won't apply its results.

import { useEffect, useRef, type MutableRefObject } from 'react';

import type { Message } from '@/features/chat/messages/messages.types';
import {
  coerceReasoningLevel,
  type ReasoningLevel,
} from '@/features/chat/messages/messages.types';
import { getLiveSessionCache } from '@/features/chat/session/active-session-live-cache';
import {
  DEFAULT_THINKING,
  pickEmptyWebSessionForAgent,
} from '@/features/chat/session/chat-session-defaults';
import { searchParamsForComposerHandoff } from '@/features/chat/session/composer-handoff-params';
import type { SessionManager } from '@/features/chat/session/session-manager';

type Setter<T> = (value: T) => void;

export function useChatSessionInit(opts: {
  token: string | undefined;
  isNewRoute: boolean;
  decodedKey: string | undefined;
  locationSearch: string;
  sessionMgrRef: MutableRefObject<SessionManager>;
  resolveAgentIdForPost: () => string | null | undefined;
  navigateToSession: (key: string, replace?: boolean, search?: string) => void;
  refreshModelThinkingSupport: (model: string) => void | Promise<void>;
  loadSessionById: (key: string, offset: number) => Promise<Message[] | undefined>;
  tryResumeAgentRun: (key: string, seed: Message[]) => Promise<void>;
  restoreLiveCacheIfNeeded: (key: string) => boolean;
  setSessionKey: Setter<string | null>;
  setSessionName: Setter<string | null>;
  setMessages: Setter<Message[]>;
  setHasMore: Setter<boolean>;
  setSessionModel: Setter<string>;
  setThinkingLevel: Setter<string>;
  setReasoningLevel: Setter<ReasoningLevel>;
  setError: Setter<string | null>;
  setLoading: Setter<boolean>;
}): void {
  const {
    token,
    isNewRoute,
    decodedKey,
    locationSearch,
    sessionMgrRef,
    resolveAgentIdForPost,
    navigateToSession,
    refreshModelThinkingSupport,
    loadSessionById,
    tryResumeAgentRun,
    restoreLiveCacheIfNeeded,
    setSessionKey,
    setSessionName,
    setMessages,
    setHasMore,
    setSessionModel,
    setThinkingLevel,
    setReasoningLevel,
    setError,
    setLoading,
  } = opts;

  const initGenRef = useRef(0);

  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }

    const gen = ++initGenRef.current;
    let cancelled = false;
    const isLive = () => !cancelled && gen === initGenRef.current;

    const applyResolvedSessionConfig = (key: string) => {
      if (!isLive()) return;
      void sessionMgrRef.current
        .loadSessionAgentConfig(key)
        .then((cfg) => {
          if (!isLive()) return;
          setSessionModel(cfg.model);
          setThinkingLevel(cfg.thinkingLevel || DEFAULT_THINKING);
          setReasoningLevel(coerceReasoningLevel(cfg.reasoningLevel));
          void refreshModelThinkingSupport(cfg.model);
        })
        .catch(() => {
          /* ignore */
        });
    };

    const adoptOrCreateNewRouteSession = (): Promise<void> => {
      if (!isLive()) return Promise.resolve();
      return sessionMgrRef.current.loadSessions().then((sessions) => {
        if (!isLive()) return;
        const aid = resolveAgentIdForPost();
        const empty = pickEmptyWebSessionForAgent(sessions, aid ?? undefined);
        if (empty) {
          setSessionKey(empty.key);
          setSessionName(empty.name ?? null);
          setMessages([]);
          setHasMore(false);
          navigateToSession(empty.key, true, searchParamsForComposerHandoff(locationSearch));
          if (!isLive()) return;
          applyResolvedSessionConfig(empty.key);
          return;
        }
        if (!isLive()) return;
        return sessionMgrRef.current
          .createSession(aid ? { agentId: aid } : undefined)
          .then((session) => {
            if (!isLive()) return;
            setSessionKey(session.key);
            setSessionName(session.name ?? null);
            setMessages([]);
            setHasMore(false);
            navigateToSession(session.key, true, searchParamsForComposerHandoff(locationSearch));
            applyResolvedSessionConfig(session.key);
          });
      });
    };

    const initDecodedKey = (key: string): Promise<void> => {
      if (!isLive()) return Promise.resolve();
      return loadSessionById(key, 0).then((loaded) => {
        if (!isLive()) return;
        restoreLiveCacheIfNeeded(key);
        const seed = getLiveSessionCache(key)?.messages ?? loaded ?? [];
        return tryResumeAgentRun(key, seed);
      });
    };

    const initFallback = (): Promise<void> => {
      if (!isLive()) return Promise.resolve();
      return sessionMgrRef.current.loadSessions().then((sessions) => {
        if (!isLive()) return;
        const withMsgs = sessions.filter((s) => (s.messageCount ?? 0) > 0);
        const target = withMsgs[0] ?? sessions[0];
        if (target) {
          if (!isLive()) return;
          return loadSessionById(target.key, 0).then((loaded) => {
            if (!isLive()) return;
            restoreLiveCacheIfNeeded(target.key);
            const seed = getLiveSessionCache(target.key)?.messages ?? loaded ?? [];
            const keyFromUrl = sessionMgrRef.current.parseSessionFromHash();
            if (!keyFromUrl) navigateToSession(target.key, true);
            return tryResumeAgentRun(target.key, seed);
          });
        }
        if (!isLive()) return;
        const aid = resolveAgentIdForPost();
        return sessionMgrRef.current
          .createSession(aid ? { agentId: aid } : undefined)
          .then((session) => {
            if (!isLive()) return;
            setSessionKey(session.key);
            setSessionName(session.name ?? null);
            setMessages([]);
            setHasMore(false);
            navigateToSession(session.key);
            applyResolvedSessionConfig(session.key);
          });
      });
    };

    const run = () => {
      const needsFullBlockingLoad = isNewRoute || decodedKey === undefined;
      if (needsFullBlockingLoad) {
        setLoading(true);
      }
      setError(null);

      const branch = isNewRoute
        ? adoptOrCreateNewRouteSession()
        : decodedKey
          ? initDecodedKey(decodedKey)
          : initFallback();

      void branch
        .then(() => {
          if (isLive()) setLoading(false);
        })
        .catch((err) => {
          if (!cancelled) setError(err instanceof Error ? err.message : 'Chat init failed');
          if (isLive()) setLoading(false);
        });
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [
    token,
    isNewRoute,
    decodedKey,
    locationSearch,
    sessionMgrRef,
    resolveAgentIdForPost,
    navigateToSession,
    refreshModelThinkingSupport,
    loadSessionById,
    tryResumeAgentRun,
    restoreLiveCacheIfNeeded,
    setSessionKey,
    setSessionName,
    setMessages,
    setHasMore,
    setSessionModel,
    setThinkingLevel,
    setReasoningLevel,
    setError,
    setLoading,
  ]);
}
