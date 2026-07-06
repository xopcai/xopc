/**
 * Share API client — typed wrappers over the gateway's share endpoints.
 *
 *  - POST /api/shares/auto   : smart-routed share creation (file / site / zip)
 *  - GET  /api/shares        : list existing shares (history)
 *  - DELETE /api/shares/:id  : revoke a share
 *  - PATCH /api/shares/:id   : extend TTL / change maxViews
 *  - HEAD /s/:token/thumbnail: poll thumbnail readiness (200 = ready, 202 = pending)
 *
 * The response types intentionally mirror the gateway's server-side shape
 * (`src/share/share-auto.ts` and `src/gateway/hono/routes/shares.ts`) so we
 * don't drift; if you add a field on the server, add it here too.
 */
import { apiFetch, formatApiHttpError } from './client';

// ── Types ────────────────────────────────────────────────────────────────────

export type ShareAudience = 'friend' | 'colleague' | 'public';
export type ShareAutoMode = 'auto' | 'force-file' | 'force-site' | 'force-zip';
export type ShareKind = 'file' | 'site' | 'zip';
export type ShareReachability = 'public' | 'lan' | 'local-only';
export type ThumbnailStatus = 'ready' | 'pending' | 'unavailable';

export type ShareAutoRequest = {
  path: string;
  sessionKey?: string;
  agentId?: string;
  mode?: ShareAutoMode;
  audience?: ShareAudience;
  title?: string;
  description?: string;
  ttlMs?: number;
  maxViews?: number | null;
  thumbnail?: boolean;
};

export type ShareAutoPayload = {
  share: {
    id: string;
    kind: ShareKind;
    title: string;
    description: string;
    shareUrl: string;
    lanUrl: string | null;
    reachability: ShareReachability;
    reachabilityHint: string | null;
    expiresAt: string;
    maxViews: number | null;
  };
  thumbnail: {
    url: string;
    status: ThumbnailStatus;
    width: number;
    height: number;
  };
  routing: {
    reason:
      | 'html-single-file'
      | 'html-with-assets'
      | 'small-image'
      | 'large-binary'
      | 'directory-zip'
      | 'directory-browse'
      | 'forced';
    hint: string;
  };
};

export type ShareListItem = {
  id: string;
  kind: 'file' | 'directory';
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
  directory: unknown | null;
};

// ── Calls ────────────────────────────────────────────────────────────────────

async function readJsonErr(res: Response): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
  return formatApiHttpError(res.status, res.statusText, body.error?.message);
}

export async function createAutoShare(req: ShareAutoRequest): Promise<ShareAutoPayload> {
  const res = await apiFetch('/api/shares/auto', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(await readJsonErr(res));
  const data = (await res.json()) as { ok: true; payload: ShareAutoPayload };
  return data.payload;
}

export async function listShares(): Promise<ShareListItem[]> {
  const res = await apiFetch('/api/shares');
  if (!res.ok) throw new Error(await readJsonErr(res));
  const data = (await res.json()) as { ok: true; payload: { shares: ShareListItem[] } };
  return data.payload.shares;
}

export async function revokeShare(id: string): Promise<void> {
  const res = await apiFetch(`/api/shares/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(await readJsonErr(res));
}

export async function extendShare(id: string, patch: { extendTtlMs?: number; maxViews?: number | null }): Promise<void> {
  const res = await apiFetch(`/api/shares/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(await readJsonErr(res));
}

/**
 * HEAD the thumbnail URL. Returns the readiness, NOT the bytes.
 *  - 200 → server has a real cached image (we should show it now).
 *  - 202 → still generating; caller should poll again shortly.
 *  - 404 / 410 → share is gone; stop polling.
 *  - other → treat as transient; caller decides whether to retry.
 *
 * Accepts an absolute thumbnail URL (as returned by `createAutoShare`).
 * Internally we use bare `fetch` to avoid dual-fire confusion on an
 * already-resolved URL — the gateway store auth-header is added manually.
 */
export async function probeThumbnail(
  thumbnailUrl: string,
  authToken: string | undefined,
): Promise<'ready' | 'pending' | 'gone' | 'unknown'> {
  if (!thumbnailUrl) return 'unknown';
  try {
    const headers = new Headers();
    if (authToken) headers.set('Authorization', `Bearer ${authToken}`);
    const res = await fetch(thumbnailUrl, { method: 'HEAD', headers });
    if (res.status === 200) return 'ready';
    if (res.status === 202) return 'pending';
    if (res.status === 404 || res.status === 410) return 'gone';
    return 'unknown';
  } catch {
    return 'unknown';
  }
}
