export const CHANNELS_HUB_PATH = '/channels';

export function channelDetailPath(id: string): string {
  return `${CHANNELS_HUB_PATH}/${encodeURIComponent(id.trim().toLowerCase())}`;
}

export function normalizeChannelRouteId(raw: string | undefined): string | null {
  const id = raw?.trim().toLowerCase();
  return id ? id : null;
}
