import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdir, readFile, open } from 'node:fs/promises';
import { join } from 'node:path';

import { resolveStateDir } from '../config/paths.js';

/** Only the pre-sharing phone baseline is persisted; source-device location never enters this store. */
export class LocationBaselineCipher {
  private key?: Promise<Buffer>;
  constructor(private readonly root = join(resolveStateDir(), 'credentials')) {}
  private loadKey() {
    return this.key ??= (async () => {
      await mkdir(this.root, { recursive: true, mode: 0o700 });
      const path = join(this.root, 'phone-location-baseline.key');
      const candidate = randomBytes(32);
      try { const file = await open(path, 'wx', 0o600); try { await file.writeFile(candidate); await file.sync(); } finally { await file.close(); } }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
      finally { candidate.fill(0); }
      const key = await readFile(path);
      if (key.length !== 32) throw new Error('Invalid phone baseline key');
      return key;
    })();
  }
  async seal(value: string, phoneId: string): Promise<string> {
    const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', await this.loadKey(), iv);
    cipher.setAAD(Buffer.from(phoneId));
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64');
  }
  async open(value: string, phoneId: string): Promise<string> {
    const bytes = Buffer.from(value, 'base64');
    if (bytes.length < 29 || bytes.length > 4096) throw new Error('Invalid phone baseline');
    const cipher = createDecipheriv('aes-256-gcm', await this.loadKey(), bytes.subarray(0, 12));
    cipher.setAAD(Buffer.from(phoneId)); cipher.setAuthTag(bytes.subarray(12, 28));
    return Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString('utf8');
  }
}
