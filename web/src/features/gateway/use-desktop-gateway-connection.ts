import useSWR from 'swr';

export function useDesktopGatewayConnection() {
  const api = typeof window === 'undefined' ? undefined : window.electronAPI?.gateway;
  return useSWR(api?.connection ? 'desktop-gateway-connection' : null, () => api!.connection(), { refreshInterval: 3000 });
}
