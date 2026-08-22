import { Directory, File, Paths } from 'expo-file-system';

function extensionForMimeType(mimeType: string): string {
  if (mimeType.includes('wav')) return 'wav';
  if (mimeType.includes('ogg')) return 'ogg';
  if (mimeType.includes('aac')) return 'aac';
  if (mimeType.includes('mp4') || mimeType.includes('m4a')) return 'm4a';
  return 'mp3';
}

export class ReadAloudCache {
  private readonly directory: Directory;

  constructor(id: string) {
    this.directory = new Directory(Paths.cache, 'read-aloud', id);
    this.directory.create({ intermediates: true, idempotent: true });
  }

  write(index: number, bytes: Uint8Array, mimeType: string): string {
    const file = new File(this.directory, `${index}.${extensionForMimeType(mimeType)}`);
    file.create({ overwrite: true });
    file.write(bytes);
    return file.uri;
  }

  remove(): void {
    try {
      if (this.directory.exists) this.directory.delete();
    } catch {
      // Cache cleanup must not turn a successful playback action into an error.
    }
  }
}

export function clearStaleReadAloudCache(): void {
  try {
    const root = new Directory(Paths.cache, 'read-aloud');
    if (root.exists) root.delete();
  } catch {
    // The OS may already have purged the cache.
  }
}
