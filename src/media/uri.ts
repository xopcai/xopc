import type { MediaBucket } from './types.js';

const BUCKETS: ReadonlySet<string> = new Set(['inbound', 'tts', 'outbound', 'work-item']);

export class MediaUriError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MediaUriError';
  }
}

export function buildMediaUri(bucket: MediaBucket, id: string): string {
  if (!id || id.includes('/') || id.includes('\\') || id.includes('\0')) {
    throw new MediaUriError(`Invalid media id: ${JSON.stringify(id)}`);
  }
  return `media://${bucket}/${encodeURIComponent(id).replace(/%2F/g, '/')}`;
}

export function parseMediaUri(source: string): { bucket: MediaBucket; id: string; uri: string } {
  const trimmed = source.trim();
  if (!/^media:\/\//i.test(trimmed)) {
    throw new MediaUriError(`Not a media URI: ${JSON.stringify(source)}`);
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new MediaUriError(`Invalid media URI: ${trimmed}`);
  }

  const bucket = parsed.hostname;
  if (!BUCKETS.has(bucket)) {
    throw new MediaUriError(`Unsupported media bucket: ${bucket || '(missing)'}`);
  }

  let id: string;
  try {
    id = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''));
  } catch {
    throw new MediaUriError(`Invalid media URI: ${trimmed}`);
  }

  if (!id || id.includes('/') || id.includes('\\') || id.includes('\0')) {
    throw new MediaUriError(`Invalid media URI id: ${trimmed}`);
  }

  return {
    bucket: bucket as MediaBucket,
    id,
    uri: trimmed,
  };
}

export function tryParseMediaUri(source: string): { bucket: MediaBucket; id: string; uri: string } | null {
  try {
    return parseMediaUri(source);
  } catch {
    return null;
  }
}
