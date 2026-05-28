import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

export type ShareReachability = 'public' | 'lan' | 'local-only';

export type ShareItem = {
  id: string;
  fileName: string;
  workspaceRelativePath: string;
  shareUrl: string;
  lanUrl: string | null;
  reachability: ShareReachability;
  createdAt: string;
  expiresAt: string;
  viewCount: number;
  maxViews: number | null;
  revoked: boolean;
  expired: boolean;
  description: string | null;
  fileSize: number;
  mimeType: string;
};

export type ShareListResponse = {
  ok: boolean;
  payload: { shares: ShareItem[] };
};

export type CreateShareParams = {
  path: string;
  ttlMs?: number;
  maxViews?: number | null;
  description?: string;
  sessionKey?: string;
  agentId?: string;
};

export type CreateShareResponse = {
  ok: boolean;
  payload: {
    id: string;
    token: string;
    shareUrl: string;
    lanUrl: string | null;
    reachability: ShareReachability;
    reachabilityHint: string | null;
    expiresAt: string;
    maxViews: number | null;
    fileName: string;
    fileSize: number;
  };
};

export type RevokeResponse = { ok: boolean };
export type BatchRevokeResponse = { ok: boolean; payload: { revokedCount: number } };
export type UpdateShareResponse = {
  ok: boolean;
  payload: { id: string; expiresAt: string; maxViews: number | null; shareUrl: string };
};

export async function fetchShares(): Promise<ShareListResponse> {
  return fetchJson<ShareListResponse>(apiUrl('/api/shares'));
}

export async function createShare(params: CreateShareParams): Promise<CreateShareResponse> {
  return fetchJson<CreateShareResponse>(apiUrl('/api/shares'), {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

export async function revokeShare(id: string): Promise<RevokeResponse> {
  return fetchJson<RevokeResponse>(apiUrl(`/api/shares/${id}`), { method: 'DELETE' });
}

export async function cleanExpiredShares(): Promise<BatchRevokeResponse> {
  return fetchJson<BatchRevokeResponse>(apiUrl('/api/shares'), {
    method: 'DELETE',
    body: JSON.stringify({ expired: true }),
  });
}

export async function extendShare(
  id: string,
  extendTtlMs: number,
): Promise<UpdateShareResponse> {
  return fetchJson<UpdateShareResponse>(apiUrl(`/api/shares/${id}`), {
    method: 'PATCH',
    body: JSON.stringify({ extendTtlMs }),
  });
}
