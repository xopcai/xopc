import useSWR from 'swr';

import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

export type ChannelActionDescriptor = {
  label?: string;
  description?: string;
  result?: 'ok' | 'qr' | 'poll' | 'diagnostics' | 'form';
  schema?: Record<string, unknown>;
};

export type ChannelCatalogEntry = {
  id: string;
  extensionId: string;
  source: string;
  label: string;
  description?: string;
  docsPath?: string;
  order: number;
  configPath: string;
  capabilities?: Record<string, unknown>;
  configSchema?: Record<string, unknown>;
  uiHints?: Record<string, unknown>;
  actions?: Record<string, ChannelActionDescriptor>;
  enabled?: boolean;
  configured?: boolean;
  runtime?: string;
};

export function channelCatalogSwrKey(): string {
  return apiUrl('/api/channels/catalog');
}

export async function fetchChannelCatalog(): Promise<ChannelCatalogEntry[]> {
  const data = await fetchJson<{ ok?: boolean; payload?: { channels?: ChannelCatalogEntry[] } }>(
    channelCatalogSwrKey(),
  );
  return data.payload?.channels ?? [];
}

export function useChannelCatalog(hasToken: boolean) {
  const { data, error, isLoading, isValidating, mutate } = useSWR(
    hasToken ? channelCatalogSwrKey() : null,
    fetchChannelCatalog,
    { revalidateOnFocus: false },
  );
  return { entries: data ?? [], isLoading, isValidating, error, mutate };
}
