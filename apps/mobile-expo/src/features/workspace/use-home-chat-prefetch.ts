import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { fetchChatAgents, useEffectiveDefaultAgentId } from '../../query/agents';
import { queryKeys } from '../../query/keys';
import { fetchChatModels } from '../../query/models';
import { prefetchNewChatSession } from '../chat/session-prefetch';
import { useGatewayHealth } from '../gateway/use-gateway-health';

/** Warm session + agent/model queries while the home screen is idle. */
export function useHomeChatPrefetch(configured: boolean): void {
  const queryClient = useQueryClient();
  const { gatewayOnline } = useGatewayHealth();
  const defaultAgentId = useEffectiveDefaultAgentId();

  useEffect(() => {
    if (!configured || !gatewayOnline) return;

    const timer = setTimeout(() => {
      prefetchNewChatSession(defaultAgentId);
      void queryClient.prefetchQuery({ queryKey: queryKeys.agents, queryFn: fetchChatAgents });
      void queryClient.prefetchQuery({
        queryKey: queryKeys.models(defaultAgentId),
        queryFn: () => fetchChatModels(defaultAgentId || undefined),
      });
    }, 300);

    return () => clearTimeout(timer);
  }, [configured, defaultAgentId, gatewayOnline, queryClient]);
}
