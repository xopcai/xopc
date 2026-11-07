import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';
import type { LocalAppResourceScopes } from '@xopcai/gateway-contract';

export type ExtensionUiGrant = {
  granted: boolean;
  extensionId: string;
  appId?: string;
  manifestDigest?: string;
  permissions: string[];
  grantedAt?: number;
  grantRevision?: string;
  resourceScopes?: LocalAppResourceScopes;
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
  manifestDigest: string,
  resourceScopes?: LocalAppResourceScopes,
): Promise<ExtensionUiGrant> {
  return (await fetchJson<{ grant: ExtensionUiGrant }>(
    apiUrl(`/api/extensions/${encodeURIComponent(extensionId)}/ui-grant`),
    { method: 'POST', body: JSON.stringify({ manifestDigest, resourceScopes }) },
  )).grant;
}
