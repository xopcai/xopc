import { fetchGatewayAgents } from '@/features/settings/agents-admin-api';
import { useAsyncResource } from '@/lib/use-async-resource';

export function useBuiltinToolIdsLoad(enabled: boolean, hasToken: boolean) {
  const { data: builtinToolIds, loading } = useAsyncResource(
    async () => {
      const p = await fetchGatewayAgents();
      return Array.isArray(p.builtinToolIds) ? p.builtinToolIds : [];
    },
    [enabled, hasToken],
    { enabled: enabled && hasToken, initial: [] as string[], errorData: [] },
  );

  return { builtinToolIds, loading };
}
