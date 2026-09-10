import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { fetchHome } from '../../query/home';
import { queryKeys } from '../../query/keys';
import { useGatewayConfigured } from '../../query/sessions';
import { useGatewayStore } from '../../stores/gateway-store';
import { usePreferencesStore } from '../../stores/preferences-store';
import { subscribeGatewayEvent } from '../gateway/gateway-event-bus';

export function useAttentionFeed() {
  const queryClient = useQueryClient();
  const configured = useGatewayConfigured();
  const activeGatewayId = useGatewayStore((state) => state.activeGatewayId);
  const language = usePreferencesStore((state) => state.language);
  const query = useQuery({
    queryKey: [...queryKeys.home, activeGatewayId ?? '', language],
    queryFn: () => fetchHome(language),
    enabled: configured && Boolean(activeGatewayId),
    staleTime: 15_000,
    refetchInterval: ({ state }) => state.data?.needsUser.length ? 15_000 : 60_000,
  });

  useEffect(() => {
    const refresh = () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.home });
    };
    const subscriptions = [
      subscribeGatewayEvent('run.started', refresh),
      subscribeGatewayEvent('run.completed', refresh),
      subscribeGatewayEvent('config.reload', refresh),
    ];
    return () => subscriptions.forEach((unsubscribe) => unsubscribe());
  }, [queryClient]);

  return query;
}
