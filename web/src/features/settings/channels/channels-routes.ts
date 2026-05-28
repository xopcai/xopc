export const CHANNELS_HUB_PATH = '/channels';

export type ManageableChannelId = 'telegram' | 'weixin' | 'feishu';

const MANAGEABLE_CHANNEL_IDS: readonly ManageableChannelId[] = ['telegram', 'weixin', 'feishu'];

export function isManageableChannelId(id: string): id is ManageableChannelId {
  return (MANAGEABLE_CHANNEL_IDS as readonly string[]).includes(id);
}

export function channelDetailPath(id: string, opts?: { pairing?: boolean }): string {
  const base = `${CHANNELS_HUB_PATH}/${encodeURIComponent(id.trim().toLowerCase())}`;
  if (opts?.pairing) return `${base}?pairing=1`;
  return base;
}

export function normalizeChannelRouteId(raw: string | undefined): string | null {
  const id = raw?.trim().toLowerCase();
  return id ? id : null;
}
