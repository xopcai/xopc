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
import {
  projectIdForNewChatHandoff,
  searchParamsForComposerHandoff,
} from '@/features/chat/session/composer-handoff-params';
import { openNewChatHandoff } from '@/features/chat/session/new-chat-handoff';
import type { SessionManager } from '@/features/chat/session/session-manager';
import { lastNonNewSessionKeyRef } from '@/features/chat/session/use-chat-session-route';

export function useChatSessionInit(opts: {
  token: string | undefined;
  isNewRoute: boolean;
  forceNewChat: boolean;
  decodedKey: string | undefined;
  locationKey: string;
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
      activityDetail?: {
        default: string;
        override: string | null;
        effective: string;
        source: 'session' | 'default';
      };
      effectiveWorkspacePath?: string | null;
      workingDirectoryLocked?: boolean;
    },
  ) => void;
  patchInitUi: (patch: { loading?: boolean; error?: string | null }) => void;
}): void {
  const {
    token,
    isNewRoute,
    forceNewChat,
    decodedKey,
    locationKey,
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
  const newRouteLocationSearch = isNewRoute ? locationSearch : '';
  const requestKey = isNewRoute
    ? `new:${locationKey}`
    : decodedKey
      ? `session:${decodedKey}`
      : `fallback:${locationKey}`;

  // Session initialization is a route operation. Runtime callbacks may change
  // as Agent/config data arrives, but that must not restart history hydration.
  const requestRef = useRef({ isNewRoute, forceNewChat, decodedKey, newRouteLocationSearch });
  requestRef.current = { isNewRoute, forceNewChat, decodedKey, newRouteLocationSearch };
  const runtimeRef = useRef({
    sessionMgrRef,
    resolveAgentIdForPost,
    navigateToSession,
    loadSessionById,
    tryResumeAgentRun,
    restoreLiveCacheIfNeeded,
    adoptEmptySession,
    applyAgentConfig,
    patchInitUi,
  });
  runtimeRef.current = {
    sessionMgrRef,
    resolveAgentIdForPost,
    navigateToSession,
    loadSessionById,
    tryResumeAgentRun,
    restoreLiveCacheIfNeeded,
    adoptEmptySession,
    applyAgentConfig,
    patchInitUi,
  };

  useEffect(() => {
    const request = requestRef.current;
    const runtime = runtimeRef.current;
    if (!token) {
      runtime.patchInitUi({ loading: false });
      return;
    }

    const gen = ++initGenRef.current;
    let cancelled = false;
    const isLive = () => !cancelled && gen === initGenRef.current;

    const applyResolvedSessionConfig = (key: string) => {
      if (!isLive()) return;
      void runtime.sessionMgrRef.current
        .loadSessionAgentConfig(key)
        .then((cfg) => {
          if (!isLive()) return;
          runtime.applyAgentConfig(key, cfg);
        })
        .catch(() => {
          /* ignore */
        });
    };

    const createNewRouteSession = (): Promise<void> => {
      if (!isLive()) return Promise.resolve();
      const aid = runtime.resolveAgentIdForPost();
      return openNewChatHandoff({
        sessionMgr: runtime.sessionMgrRef.current,
        agentId: aid,
        currentSessionKey: lastNonNewSessionKeyRef.current,
        routeSessionKey: null,
        forceNew: request.forceNewChat,
        projectId: projectIdForNewChatHandoff(request.newRouteLocationSearch),
        navigateToSession: runtime.navigateToSession,
        replaceNavigate: true,
        search: searchParamsForComposerHandoff(request.newRouteLocationSearch),
        onOpened: (key) => {
          runtime.adoptEmptySession(key, null);
          applyResolvedSessionConfig(key);
        },
      }).then(() => undefined);
    };

    const resumeSessionRun = (key: string, seed: Message[]): Promise<void> => {
      if (!isLive()) return Promise.resolve();
      runtime.restoreLiveCacheIfNeeded(key);
      const resolvedSeed =
        getChatSessionSnapshot(key)?.messages ?? seed ?? getSessionMessages(key);
      return runtime.tryResumeAgentRun(key, resolvedSeed);
    };

    const initDecodedKey = (key: string): Promise<void> => {
      if (!isLive()) return Promise.resolve();
      if (getChatSessionSnapshot(key)?.historyStatus === 'ready') {
        applyResolvedSessionConfig(key);
        return resumeSessionRun(key, getSessionMessages(key));
      }
      return runtime.loadSessionById(key, 0).then((loaded) => {
        if (!isLive()) return;
        return resumeSessionRun(key, loaded ?? getSessionMessages(key));
      });
    };

    const initFallback = (): Promise<void> => {
      if (!isLive()) return Promise.resolve();
      return runtime.sessionMgrRef.current.loadSessions().then((sessions) => {
        if (!isLive()) return;
        const withMsgs = sessions.filter((s) => (s.messageCount ?? 0) > 0);
        const target = withMsgs[0] ?? sessions[0];
        if (target) {
          if (!isLive()) return;
          return runtime.loadSessionById(target.key, 0).then((loaded) => {
            if (!isLive()) return;
            runtime.restoreLiveCacheIfNeeded(target.key);
            const seed = getChatSessionSnapshot(target.key)?.messages ?? loaded ?? getSessionMessages(target.key);
            const keyFromUrl = runtime.sessionMgrRef.current.parseSessionFromHash();
            if (!keyFromUrl) runtime.navigateToSession(target.key, true);
            return runtime.tryResumeAgentRun(target.key, seed);
          });
        }
        if (!isLive()) return;
        const aid = runtime.resolveAgentIdForPost();
        return openNewChatHandoff({
          sessionMgr: runtime.sessionMgrRef.current,
          agentId: aid,
          currentSessionKey: null,
          routeSessionKey: null,
          navigateToSession: runtime.navigateToSession,
          onOpened: (key) => {
            runtime.adoptEmptySession(key, null);
            applyResolvedSessionConfig(key);
          },
        }).then(() => undefined);
      });
    };

    const run = () => {
      const needsFullBlockingLoad = request.decodedKey === undefined && !request.isNewRoute;
      runtime.patchInitUi({ loading: needsFullBlockingLoad, error: null });

      const branch = request.isNewRoute
        ? createNewRouteSession()
        : request.decodedKey
          ? initDecodedKey(request.decodedKey)
          : initFallback();

      void branch
        .then(() => {
          if (isLive()) runtime.patchInitUi({ loading: false });
        })
        .catch((err) => {
          if (!cancelled) {
            runtime.patchInitUi({
              error: err instanceof Error ? err.message : 'Chat init failed',
              loading: false,
            });
          } else if (isLive()) {
            runtime.patchInitUi({ loading: false });
          }
        });
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [
    token,
    requestKey,
  ]);
}
