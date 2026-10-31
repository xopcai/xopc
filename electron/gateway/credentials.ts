import { randomUUID } from 'node:crypto';
import { opendir, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { atomicConnectionWrite, isConnectionId, readBounded } from './profiles.js';

export interface ConnectionEncryption {
  available(): Promise<boolean>;
  encrypt(value: string): Promise<Buffer>;
  decrypt(value: Buffer): Promise<string>;
}

async function boundedCrypto<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([operation, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('CREDENTIAL_STORAGE_TIMEOUT')), 15_000);
    })]);
  } finally { clearTimeout(timer); }
}

/** Only opaque references may leave the main-process store. */
export class ConnectionCredentialStore {
  constructor(private readonly directory: string, private readonly encryption: ConnectionEncryption) {}

  private async requireEncryption(): Promise<void> {
    if (!await boundedCrypto(this.encryption.available())) throw new Error('SECURE_STORAGE_UNAVAILABLE');
  }

  async put(value: unknown): Promise<string> {
    if (typeof value !== 'string' || !value.trim() || Buffer.byteLength(value) > 8192) throw new Error('INVALID_CREDENTIAL');
    await this.requireEncryption();
    const encrypted = await boundedCrypto(this.encryption.encrypt(value));
    const ref = randomUUID();
    await atomicConnectionWrite(this.directory, `${ref}.bin`, encrypted);
    return ref;
  }

  async verify(ref: string): Promise<void> {
    if (!isConnectionId(ref)) throw new Error('INVALID_CREDENTIAL_REFERENCE');
    await this.requireEncryption();
    try {
      const encrypted = await readBounded(join(this.directory, `${ref}.bin`), 24 * 1024);
      const value = await boundedCrypto(this.encryption.decrypt(encrypted));
      if (!value.trim() || Buffer.byteLength(value) > 8192) throw new Error('INVALID_CREDENTIAL');
    } catch { throw new Error('CREDENTIAL_UNAVAILABLE'); }
  }

  async remove(ref: string): Promise<void> {
    if (!isConnectionId(ref)) throw new Error('INVALID_CREDENTIAL_REFERENCE');
    await rm(join(this.directory, `${ref}.bin`), { force: true });
  }

  async prune(active: string[]): Promise<void> {
    let directory;
    try { directory = await opendir(this.directory); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
    let count = 0;
    for await (const entry of directory) {
      if (++count > 60) throw new Error('CREDENTIAL_STORAGE_LIMIT');
      const ref = entry.name.endsWith('.bin') ? entry.name.slice(0, -4) : undefined;
      if (isConnectionId(ref) && !active.includes(ref)) await this.remove(ref);
    }
  }
}
