import { mediaUriToReadUrl } from '@/features/chat/attachments/attachment-utils-core';
import { apiFetch } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

export type FetchMediaUriBinaryResult =
  | { ok: true; blob: Blob }
  | { ok: false; reason: 'http'; status: number }
  | { ok: false; reason: 'network'; message: string };

/** Load persisted media via `GET /api/media/read?uri=media://…`. */
export async function fetchMediaUriBlob(params: {
  uri: string;
  sessionKey?: string | null;
}): Promise<FetchMediaUriBinaryResult> {
  const { uri, sessionKey } = params;
  try {
    const url = apiUrl(mediaUriToReadUrl(uri, sessionKey));
    const res = await apiFetch(url);
    if (!res.ok) {
      return { ok: false, reason: 'http', status: res.status };
    }
    return { ok: true, blob: await res.blob() };
  } catch (e) {
    return { ok: false, reason: 'network', message: e instanceof Error ? e.message : String(e) };
  }
}

export async function fetchMediaUriBuffer(params: {
  uri: string;
  sessionKey?: string | null;
}): Promise<
  | { ok: true; buffer: ArrayBuffer }
  | { ok: false; reason: 'http'; status: number }
  | { ok: false; reason: 'network'; message: string }
> {
  const blobResult = await fetchMediaUriBlob(params);
  if (!blobResult.ok) {
    return blobResult;
  }
  return { ok: true, buffer: await blobResult.blob.arrayBuffer() };
}

/** @deprecated Use fetchMediaUriBlob */
export async function fetchWorkspaceRelativeFileBlob(params: {
  uri: string;
  sessionKey?: string | null;
}): Promise<FetchMediaUriBinaryResult> {
  return fetchMediaUriBlob(params);
}

/** @deprecated Use fetchMediaUriBuffer */
export async function fetchWorkspaceRelativeFileBuffer(params: {
  uri: string;
  sessionKey?: string | null;
}): Promise<
  | { ok: true; buffer: ArrayBuffer }
  | { ok: false; reason: 'http'; status: number }
  | { ok: false; reason: 'network'; message: string }
> {
  return fetchMediaUriBuffer(params);
}
