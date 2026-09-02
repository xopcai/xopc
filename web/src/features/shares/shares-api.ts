import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

export type ShareReachability = 'public' | 'lan' | 'local-only';

export type ShareKind = 'file' | 'directory' | 'note' | 'session';

export type ShareDirectoryMeta = {
  mode: 'browse' | 'zip-only';
  entryCount: number;
  followSymlinks: boolean;
  maxDepth: number;
};

export type ShareItem = {
  id: string;
  kind: ShareKind;
  fileName: string;
  workspaceRelativePath: string;
  shareUrl: string;
  lanUrl: string | null;
  reachability: ShareReachability;
  createdAt: string;
  expiresAt: string;
  downloadCount: number;
  maxViews: number | null;
  revoked: boolean;
  expired: boolean;
  description: string | null;
  fileSize: number;
  mimeType: string;
  directory: ShareDirectoryMeta | null;
  sourceNoteId?: string;
  sourceVersion?: number;
  snapshotRevision?: number;
  attachmentCount?: number;
  sourceSessionId?: string;
  cutoffSeq?: number;
  messageCount?: number;
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
  kind?: Exclude<ShareKind, 'note' | 'session'>;
  directoryMode?: 'browse' | 'zip-only';
  followSymlinks?: boolean;
  maxFileCount?: number;
  maxFolderSize?: number;
  maxDepth?: number;
};

export type CreateShareResponse = {
  ok: boolean;
  payload: {
    id: string;
    token: string;
    kind: ShareKind;
    shareUrl: string;
    lanUrl: string | null;
    reachability: ShareReachability;
    reachabilityHint: string | null;
    expiresAt: string;
    maxViews: number | null;
    fileName: string;
    fileSize: number;
    directory: ShareDirectoryMeta | null;
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

export type SessionShareMessage = {
  id: string;
  role: 'user' | 'assistant';
  markdown: string;
  createdAt: string;
  attachmentIds: string[];
};

export type SessionShareToolActivity = {
  id: string;
  messageId?: string;
  toolName: string;
  status: 'completed' | 'failed';
  createdAt: string;
};

export type SessionShareAttachmentCandidate = {
  id: string;
  messageId: string;
  fileName: string;
  mimeType: string;
  size: number;
};

export type SessionSharePreview = {
  sessionId: string;
  cutoffSeq: number;
  metadataUpdatedAt: string;
  title: string;
  snapshotAt: string;
  messageCount: number;
  messages: SessionShareMessage[];
  toolActivities: SessionShareToolActivity[];
  attachmentCandidates: SessionShareAttachmentCandidate[];
};

export type SessionShareResult = {
  id: string;
  kind: 'session';
  delivery: 'local' | 'hosted';
  shareUrl: string;
  lanUrl: string | null;
  reachability: ShareReachability;
  reachabilityHint: string | null;
  expiresAt: string;
  maxViews: number | null;
  fileName: string;
  messageCount: number;
  attachmentCount: number;
  snapshotRevision: number;
  includeToolActivities: boolean;
};

export type SessionShareListItem = SessionShareResult & {
  createdAt: string;
  viewCount: number;
  revoked: boolean;
  expired: boolean;
  description: string | null;
  cutoffSeq: number;
};

export async function fetchSessionSharePreview(sessionKey: string): Promise<SessionSharePreview> {
  const response = await fetchJson<{ ok: true; payload: SessionSharePreview }>(
    apiUrl(`/api/sessions/${encodeURIComponent(sessionKey)}/share-preview`),
  );
  return response.payload;
}

export async function fetchSessionShares(sessionKey: string): Promise<SessionShareListItem[]> {
  const response = await fetchJson<{ ok: true; payload: { shares: SessionShareListItem[] } }>(
    apiUrl(`/api/sessions/${encodeURIComponent(sessionKey)}/shares`),
  );
  return response.payload.shares;
}

export async function fetchHostedSessionShares(sessionKey: string): Promise<SessionShareListItem[]> {
  const response = await fetchJson<{ ok: true; payload: { shares: SessionShareListItem[] } }>(
    apiUrl(`/api/sessions/${encodeURIComponent(sessionKey)}/hosted-shares`),
  );
  return response.payload.shares;
}

export async function fetchHostedShareAuthStatus(): Promise<boolean> {
  const response = await fetchJson<{ ok: true; payload: { authStatus: string } }>(
    apiUrl('/api/auth/oauth/xopc-share'),
  );
  return response.payload.authStatus === 'connected';
}

export async function createSessionShare(
  sessionKey: string,
  input: {
    expectedSessionId: string;
    expectedCutoffSeq: number;
    expectedMetadataUpdatedAt: string;
    ttlMs: number;
    maxViews: number | null;
    description?: string;
    includeToolActivities?: boolean;
    attachmentIds?: string[];
  },
): Promise<SessionShareResult> {
  const response = await fetchJson<{ ok: true; payload: SessionShareResult }>(
    apiUrl(`/api/sessions/${encodeURIComponent(sessionKey)}/shares`),
    { method: 'POST', body: JSON.stringify(input) },
  );
  return response.payload;
}

export async function createHostedSessionShare(
  sessionKey: string,
  input: Parameters<typeof createSessionShare>[1],
): Promise<SessionShareResult> {
  const response = await fetchJson<{ ok: true; payload: SessionShareResult }>(
    apiUrl(`/api/sessions/${encodeURIComponent(sessionKey)}/hosted-shares`),
    { method: 'POST', body: JSON.stringify(input) },
  );
  return response.payload;
}

export async function refreshSessionShare(
  sessionKey: string,
  shareId: string,
  input: {
    expectedSessionId: string;
    expectedCutoffSeq: number;
    expectedMetadataUpdatedAt: string;
    includeToolActivities?: boolean;
    attachmentIds?: string[];
  },
): Promise<SessionShareResult> {
  const response = await fetchJson<{ ok: true; payload: SessionShareResult }>(
    apiUrl(`/api/sessions/${encodeURIComponent(sessionKey)}/shares/${encodeURIComponent(shareId)}/refresh`),
    { method: 'POST', body: JSON.stringify(input) },
  );
  return response.payload;
}

export async function refreshHostedSessionShare(
  sessionKey: string,
  shareId: string,
  input: Parameters<typeof refreshSessionShare>[2],
): Promise<SessionShareResult> {
  const response = await fetchJson<{ ok: true; payload: SessionShareResult }>(
    apiUrl(`/api/sessions/${encodeURIComponent(sessionKey)}/hosted-shares/${encodeURIComponent(shareId)}/refresh`),
    { method: 'POST', body: JSON.stringify(input) },
  );
  return response.payload;
}

export async function revokeHostedSessionShare(sessionKey: string, shareId: string): Promise<void> {
  await fetchJson(
    apiUrl(`/api/sessions/${encodeURIComponent(sessionKey)}/hosted-shares/${encodeURIComponent(shareId)}`),
    { method: 'DELETE' },
  );
}
