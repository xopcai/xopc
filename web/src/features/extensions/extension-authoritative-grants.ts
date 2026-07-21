import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

export type ExtensionUiGrant = {
  granted: boolean;
  extensionId: string;
  appId?: string;
  manifestDigest?: string;
  permissions: string[];
  grantedAt?: number;
};

export async function resolveExtensionUiGrant(
  extensionId: string,
): Promise<ExtensionUiGrant> {
  const { grant } = await fetchJson<{ grant: ExtensionUiGrant }>(
    apiUrl(`/api/extensions/${encodeURIComponent(extensionId)}/ui-grant`),
  );
  return grant;
}

export async function confirmExtensionUiGrant(
  extensionId: string,
): Promise<ExtensionUiGrant> {
  return (await fetchJson<{ grant: ExtensionUiGrant }>(
    apiUrl(`/api/extensions/${encodeURIComponent(extensionId)}/ui-grant`),
    { method: 'POST' },
  )).grant;
}
