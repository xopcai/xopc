// Initial chat-session bootstrap. Product contract: docs/web/chat-session-semantics.md
//   1. `/chat/new` — resolve reusable empty shell, else create a server-owned session.
//   2. `/chat/:key` route — load that session and try to resume any in-flight agent run for it.
//   3. No key in URL — pick the most-recent populated session (or fall back to creating one).
//
// Cancellation: each render bumps `initGenRef` so a stale async chain won't apply its results.

import { useEffect, useRef, type MutableRefObject } from 'react';

import type { Message } from '@/features/chat/messages/messages.types';
import {
  getChatSessionSnapshot,
  getSessionMessages,
} from '@/features/chat/session/chat-session-store';
import { searchParamsForComposerHandoff } from '@/features/chat/session/composer-handoff-params';
import { takeSkipInitialSessionLoad } from '@/features/chat/session/chat-session-init-skip-load';
import { openNewChatHandoff } from '@/features/chat/session/new-chat-handoff';
import type { SessionManager } from '@/features/chat/session/session-manager';
import { lastNonNewSessionKeyRef } from '@/features/chat/session/use-chat-session-route';

export function useChatSessionInit(opts: {
  token: string | undefined;
  isNewRoute: boolean;
  decodedKey: string | undefined;
  locationSearch: string;
  sessionMgrRef: MutableRefObject<SessionManager>;
  resolveAgentIdForPost: () => string | null | undefined;
  navigateToSession: (key: string, replace?: boolean, search?: string) => void;
  loadSessionById: (key: string, offset: number) => Promise<Message[] | undefined>;
  tryResumeAgentRun: (key: string, seed: Message[]) => Promise<void>;
  restoreLiveCacheIfNeeded: (key: string) => boolean;
  adoptEmptySession: (key: string, name: string | null) => void;
  applyAgentConfig: (
    sessionKey: string,
    cfg: {
      model: string;
      thinkingLevel?: string | null;
      reasoningLevel?: string | null;
    },
  ) => void;
  patchInitUi: (patch: { loading?: boolean; error?: string | null }) => void;
}): void {
  const {
    token,
    isNewRoute,
    decodedKey,
    locationSearch,
    sessionMgrRef,
    resolveAgentIdForPost,
    navigateToSession,
    loadSessionById,
    tryResumeAgentRun,
    restoreLiveCacheIfNeeded,
    adoptEmptySession,
    applyAgentConfig,
    patchInitUi,
  } = opts;

  const initGenRef = useRef(0);

  useEffect(() => {
    if (!token) {
      patchInitUi({ loading: false });
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
          applyAgentConfig(key, cfg);
        })
        .catch(() => {
          /* ignore */
        });
    };

    const createNewRouteSession = (): Promise<void> => {
      if (!isLive()) return Promise.resolve();
      const aid = resolveAgentIdForPost();
      return openNewChatHandoff({
        sessionMgr: sessionMgrRef.current,
        agentId: aid,
        currentSessionKey: lastNonNewSessionKeyRef.current,
        routeSessionKey: null,
        navigateToSession,
        replaceNavigate: true,
        search: searchParamsForComposerHandoff(locationSearch),
        onOpened: (key) => adoptEmptySession(key, null),
      }).then(() => undefined);
    };

    const resumeSessionRun = (key: string, seed: Message[]): Promise<void> => {
      if (!isLive()) return Promise.resolve();
      restoreLiveCacheIfNeeded(key);
      const resolvedSeed =
        getChatSessionSnapshot(key)?.messages ?? seed ?? getSessionMessages(key);
      return tryResumeAgentRun(key, resolvedSeed);
    };

    const initDecodedKey = (key: string): Promise<void> => {
      if (!isLive()) return Promise.resolve();
      if (takeSkipInitialSessionLoad(key)) {
        applyResolvedSessionConfig(key);
        return resumeSessionRun(key, getSessionMessages(key));
      }
      return loadSessionById(key, 0).then((loaded) => {
        if (!isLive()) return;
        return resumeSessionRun(key, loaded ?? getSessionMessages(key));
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
            const seed = getChatSessionSnapshot(target.key)?.messages ?? loaded ?? getSessionMessages(target.key);
            const keyFromUrl = sessionMgrRef.current.parseSessionFromHash();
            if (!keyFromUrl) navigateToSession(target.key, true);
            return tryResumeAgentRun(target.key, seed);
          });
        }
        if (!isLive()) return;
        const aid = resolveAgentIdForPost();
        return openNewChatHandoff({
          sessionMgr: sessionMgrRef.current,
          agentId: aid,
          currentSessionKey: null,
          routeSessionKey: null,
          navigateToSession,
          onOpened: (key) => adoptEmptySession(key, null),
        }).then(() => undefined);
      });
    };

    const run = () => {
      const needsFullBlockingLoad = decodedKey === undefined && !isNewRoute;
      patchInitUi({ loading: needsFullBlockingLoad, error: null });

      const branch = isNewRoute
        ? createNewRouteSession()
        : decodedKey
          ? initDecodedKey(decodedKey)
          : initFallback();

      void branch
        .then(() => {
          if (isLive()) patchInitUi({ loading: false });
        })
        .catch((err) => {
          if (!cancelled) {
            patchInitUi({
              error: err instanceof Error ? err.message : 'Chat init failed',
              loading: false,
            });
          } else if (isLive()) {
            patchInitUi({ loading: false });
          }
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
    loadSessionById,
    tryResumeAgentRun,
    restoreLiveCacheIfNeeded,
    adoptEmptySession,
    applyAgentConfig,
    patchInitUi,
  ]);
}
