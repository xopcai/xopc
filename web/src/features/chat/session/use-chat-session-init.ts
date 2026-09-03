// Initial chat-session bootstrap. Product contract: docs/design/technical/new-session-preferences.md
//   1. `/chat/new` — prepare workspace-project environments; otherwise resolve an empty shell or create.
//   2. `/chat/:key` route — load that session and try to resume any in-flight agent run for it.
//   3. No key in URL — pick the most-recent populated session (or fall back to creating one).
//
// Cancellation: each route initialization bumps `initGenRef` so stale async work cannot replace the view.

import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import {
  modelPreferenceForAgent,
  resolveNewSessionSpec,
  type SessionCreateRequest,
} from '@xopcai/gateway-contract';

import { fetchProject, type Project } from '@/features/projects/api';
import { useGatewayStore } from '@/stores/gateway-store';
import type { Message } from '@/features/chat/messages/messages.types';
import {
  getChatSessionSnapshot,
  getSessionMessages,
} from '@/features/chat/session/chat-session-store';
import {
  projectIntentForNewChatHandoff,
  searchParamsForComposerHandoff,
} from '@/features/chat/session/composer-handoff-params';
import { openNewChatHandoff } from '@/features/chat/session/new-chat-handoff';
import { readNewSessionPreferences } from '@/features/chat/session/new-session-preferences';
import type { SessionManager } from '@/features/chat/session/session-manager';
import { lastNonNewSessionKeyRef } from '@/features/chat/session/use-chat-session-route';

export interface ProjectSessionPreparation {
  project: Project;
  agentId: string;
  temporary: boolean;
  create: (mode: NonNullable<SessionCreateRequest['executionMode']>) => Promise<void>;
}

export function useChatSessionInit(opts: {
  token: string | undefined;
  isNewRoute: boolean;
  forceNewChat: boolean;
  temporary?: boolean;
  requestedAgentId?: string;
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
    },
  ) => void;
  patchInitUi: (patch: { loading?: boolean; error?: string | null }) => void;
}): ProjectSessionPreparation | null {
  const {
    token,
    isNewRoute,
    forceNewChat,
    temporary = false,
    requestedAgentId,
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
  const baseUrl = useGatewayStore((state) => state.baseUrl);
  const [preparation, setPreparation] = useState<(ProjectSessionPreparation & { requestKey: string; token: string; baseUrl: string }) | null>(null);
  const newRouteLocationSearch = isNewRoute ? locationSearch : '';
  const requestKey = isNewRoute
    ? `new:${locationKey}`
    : decodedKey
      ? `session:${decodedKey}`
      : `fallback:${locationKey}`;

  // Session initialization is a route operation. Runtime callbacks may change
  // as Agent/config data arrives, but that must not restart history hydration.
  const requestRef = useRef({ isNewRoute, forceNewChat, temporary, requestedAgentId, decodedKey, newRouteLocationSearch });
  requestRef.current = { isNewRoute, forceNewChat, temporary, requestedAgentId, decodedKey, newRouteLocationSearch };
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

    const createNewRouteSession = async (): Promise<void> => {
      if (!isLive()) return Promise.resolve();
      const preferences = readNewSessionPreferences();
      const aid = runtime.resolveAgentIdForPost();
      const spec = resolveNewSessionSpec(
        {
          origin: 'web-route',
          project: projectIntentForNewChatHandoff(request.newRouteLocationSearch),
          agentId: request.requestedAgentId ?? aid,
          forceNew: request.forceNewChat,
          temporary: request.temporary,
        },
        {
          defaultAgentId: aid ?? 'main',
          selectedAgentId: preferences.selectedAgentId,
          lastChatScope: preferences.lastChatScope,
        },
      );
      const project = spec.projectId ? await fetchProject(spec.projectId) : null;
      if (!isLive()) return;
      if (!request.requestedAgentId && project?.defaultAgentId) spec.agentId = project.defaultAgentId;
      const modelPreference = modelPreferenceForAgent(preferences, spec.agentId);
      const open = (executionMode?: SessionCreateRequest['executionMode']) => openNewChatHandoff({
        sessionMgr: runtime.sessionMgrRef.current,
        agentId: spec.agentId,
        currentSessionKey: lastNonNewSessionKeyRef.current,
        routeSessionKey: null,
        forceNew: spec.forceNew,
        temporary: spec.temporary,
        projectId: spec.projectId,
        executionMode,
        initialAgentConfig: modelPreference
          ? {
              model: modelPreference.modelRef,
              ...(modelPreference.thinkingLevel
                ? { thinkingLevel: modelPreference.thinkingLevel }
                : {}),
            }
          : undefined,
        navigateToSession: (...args) => { if (isLive()) runtime.navigateToSession(...args); },
        replaceNavigate: true,
        search: searchParamsForComposerHandoff(request.newRouteLocationSearch),
        onOpened: (key) => {
          if (!isLive()) return;
          runtime.adoptEmptySession(key, null);
          applyResolvedSessionConfig(key);
        },
      }).then(() => undefined);
      if (project?.workspaceRoot?.trim()) {
        setPreparation({
          requestKey, token, baseUrl, project, agentId: spec.agentId, temporary: spec.temporary,
          create: (mode) => {
            if (!isLive()) return Promise.reject(new Error('New chat request changed'));
            return open(mode);
          },
        });
        return;
      }
      return open();
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
    baseUrl,
    requestKey,
  ]);
  return isNewRoute && preparation?.requestKey === requestKey && preparation.token === token && preparation.baseUrl === baseUrl
    ? preparation : null;
}
