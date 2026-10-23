import { randomUUID } from 'node:crypto';

import sharp from 'sharp';

import { CloudAdbConnection, parseCloudEndpoint, parseCloudPrivateKey, PhoneCloudKeyStore } from './cloud-adb.js';
import { CloudScrcpyProvider } from './cloud-scrcpy.js';
import { PhoneError, type PhoneDevice } from './contracts.js';
import type { PhoneRepository } from './repository.js';

type Draft = { owner: string; endpoint: string; key: Buffer; expiresAt: number; timer: ReturnType<typeof setTimeout> };
export class CloudPhones {
  private drafts = new Map<string, Draft>();
  private connections = new Map<string, CloudAdbConnection>();
  constructor(private repository: PhoneRepository, private keys = new PhoneCloudKeyStore(),
    private connect = (endpoint: string, key: Buffer) => new CloudAdbConnection(endpoint, key)) {}
  private discard(token: string): void {
    const draft = this.drafts.get(token); if (draft) { clearTimeout(draft.timer); draft.key.fill(0); this.drafts.delete(token); }
  }
  async test(owner: string, address: string, pem: string, signal: AbortSignal) {
    if (this.drafts.size >= 10) throw new PhoneError('PHONE_SETUP_BUSY', 'Too many pending phone connections. Try again later.', 409);
    const { endpoint } = parseCloudEndpoint(address); const key = parseCloudPrivateKey(pem);
    let lease: string;
    try { lease = this.repository.acquire(endpoint); } catch (error) { key.fill(0); throw error; }
    const connection = this.connect(endpoint, Buffer.from(key));
    try {
      const command = (...args: string[]) => connection.command('', ['-s', endpoint, ...args], signal, 20_000);
      const model = (await command('shell', 'getprop', 'ro.product.model')).toString().trim().slice(0, 100);
      const androidVersion = (await command('shell', 'getprop', 'ro.build.version.release')).toString().trim().slice(0, 50);
      const pixels = await command('exec-out', 'screencap', '-p');
      let screenshot: string;
      try { screenshot = `data:image/jpeg;base64,${(await sharp(pixels, { limitInputPixels: 16_000_000 }).resize({ width: 360, withoutEnlargement: true }).jpeg({ quality: 70 }).toBuffer()).toString('base64')}`; }
      finally { pixels.fill(0); }
      signal.throwIfAborted();
      const token = randomUUID(); const expiresAt = Date.now() + 600_000;
      const timer = setTimeout(() => this.discard(token), 600_000); timer.unref();
      this.drafts.set(token, { owner, endpoint, key: Buffer.from(key), expiresAt, timer });
      return { token, expiresAt, model, androidVersion, screenshot, endpoint, media: 'snapshot' as const };
    } finally { key.fill(0); connection.dispose(); this.repository.release(endpoint, lease); }
  }
  async add(owner: string, token: string, name: string, makeDefault: boolean): Promise<PhoneDevice> {
    const draft = this.drafts.get(token);
    if (!draft || draft.owner !== owner || draft.expiresAt < Date.now()) throw new PhoneError('PHONE_SETUP_EXPIRED', 'Connection test expired. Test the connection again.', 409);
    // Consume before awaiting persistence so a token cannot create duplicate credentials.
    this.drafts.delete(token); clearTimeout(draft.timer);
    let credentialId: string | undefined;
    try {
      credentialId = await this.keys.save(draft.key);
      const device = this.repository.save({ serial: draft.endpoint, name, enabled: true, allowedApps: ['com.android.settings'],
        connection: { kind: 'aliyun-adb', endpoint: draft.endpoint, credentialId } });
      if (makeDefault || !this.repository.defaultDevice()) this.repository.setDefault(device.id);
      return device;
    } catch (error) { if (credentialId) await this.keys.remove(credentialId); throw error; }
    finally { draft.key.fill(0); }
  }
  cancel(owner: string, token: string): void { if (this.drafts.get(token)?.owner === owner) this.discard(token); }
  async driver(device: PhoneDevice) {
    const binding = device.connection;
    if (!binding) throw new PhoneError('PHONE_CONNECTION_INVALID', 'Missing cloud connection');
    let connection = this.connections.get(device.id);
    if (!connection) {
      connection = this.connect(binding.endpoint, await this.keys.load(binding.credentialId)); this.connections.set(device.id, connection);
    }
    return connection.driver();
  }
  async interactive(device: PhoneDevice, failed: () => void): Promise<CloudScrcpyProvider> {
    const binding = device.connection;
    if (!binding) throw new PhoneError('PHONE_CONNECTION_INVALID', 'Missing cloud connection');
    return new CloudScrcpyProvider(binding.endpoint, await this.keys.load(binding.credentialId), failed, this.connect);
  }
  disconnect(id: string): void { this.connections.get(id)?.dispose(); this.connections.delete(id); }
  async remove(device: PhoneDevice): Promise<void> { this.disconnect(device.id); if (device.connection) await this.keys.remove(device.connection.credentialId); }
  close(): void { for (const token of this.drafts.keys()) this.discard(token); for (const id of this.connections.keys()) this.disconnect(id); }
}
