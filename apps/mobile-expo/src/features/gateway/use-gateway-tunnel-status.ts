import { useCallback, useEffect, useState } from 'react';

import { fetchTunnelStatus, type TunnelStatusResponse } from '../../api/tunnel';
import { useGatewayStore } from '../../stores/gateway-store';

export function useGatewayTunnelStatus(refreshToken = 0): {
  status: TunnelStatusResponse | null;
  loading: boolean;
  hasToken: boolean;
  refresh: () => Promise<void>;
} {
  const token = useGatewayStore((s) => s.token);
  const baseUrl = useGatewayStore((s) => s.baseUrl);
  const [status, setStatus] = useState<TunnelStatusResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const hasToken = Boolean(token.trim());
  const enabled = Boolean(baseUrl.trim());

  const refresh = useCallback(async () => {
    if (!enabled || !hasToken) {
      setStatus(null);
      return;
    }
    setLoading(true);
    try {
      const data = await fetchTunnelStatus();
      setStatus(data);
    } finally {
      setLoading(false);
    }
  }, [enabled, hasToken]);

  useEffect(() => {
    void refresh();
  }, [refresh, refreshToken]);

  return { status, loading, hasToken, refresh };
}
