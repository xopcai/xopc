import { Directory, File, Paths } from 'expo-file-system';

import { apiFetch, formatApiHttpError } from '../../api/client';

let nextCacheId = 0;

function extensionForMimeType(mimeType: string): string {
  if (mimeType.includes('wav')) return 'wav';
  if (mimeType.includes('ogg')) return 'ogg';
  if (mimeType.includes('aac')) return 'aac';
  if (mimeType.includes('mp4') || mimeType.includes('m4a')) return 'm4a';
  return 'mp3';
}

async function audioDownloadError(response: Response): Promise<Error> {
  const body = await response.json().catch(() => null) as {
    error?: string | { message?: string };
  } | null;
  const message = typeof body?.error === 'string' ? body.error : body?.error?.message;
  return new Error(formatApiHttpError(response.status, response.statusText, message));
}

export class MessageAudioCache {
  private readonly directory: Directory;
  private localUri: string | null = null;

  constructor(id = `${Date.now()}-${nextCacheId++}`) {
    this.directory = new Directory(Paths.cache, 'message-audio', id);
    this.directory.create({ intermediates: true, idempotent: true });
  }

  async download(path: string, fallbackMimeType = 'audio/mpeg'): Promise<string> {
    if (this.localUri) return this.localUri;
    const response = await apiFetch(path, { timeoutMs: 60_000 });
    if (!response.ok) throw await audioDownloadError(response);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength === 0) throw new Error('Audio download was empty');
    const mimeType = response.headers.get('Content-Type')?.split(';')[0]?.trim() || fallbackMimeType;
    const file = new File(this.directory, `audio.${extensionForMimeType(mimeType)}`);
    file.create({ overwrite: true });
    file.write(bytes);
    this.localUri = file.uri;
    return file.uri;
  }

  remove(): void {
    this.localUri = null;
    try {
      if (this.directory.exists) this.directory.delete();
    } catch {
      // The OS may already have purged the cache.
    }
  }
}
