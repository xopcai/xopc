import { useEffect, useState } from 'react';

import { fetchGatewayAgents } from '@/features/settings/agents-admin-api';

export function useBuiltinToolIdsLoad(enabled: boolean, hasToken: boolean) {
  const [builtinToolIds, setBuiltinToolIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled || !hasToken) {
      return;
    }
    let cancelled = false;
    setLoading(true);
    void fetchGatewayAgents()
      .then((p) => {
        if (!cancelled) {
          setBuiltinToolIds(Array.isArray(p.builtinToolIds) ? p.builtinToolIds : []);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setBuiltinToolIds([]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, hasToken]);

  return { builtinToolIds, loading };
}
