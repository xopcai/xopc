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

import {
  readStoredWebchatAgentId,
  WEBCHAT_AGENT_STORAGE_KEY,
} from '@/features/chat/session/chat-session-defaults';
import { fetchChatAgents } from '@/features/chat/agent-selection/chat-agents-api';
import { isSkillsOnlyConfigReload } from '@/features/gateway/config-reload-event';
import { getAgentIdFromWebSessionKey } from '@/lib/web-session-agent';
import { useGatewayStore } from '@/stores/gateway-store';

export function useChatSessionAgents(opts: {
  navigate: NavigateFunction;
  sessionKeyRef: RefObject<string | null>;
  sessionKey: string | null;
  isNewRoute: boolean;
  locationState: unknown;
}) {
  const { navigate, sessionKeyRef, sessionKey, isNewRoute, locationState } = opts;
  const token = useGatewayStore((s) => s.token);

  const { data: chatAgentsData, mutate: mutateChatAgents } = useSWR(
    token ? ['gateway-chat-agents', token] : null,
    fetchChatAgents,
    { revalidateOnFocus: false },
  );

  useEffect(() => {
    const onConfigReload = (event: Event) => {
      if (isSkillsOnlyConfigReload((event as CustomEvent<unknown>).detail)) return;
      void mutateChatAgents();
    };
    window.addEventListener('config-reload', onConfigReload);
    return () => window.removeEventListener('config-reload', onConfigReload);
  }, [mutateChatAgents]);

  const [preferredAgentId, setPreferredAgentId] = useState<string | null>(() =>
    readStoredWebchatAgentId(),
  );
  const chatAgentsRef = useRef(chatAgentsData ?? null);
  const preferredAgentIdRef = useRef<string | null>(readStoredWebchatAgentId());

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
    const key = sessionKeyRef.current;
    const fromKey = key ? getAgentIdFromWebSessionKey(key) : null;
    if (fromKey) return fromKey;

    const agents = chatAgentsRef.current;
    const pref = (preferredAgentIdRef.current ?? '').trim().toLowerCase();
    if (!agents) return pref || undefined;
    const valid = new Set(agents.items.map((i) => i.id));
    if (pref && valid.has(pref)) return pref;
    return agents.defaultId;
  }, [sessionKeyRef]);

  const onChatAgentChange = useCallback(
    (id: string) => {
      const next = id.trim().toLowerCase();
      setPreferredAgentId(next);
      try {
        globalThis.localStorage?.setItem(WEBCHAT_AGENT_STORAGE_KEY, next);
      } catch {
        /* noop */
      }
      const curKey = sessionKeyRef.current;
      const curAgent = curKey ? getAgentIdFromWebSessionKey(curKey) : null;
      if (curAgent !== next) {
        navigate('/chat/new', { replace: false });
      }
    },
    [navigate, sessionKeyRef],
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
    if (!sessionKey) return;
    const agentFromSession = getAgentIdFromWebSessionKey(sessionKey);
    if (!agentFromSession || preferredAgentIdRef.current === agentFromSession) return;
    preferredAgentIdRef.current = agentFromSession;
    setPreferredAgentId(agentFromSession);
    try {
      globalThis.localStorage?.setItem(WEBCHAT_AGENT_STORAGE_KEY, agentFromSession);
    } catch {
      /* noop */
    }
  }, [sessionKey]);

  useLayoutEffect(() => {
    if (!isNewRoute) return;
    const st = locationState as { agentId?: string } | null | undefined;
    const aid = typeof st?.agentId === 'string' ? st.agentId.trim().toLowerCase() : '';
    if (!aid) return;
    preferredAgentIdRef.current = aid;
    setPreferredAgentId(aid);
    try {
      globalThis.localStorage?.setItem(WEBCHAT_AGENT_STORAGE_KEY, aid);
    } catch {
      /* noop */
    }
  }, [isNewRoute, locationState]);

  const displayAgentId = useMemo(
    () =>
      (sessionKey && getAgentIdFromWebSessionKey(sessionKey)) ||
      preferredAgentId ||
      chatAgentsData?.defaultId ||
      'main',
    [sessionKey, preferredAgentId, chatAgentsData],
  );

  const showChatAgentSelector = (chatAgentsData?.items.length ?? 0) > 1;

  return {
    token,
    chatAgentsData,
    resolveAgentIdForPost,
    onChatAgentChange,
    displayAgentId,
    showChatAgentSelector,
  };
}
