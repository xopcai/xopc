import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from 'react';
import { useRouter } from 'expo-router';

import { prefetchNewChatSession, takeNewChatSessionKey } from '../chat/session-prefetch';
import { useMessages } from '../../i18n/messages';
import { useEffectiveDefaultAgentId } from '../../query/agents';
import { openChat } from '../../lib/navigation';
import {
  idleOperationState,
  reduceOperationState,
} from '../../lib/operation-state';

import { useOptionalWorkspaceTransition } from './workspace-transition-context';

import type { FinalizeAskAiHandler } from './workspace-transition.types';

export type WorkspaceNavigationValue = {
  openAskAi: () => void;
  retryAskAi: () => void;
  dismissAskAiError: () => void;
  isOpeningAskAi: boolean;
  askAiError: string | null;
  prefetchAskAiSession: () => void;
  registerFinalizeHandler: (handler: FinalizeAskAiHandler | null) => void;
};

const WorkspaceNavigationContext = createContext<WorkspaceNavigationValue | null>(null);

type WorkspaceNavigationProviderProps = {
  children: ReactNode;
};

export function WorkspaceNavigationProvider({ children }: WorkspaceNavigationProviderProps) {
  const router = useRouter();
  const transition = useOptionalWorkspaceTransition();
  const defaultAgentId = useEffectiveDefaultAgentId();
  const m = useMessages();
  const [askAiState, dispatchAskAi] = useReducer(reduceOperationState, idleOperationState);
  const openingAskAiRef = useRef(false);

  const prefetchAskAiSession = useCallback(() => {
    prefetchNewChatSession(defaultAgentId);
  }, [defaultAgentId]);

  const registerFinalizeHandler = useCallback(
    (handler: FinalizeAskAiHandler | null) => {
      transition?.registerFinalizeHandler(handler);
    },
    [transition],
  );

  const openAskAi = useCallback(() => {
    if (openingAskAiRef.current) return;
    openingAskAiRef.current = true;
    dispatchAskAi({ type: 'start' });

    void takeNewChatSessionKey(defaultAgentId)
      .then(async (sessionKey) => {
        if (transition) {
          await transition.openAskAi(sessionKey);
        } else {
          openChat(router, sessionKey);
        }
        dispatchAskAi({ type: 'succeed' });
      })
      .catch(() => {
        dispatchAskAi({ type: 'fail', message: m.homePage.askAiStartFailed });
      })
      .finally(() => {
        openingAskAiRef.current = false;
      });
  }, [defaultAgentId, m.homePage.askAiStartFailed, router, transition]);

  const retryAskAi = useCallback(() => {
    openAskAi();
  }, [openAskAi]);

  const dismissAskAiError = useCallback(() => {
    dispatchAskAi({ type: 'dismiss' });
  }, []);

  const value = useMemo(
    () => ({
      openAskAi,
      retryAskAi,
      dismissAskAiError,
      isOpeningAskAi: askAiState.status === 'pending',
      askAiError: askAiState.status === 'error' ? askAiState.message : null,
      prefetchAskAiSession,
      registerFinalizeHandler,
    }),
    [askAiState, dismissAskAiError, openAskAi, prefetchAskAiSession, registerFinalizeHandler, retryAskAi],
  );

  return (
    <WorkspaceNavigationContext.Provider value={value}>
      {children}
    </WorkspaceNavigationContext.Provider>
  );
}

export function useWorkspaceNavigation(): WorkspaceNavigationValue {
  const ctx = useContext(WorkspaceNavigationContext);
  const router = useRouter();
  const defaultAgentId = useEffectiveDefaultAgentId();
  const m = useMessages();
  const [askAiState, dispatchAskAi] = useReducer(reduceOperationState, idleOperationState);
  const openingAskAiRef = useRef(false);

  const openAskAi = useCallback(() => {
    if (openingAskAiRef.current) return;
    openingAskAiRef.current = true;
    dispatchAskAi({ type: 'start' });
    void takeNewChatSessionKey(defaultAgentId)
      .then((sessionKey) => {
        openChat(router, sessionKey);
        dispatchAskAi({ type: 'succeed' });
      })
      .catch(() => {
        dispatchAskAi({ type: 'fail', message: m.homePage.askAiStartFailed });
      })
      .finally(() => {
        openingAskAiRef.current = false;
      });
  }, [defaultAgentId, m.homePage.askAiStartFailed, router]);

  return useMemo(
    () =>
      ctx ?? {
        openAskAi,
        retryAskAi: openAskAi,
        dismissAskAiError: () => dispatchAskAi({ type: 'dismiss' }),
        isOpeningAskAi: askAiState.status === 'pending',
        askAiError: askAiState.status === 'error' ? askAiState.message : null,
        prefetchAskAiSession: () => prefetchNewChatSession(defaultAgentId),
        registerFinalizeHandler: () => {},
      },
    [askAiState, ctx, defaultAgentId, openAskAi],
  );
}
