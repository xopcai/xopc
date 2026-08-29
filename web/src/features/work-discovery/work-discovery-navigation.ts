export const WORK_DISCOVERY_OVERLAY_PARAM = 'workDiscovery';
export const WORK_SERVICE_CONNECT_PATH = '/connectors?understanding=1&returnTo=%2Fonboarding%2Fworkspace';

export function openWorkServiceConnection(
  navigate: (path: string) => unknown,
  onNavigateAway?: () => void,
): void {
  onNavigateAway?.();
  navigate(WORK_SERVICE_CONNECT_PATH);
}

export function isWorkDiscoveryOverlaySearch(search: string): boolean {
  return new URLSearchParams(search).get(WORK_DISCOVERY_OVERLAY_PARAM) === 'new';
}

export function openWorkDiscoveryOverlaySearch(search: string): string {
  const params = new URLSearchParams(search);
  params.set(WORK_DISCOVERY_OVERLAY_PARAM, 'new');
  return `?${params.toString()}`;
}

export function closeWorkDiscoveryOverlaySearch(search: string): string {
  const params = new URLSearchParams(search);
  params.delete(WORK_DISCOVERY_OVERLAY_PARAM);
  const next = params.toString();
  return next ? `?${next}` : '';
}
