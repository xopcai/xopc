import { readMediaBuffer, resolveMediaBufferPath, mimeTypeFromMediaPath } from './store.js';
import { parseMediaUri, tryParseMediaUri } from './uri.js';
import type { MediaBucket } from './types.js';

export type ResolvedMediaReference = {
  bucket: MediaBucket;
  id: string;
  uri: string;
  path: string;
};

/** Resolve a `media://` URI to an absolute filesystem path. */
export async function resolveMediaReference(uri: string): Promise<ResolvedMediaReference> {
  const parsed = parseMediaUri(uri);
  const path = resolveMediaBufferPath(parsed.id, parsed.bucket);
  return { ...parsed, path };
}

/** Read bytes for a media URI. */
export async function readMediaReference(
  uri: string,
  maxBytes?: number,
): Promise<{ buffer: Buffer; path: string; contentType?: string }> {
  const parsed = parseMediaUri(uri);
  const result = await readMediaBuffer(parsed.id, parsed.bucket, maxBytes);
  return { buffer: result.buffer, path: result.path };
}

/** Load file as base64 for LLM boundaries. */
export async function readMediaReferenceBase64(
  uri: string,
  maxBytes?: number,
): Promise<{ data: string; mimeType: string; path: string }> {
  const { buffer, path } = await readMediaReference(uri, maxBytes);
  return {
    data: buffer.toString('base64'),
    mimeType: mimeTypeFromMediaPath(path),
    path,
  };
}

export { tryParseMediaUri, parseMediaUri };
