import useSWR from 'swr';

import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

export type ChannelActionDescriptor = {
  label?: string;
  description?: string;
  result?: 'ok' | 'qr' | 'poll' | 'diagnostics' | 'form';
  schema?: Record<string, unknown>;
};

export type ChannelSetupIssue = {
  code: string;
  severity: 'required' | 'warning';
  fieldPath?: string;
  message: string;
  action?: 'open_config' | 'run_setup' | 'run_doctor';
};

export type ChannelSetupStatus = {
  enabled: boolean;
  ready: boolean;
  state: 'disabled' | 'needs_setup' | 'ready' | 'error';
  issues: ChannelSetupIssue[];
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
  ui?: {
    icon?: string;
    card?: {
      primaryAction?: string;
      summaryFields?: string[];
    };
    modal?: {
      entrypoint?: string;
      minHeight?: number;
      maxHeight?: number;
      permissions?: string[];
      placement?: 'before-config' | 'after-setup' | 'replace-config';
    };
  };
  enabled?: boolean;
  configured?: boolean;
  setupStatus?: ChannelSetupStatus;
  runtime?: string;
};

export function channelCatalogSwrKey(locale: string): string {
  return apiUrl(`/api/channels/catalog?locale=${encodeURIComponent(locale)}`);
}

export async function fetchChannelCatalog(locale: string): Promise<ChannelCatalogEntry[]> {
  const data = await fetchJson<{ ok?: boolean; payload?: { channels?: ChannelCatalogEntry[] } }>(
    channelCatalogSwrKey(locale),
  );
  return data.payload?.channels ?? [];
}

export function useChannelCatalog(hasToken: boolean, locale: string) {
  const { data, error, isLoading, isValidating, mutate } = useSWR(
    hasToken ? channelCatalogSwrKey(locale) : null,
    () => fetchChannelCatalog(locale),
    { revalidateOnFocus: false },
  );
  return { entries: data ?? [], isLoading, isValidating, error, mutate };
}
