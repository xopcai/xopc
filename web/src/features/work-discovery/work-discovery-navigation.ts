export const WORK_DISCOVERY_OVERLAY_PARAM = 'workDiscovery';

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
