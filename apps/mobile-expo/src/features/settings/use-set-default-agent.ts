import { useMutation, useQueryClient } from '@tanstack/react-query';

import {
  resolveEffectiveDefaultAgentId,
  setGatewayDefaultAgent,
  type ChatAgentsPayload,
} from '../../query/agents';
import { queryKeys } from '../../query/keys';
import { usePreferencesStore } from '../../stores/preferences-store';

export function useSetDefaultAgent() {
  const queryClient = useQueryClient();
  const setDefaultAgentId = usePreferencesStore((s) => s.setDefaultAgentId);

  return useMutation({
    mutationFn: async (agentId: string) => {
      const synced = await setGatewayDefaultAgent(agentId);
      setDefaultAgentId(agentId);
      return { synced };
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.agents });
    },
  });
}

export function pickEffectiveDefaultId(
  payload: ChatAgentsPayload | undefined,
  localOverride: string | null,
): string {
  return resolveEffectiveDefaultAgentId(payload, localOverride);
}
