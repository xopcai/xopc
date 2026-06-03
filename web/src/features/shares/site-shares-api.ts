import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

export type SiteSourceKind = 'static' | 'proxy';
export type SiteRewriteMode = 'none' | 'html-only' | 'html-css';

export type SiteShareItem = {
  id: string;
  token: string;
  subdomain: string | null;
  kind: SiteSourceKind;
  createdAt: string;
  expiresAt: string;
  revoked: boolean;
  expired: boolean;
  description: string | null;
  requestCount: number;
  uniqueClientCount: number;
  maxRequests: number | null;
  publicUrl: string;
  subpathUrl: string;
  source:
    | {
        kind: 'static';
        rootDir: string;
        workspaceRoot: string;
        workspaceRelativePath: string;
        spaFallback: boolean;
        rewriteMode: SiteRewriteMode;
      }
    | {
        kind: 'proxy';
        upstreamUrl: string;
        rewriteSetCookiePath: boolean;
        forwardWebSocket: boolean;
        forwardedHeaders: 'minimal' | 'full';
      };
};

export type SiteShareListResponse = {
  ok: boolean;
  payload: { shares: SiteShareItem[] };
};

export type CreateSiteShareParams = {
  kind: SiteSourceKind;
  /** Static: workspace-relative path. */
  path?: string;
  /** Proxy: full upstream URL (http/https). */
  upstreamUrl?: string;
  ttlMs?: number;
  description?: string;
  subdomain?: string;
  maxRequests?: number | null;
  spaFallback?: boolean;
  rewriteMode?: SiteRewriteMode;
  forwardWebSocket?: boolean;
  sessionKey?: string;
  agentId?: string;
};

export type CreateSiteShareResponse = {
  ok: boolean;
  payload: {
    id: string;
    token: string;
    subdomain: string | null;
    kind: SiteSourceKind;
    createdAt: string;
    expiresAt: string;
    description: string | null;
    maxRequests: number | null;
    publicUrl: string;
    subpathUrl: string;
  };
};

export type SiteShareRevokeResponse = { ok: boolean };
export type SiteShareBatchRevokeResponse = { ok: boolean; payload: { revokedCount: number } };
export type SiteShareUpdateResponse = {
  ok: boolean;
  payload: { id: string; expiresAt: string; maxRequests: number | null };
};

export async function fetchSiteShares(): Promise<SiteShareListResponse> {
  return fetchJson<SiteShareListResponse>(apiUrl('/api/site-shares'));
}

export async function createSiteShare(params: CreateSiteShareParams): Promise<CreateSiteShareResponse> {
  return fetchJson<CreateSiteShareResponse>(apiUrl('/api/site-shares'), {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

export async function revokeSiteShare(id: string): Promise<SiteShareRevokeResponse> {
  return fetchJson<SiteShareRevokeResponse>(apiUrl(`/api/site-shares/${id}`), { method: 'DELETE' });
}

export async function cleanExpiredSiteShares(): Promise<SiteShareBatchRevokeResponse> {
  return fetchJson<SiteShareBatchRevokeResponse>(apiUrl('/api/site-shares'), {
    method: 'DELETE',
    body: JSON.stringify({ expired: true }),
  });
}

export async function extendSiteShare(id: string, extendTtlMs: number): Promise<SiteShareUpdateResponse> {
  return fetchJson<SiteShareUpdateResponse>(apiUrl(`/api/site-shares/${id}`), {
    method: 'PATCH',
    body: JSON.stringify({ extendTtlMs }),
  });
}
