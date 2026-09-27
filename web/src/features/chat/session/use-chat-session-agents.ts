import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from 'react';
import type { NavigateFunction } from 'react-router-dom';
import useSWR from 'swr';

import { fetchChatAgents } from '@/features/chat/agent-selection/chat-agents-api';
import { newChatHrefForProject } from '@/features/chat/session/composer-handoff-params';
import {
  readNewSessionPreferences,
  rememberLastChatScope,
  rememberSelectedAgent,
} from '@/features/chat/session/new-session-preferences';
import { resolveChatSessionAgentContext } from '@/features/chat/session/chat-session-agent-context';
import { isSkillsOnlyConfigReload } from '@/features/gateway/config-reload-event';
import { useGatewayStore } from '@/stores/gateway-store';

export function useChatSessionAgents(opts: {
  navigate: NavigateFunction;
  conversationIdRef: RefObject<string | null>;
  conversationId: string | null;
  isNewRoute: boolean;
  locationState: unknown;
  locationSearch: string;
}) {
  const { navigate, conversationIdRef, conversationId, isNewRoute, locationState, locationSearch } = opts;
  const token = useGatewayStore((s) => s.conversationId);
  const sessionAgentKey = conversationId?.trim() ?? '';

  const { data: chatAgentsData, mutate: mutateChatAgents } = useSWR(
    token ? ['gateway-chat-agents', token] : null,
    fetchChatAgents,
    { revalidateOnFocus: false },
  );

  const { data: currentSessionContext } = useSWR(
    token && sessionAgentKey ? ['gateway-chat-session-agent', token, sessionAgentKey] : null,
    () => resolveChatSessionAgentContext(sessionAgentKey),
    { revalidateOnFocus: false },
  );
  const currentSessionAgentId = currentSessionContext?.agentId ?? '';

  useEffect(() => {
    const onConfigReload = (event: Event) => {
      if (isSkillsOnlyConfigReload((event as CustomEvent<unknown>).detail)) return;
      void mutateChatAgents();
    };
    window.addEventListener('config-reload', onConfigReload);
    return () => window.removeEventListener('config-reload', onConfigReload);
  }, [mutateChatAgents]);

  const [preferredAgentId, setPreferredAgentId] = useState<string | null>(
    () => readNewSessionPreferences().selectedAgentId ?? null,
  );
  const chatAgentsRef = useRef(chatAgentsData ?? null);
  const preferredAgentIdRef = useRef<string | null>(
    readNewSessionPreferences().selectedAgentId ?? null,
  );

  useEffect(() => {
    chatAgentsRef.current = chatAgentsData ?? null;
  }, [chatAgentsData]);

  useEffect(() => {
    preferredAgentIdRef.current = preferredAgentId;
  }, [preferredAgentId]);

  useEffect(() => {
    if (!chatAgentsData) return;
    const valid = new Set(chatAgentsData.items.map((i) => i.id));
    setPreferredAgentId((cur) => {
      if (cur == null || cur === '') return chatAgentsData.defaultId;
      if (!valid.has(cur)) return chatAgentsData.defaultId;
      return cur;
    });
  }, [chatAgentsData]);

  const resolveAgentIdForPost = useCallback((): string | undefined => {
    if (conversationIdRef.current && currentSessionAgentId) return currentSessionAgentId;

    const agents = chatAgentsRef.current;
    const pref = (preferredAgentIdRef.current ?? '').trim().toLowerCase();
    if (!agents) return pref || undefined;
    const valid = new Set(agents.items.map((i) => i.id));
    if (pref && valid.has(pref)) return pref;
    return agents.defaultId;
  }, [currentSessionAgentId, conversationIdRef]);

  const onChatAgentChange = useCallback(
    (id: string) => {
      const next = id.trim().toLowerCase();
      const curKey = conversationIdRef.current;
      const curAgent = curKey ? currentSessionAgentId || preferredAgentIdRef.current : null;
      preferredAgentIdRef.current = next;
      setPreferredAgentId(next);
      rememberSelectedAgent(next);
      if (curAgent !== next) {
        navigate(isNewRoute ? `/chat/new${locationSearch}` : newChatHrefForProject(currentSessionContext?.projectId), {
          replace: false,
          state: {
            ...(isNewRoute && locationState && typeof locationState === 'object' ? locationState : {}),
            agentId: next,
            forceNewChat: true,
          },
        });
      }
    },
    [currentSessionContext?.projectId, currentSessionAgentId, isNewRoute, locationSearch, locationState, navigate, conversationIdRef],
  );

  useEffect(() => {
    const handler = (e: Event) => {
      const aid = (e as CustomEvent<{ agentId?: string }>).detail?.agentId;
      if (typeof aid !== 'string' || !aid.trim()) return;
      onChatAgentChange(aid);
    };
    window.addEventListener('xopc-set-chat-agent', handler);
    return () => window.removeEventListener('xopc-set-chat-agent', handler);
  }, [onChatAgentChange]);

  useLayoutEffect(() => {
    if (!conversationId) return;
    const agentFromSession = currentSessionAgentId;
    if (!agentFromSession || preferredAgentIdRef.current === agentFromSession) return;
    preferredAgentIdRef.current = agentFromSession;
    setPreferredAgentId(agentFromSession);
    rememberSelectedAgent(agentFromSession);
  }, [currentSessionAgentId, conversationId]);

  useLayoutEffect(() => {
    if (!conversationId || !currentSessionContext) return;
    rememberLastChatScope(currentSessionContext.projectId);
  }, [currentSessionContext, conversationId]);

  useLayoutEffect(() => {
    if (!isNewRoute) return;
    const st = locationState as { agentId?: string } | null | undefined;
    const aid = typeof st?.agentId === 'string' ? st.agentId.trim().toLowerCase() : '';
    if (!aid) return;
    preferredAgentIdRef.current = aid;
    setPreferredAgentId(aid);
    rememberSelectedAgent(aid);
  }, [isNewRoute, locationState]);

  const displayAgentId = useMemo(
    () =>
      currentSessionAgentId ||
      preferredAgentId ||
      chatAgentsData?.defaultId ||
      'main',
    [currentSessionAgentId, preferredAgentId, chatAgentsData],
  );

  const showChatAgentSelector = (chatAgentsData?.items.length ?? 0) > 1;

  return {
    token,
    chatAgentsData,
    resolveAgentIdForPost,
    onChatAgentChange,
    displayAgentId,
    showChatAgentSelector,
    currentSessionProjectId: currentSessionContext?.projectId ?? null,
  };
}
