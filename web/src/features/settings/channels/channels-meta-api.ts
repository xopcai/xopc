import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

export type ChannelHubMetaRow = {
  id: string;
  label: string;
  description: string;
  manageable: boolean;
  order: number;
};

export function channelsMetaSwrKey(): string {
  return apiUrl('/api/channels/meta');
}

export async function fetchChannelsMeta(): Promise<ChannelHubMetaRow[]> {
  const data = await fetchJson<{ ok?: boolean; payload?: { channels?: ChannelHubMetaRow[] } }>(
    channelsMetaSwrKey(),
  );
  return data.payload?.channels ?? [];
}
