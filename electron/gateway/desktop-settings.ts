import { readFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

import { z } from 'zod';

import { writeTextAtomic } from '../../src/infra/write-file-atomic.js';

const schema = z.object({ uiPort: z.number().int().min(1).max(65535).optional(), mode: z.enum(['local', 'remote']), remote: z.object({ origin: z.string(), encryptedCredential: z.string(), identity: z.object({ gatewayId: z.uuid(), publicKey: z.string() }).optional() }).optional() });
export type DesktopGatewaySettingsData = z.infer<typeof schema>;
export function normalizeGatewayOrigin(raw: string): string {
  const url = new URL(raw.trim());
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash
    || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) throw new Error('Use an HTTPS Gateway address, or an HTTP loopback SSH tunnel');
  return url.origin;
}
export class DesktopGatewaySettings {
  constructor(private readonly path: string, private readonly encryption: { encrypt(value: string): Promise<Buffer>; decrypt(value: Buffer): Promise<string> }) {}
  async read(): Promise<DesktopGatewaySettingsData> {
    try { return schema.parse(JSON.parse(await readFile(this.path, 'utf8'))); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { mode: 'local' }; throw error; }
  }
  async write(data: DesktopGatewaySettingsData): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await writeTextAtomic(this.path, JSON.stringify(schema.parse(data)), { mode: 0o600 });
  }
  async remote(data: DesktopGatewaySettingsData): Promise<{ origin: string; token: string }> {
    if (!data.remote) throw new Error('Configure the remote Gateway first');
    return { origin: normalizeGatewayOrigin(data.remote.origin), token: await this.encryption.decrypt(Buffer.from(data.remote.encryptedCredential, 'base64')) };
  }
  async configure(origin: string, credential?: string): Promise<DesktopGatewaySettingsData> {
    const current = await this.read();
    origin = normalizeGatewayOrigin(origin);
    const token = credential?.trim();
    if (token && (token.length > 8192 || /[\r\n]/.test(token))) throw new Error('Invalid Gateway credential');
    if (!token && current.remote?.origin !== origin) throw new Error('Enter the Gateway access token');
    return { uiPort: current.uiPort, mode: 'remote', remote: { origin, encryptedCredential: token ? (await this.encryption.encrypt(token)).toString('base64') : current.remote!.encryptedCredential,
      ...(!token && current.remote?.origin === origin && current.remote.identity ? { identity: current.remote.identity } : {}) } };
  }
}
