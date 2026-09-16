import { asset } from '@kit.AssetStoreKit';
import { util } from '@kit.ArkTS';
import { BusinessError } from '@kit.BasicServicesKit';

export function utf8(text: string): Uint8Array { return text.length === 0 ? new Uint8Array(0) : new util.TextEncoder().encodeInto(text); }
export function fromUtf8(bytes: Uint8Array): string { return bytes.length === 0 ? '' : new util.TextDecoder('utf-8', { fatal: true }).decodeToString(bytes); }

interface XopcAssetManifest { generation: string; chunks: number; length: number; }
const MANIFEST_PREFIX: string = 'xopc-asset-v1:';
const CHUNK_BYTES: number = 1000;
const MAX_RECORD_BYTES: number = 128 * 1024;

export class XopcSecureStore {
  private static pending: Promise<void> = Promise.resolve();

  private serialized<T>(job: () => Promise<T>): Promise<T> {
    const operation = XopcSecureStore.pending.then(job);
    XopcSecureStore.pending = operation.then((): void => {}, (_error: Error): void => {});
    return operation;
  }

  read(key: string): Promise<string | undefined> {
    return this.serialized(async (): Promise<string | undefined> => {
      const root = await this.readRaw(key);
      if (!root) return undefined;
      const value = fromUtf8(root); const manifest = this.manifest(value);
      if (!manifest) return value;
      const bytes = new Uint8Array(manifest.length);
      for (let i = 0; i < manifest.chunks; i++) {
        const chunk = await this.readRaw(this.chunkKey(key, manifest, i));
        if (!chunk || chunk.length !== Math.min(CHUNK_BYTES, manifest.length - i * CHUNK_BYTES)) throw new Error('INCOMPLETE_SECURE_RECORD');
        bytes.set(chunk, i * CHUNK_BYTES);
      }
      return fromUtf8(bytes);
    });
  }

  write(key: string, text: string): Promise<void> {
    return this.serialized(async (): Promise<void> => {
      const bytes = utf8(text);
      if (bytes.length > MAX_RECORD_BYTES) throw new Error('SECURE_RECORD_TOO_LARGE');
      const old = await this.readRaw(key);
      const previous = old ? this.manifest(fromUtf8(old)) : undefined;
      if (bytes.length > 0 && bytes.length <= CHUNK_BYTES && !text.startsWith(MANIFEST_PREFIX)) {
        await this.writeRaw(key, bytes);
      } else {
        const next: XopcAssetManifest = { generation: util.generateRandomUUID(),
          chunks: Math.ceil(bytes.length / CHUNK_BYTES), length: bytes.length };
        try {
          for (let i = 0; i < next.chunks; i++) {
            await this.writeRaw(this.chunkKey(key, next, i), bytes.slice(i * CHUNK_BYTES, (i + 1) * CHUNK_BYTES));
          }
          // Only this atomic pointer replacement makes a new generation visible.
          await this.writeRaw(key, utf8(MANIFEST_PREFIX + JSON.stringify(next)));
        } catch (error) { await this.removeChunks(key, next); throw error as Error; }
      }
      if (previous) await this.removeChunks(key, previous);
    });
  }

  remove(key: string): Promise<void> {
    return this.serialized(async (): Promise<void> => {
      const root = await this.readRaw(key);
      const manifest = root ? this.manifest(fromUtf8(root)) : undefined;
      await this.removeRaw(key);
      if (manifest) await this.removeChunks(key, manifest);
    });
  }

  private manifest(value: string): XopcAssetManifest | undefined {
    if (!value.startsWith(MANIFEST_PREFIX)) return undefined;
    const result = JSON.parse(value.slice(MANIFEST_PREFIX.length)) as XopcAssetManifest;
    if (!/^[a-f0-9-]{36}$/.test(result.generation) || !Number.isInteger(result.length) || result.length < 0
      || result.length > MAX_RECORD_BYTES || result.chunks !== Math.ceil(result.length / CHUNK_BYTES)) throw new Error('INVALID_SECURE_MANIFEST');
    return result;
  }
  private chunkKey(key: string, manifest: XopcAssetManifest, index: number): string {
    return key + '.' + manifest.generation + '.' + index;
  }
  private async removeChunks(key: string, manifest: XopcAssetManifest): Promise<void> {
    for (let i = 0; i < manifest.chunks; i++) {
      try { await this.removeRaw(this.chunkKey(key, manifest, i)); } catch (_error) { /* The committed generation remains authoritative. */ }
    }
  }

  private async readRaw(key: string): Promise<Uint8Array | undefined> {
    const query: asset.AssetMap = new Map<asset.Tag, asset.Value>();
    query.set(asset.Tag.ALIAS, utf8('xopc.' + key));
    query.set(asset.Tag.RETURN_TYPE, asset.ReturnType.ALL);
    try {
      const rows = await asset.query(query);
      if (rows.length === 0) return undefined;
      const secret = rows[0].get(asset.Tag.SECRET);
      if (!(secret instanceof Uint8Array)) throw new Error('INVALID_SECURE_RECORD');
      return secret;
    } catch (error) {
      if ((error as BusinessError).code === asset.ErrorCode.NOT_FOUND) return undefined;
      throw error as Error;
    }
  }

  private async writeRaw(key: string, bytes: Uint8Array): Promise<void> {
    const attributes: asset.AssetMap = new Map<asset.Tag, asset.Value>();
    attributes.set(asset.Tag.ALIAS, utf8('xopc.' + key));
    attributes.set(asset.Tag.SECRET, bytes);
    attributes.set(asset.Tag.ACCESSIBILITY, asset.Accessibility.DEVICE_FIRST_UNLOCKED);
    attributes.set(asset.Tag.SYNC_TYPE, asset.SyncType.NEVER);
    attributes.set(asset.Tag.CONFLICT_RESOLUTION, asset.ConflictResolution.OVERWRITE);
    await asset.add(attributes);
  }

  private async removeRaw(key: string): Promise<void> {
    const query: asset.AssetMap = new Map<asset.Tag, asset.Value>();
    query.set(asset.Tag.ALIAS, utf8('xopc.' + key));
    try { await asset.remove(query); } catch (error) {
      if ((error as BusinessError).code !== asset.ErrorCode.NOT_FOUND) throw error as Error;
    }
  }
}
