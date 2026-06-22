import { mediaUriToReadUrl } from '@/features/chat/attachments/attachment-utils-core';
import { apiFetch } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

export type FetchPreviewBlobResult =
  | { ok: true; blob: Blob }
  | { ok: false; reason: 'http'; status: number }
  | { ok: false; reason: 'network'; message: string };

export async function fetchMediaUriBlob(params: {
  uri: string;
  sessionKey?: string | null;
}): Promise<FetchPreviewBlobResult> {
  const { uri, sessionKey } = params;
  try {
    const res = await apiFetch(apiUrl(mediaUriToReadUrl(uri, sessionKey)));
    if (!res.ok) return { ok: false, reason: 'http', status: res.status };
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
  const result = await fetchMediaUriBlob(params);
  if (!result.ok) return result;
  return { ok: true, buffer: await result.blob.arrayBuffer() };
}
