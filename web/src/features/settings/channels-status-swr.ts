import { getChannels } from '@/features/settings/channel-recipient-api';
import { apiUrl } from '@/lib/url';

export function channelsStatusSwrKey(): string {
  return apiUrl('/api/channels/status');
}

/** Same network call as `getChannels`; use with `channelsStatusSwrKey()` for SWR. */
export const fetchChannelsStatusSwr = getChannels;
