import { apiFetch } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';
import { useGatewayStore } from '@/stores/gateway-store';

import { noteMediaApiPath } from './attachment-ref';

type CacheEntry = {
  blob: Promise<Blob>;
  objectUrl: string | null;
  refCount: number;
};

const blobCache = new Map<string, CacheEntry>();
let cacheToken = '';

function cacheKey(noteId: string, attachmentId: string, token: string): string {
  return `${token}:${noteId}:${attachmentId}`;
}

function resetCacheIfTokenChanged(): void {
  const token = useGatewayStore.getState().token ?? '';
  if (token === cacheToken) return;
  for (const entry of blobCache.values()) {
    if (entry.objectUrl) URL.revokeObjectURL(entry.objectUrl);
  }
  blobCache.clear();
  cacheToken = token;
}

async function fetchNoteMediaBlob(noteId: string, attachmentId: string): Promise<Blob> {
  resetCacheIfTokenChanged();
  const token = useGatewayStore.getState().token ?? '';
  const key = cacheKey(noteId, attachmentId, token);
  let entry = blobCache.get(key);
  if (!entry) {
    const blobPromise = (async () => {
      const res = await apiFetch(apiUrl(noteMediaApiPath(noteId, attachmentId)));
      if (res.status === 401) {
        useGatewayStore.getState().onUnauthorized();
      }
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      return res.blob();
    })();
    entry = { blob: blobPromise, objectUrl: null, refCount: 0 };
    blobCache.set(key, entry);
  }
  return entry.blob;
}

/** Fetch note media via Bearer auth and return a cached object URL. */
export async function acquireNoteMediaObjectUrl(
  noteId: string,
  attachmentId: string,
): Promise<string> {
  resetCacheIfTokenChanged();
  const token = useGatewayStore.getState().token ?? '';
  const key = cacheKey(noteId, attachmentId, token);
  let entry = blobCache.get(key);
  if (!entry) {
    entry = {
      blob: fetchNoteMediaBlob(noteId, attachmentId),
      objectUrl: null,
      refCount: 0,
    };
    blobCache.set(key, entry);
  }

  if (!entry.objectUrl) {
    const blob = await entry.blob;
    entry.objectUrl = URL.createObjectURL(blob);
  }
  entry.refCount += 1;
  return entry.objectUrl;
}

export function releaseNoteMediaObjectUrl(noteId: string, attachmentId: string): void {
  resetCacheIfTokenChanged();
  const token = useGatewayStore.getState().token ?? '';
  const key = cacheKey(noteId, attachmentId, token);
  const entry = blobCache.get(key);
  if (!entry) return;
  entry.refCount = Math.max(0, entry.refCount - 1);
  if (entry.refCount === 0 && entry.objectUrl) {
    URL.revokeObjectURL(entry.objectUrl);
    entry.objectUrl = null;
    blobCache.delete(key);
  }
}

export function clearNoteMediaBlobCache(): void {
  for (const entry of blobCache.values()) {
    if (entry.objectUrl) URL.revokeObjectURL(entry.objectUrl);
  }
  blobCache.clear();
  cacheToken = '';
}
