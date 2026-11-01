import { randomUUID } from 'node:crypto';
import { mkdir, open, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';

export type RemoteProfile = Readonly<{
  id: string;
  name: string;
  mode: 'remote';
  origin: string;
  transport: 'direct' | 'ssh';
  credentialRef?: string;
}>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const isConnectionId = (value: unknown): value is string => typeof value === 'string' && UUID.test(value);

export function parseRemoteProfile(value: unknown): RemoteProfile {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_PROFILE');
  const p = value as Record<string, unknown>;
  if (Object.keys(p).some(key => !['id', 'name', 'mode', 'origin', 'transport', 'credentialRef'].includes(key))
    || !isConnectionId(p.id) || p.mode !== 'remote' || typeof p.name !== 'string'
    || !p.name.trim() || p.name.length > 80 || /[\x00-\x1f\x7f]/.test(p.name)
    || typeof p.origin !== 'string' || p.origin.length > 2048
    || !['direct', 'ssh'].includes(p.transport as string)
    || (p.credentialRef !== undefined && !isConnectionId(p.credentialRef))) throw new Error('INVALID_PROFILE');
  let url: URL;
  try { url = new URL(p.origin); } catch { throw new Error('INVALID_ORIGIN'); }
  if (p.origin !== url.origin && p.origin !== `${url.origin}/`) throw new Error('ORIGIN_ONLY_REQUIRED');
  if (p.transport === 'direct' ? url.protocol !== 'https:'
    : url.protocol !== 'http:' || !['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname)) {
    throw new Error('SECURE_REMOTE_ORIGIN_REQUIRED');
  }
  return Object.freeze({ id: p.id, name: p.name.trim(), mode: 'remote', origin: url.origin,
    transport: p.transport as RemoteProfile['transport'], ...(p.credentialRef ? { credentialRef: p.credentialRef as string } : {}) });
}

export async function readBounded(path: string, maximum: number): Promise<Buffer> {
  const file = await open(path, 'r');
  try {
    const buffer = Buffer.alloc(maximum + 1);
    let size = 0;
    while (size < buffer.length) {
      const { bytesRead } = await file.read(buffer, size, buffer.length - size);
      if (!bytesRead) break;
      size += bytesRead;
    }
    if (size > maximum) throw new Error('CONNECTION_STORAGE_TOO_LARGE');
    return buffer.subarray(0, size);
  } finally { await file.close(); }
}

export async function atomicConnectionWrite(directory: string, name: string, data: string | Buffer): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = join(directory, `.pending-${randomUUID()}`);
  try {
    const file = await open(temporary, 'wx', 0o600);
    try { await file.writeFile(data); await file.sync(); }
    finally { await file.close(); }
    await rename(temporary, join(directory, name));
  }
  finally { await rm(temporary, { force: true }); }
}

/** Dedicated Electron state; never read or migrate the local Gateway config. */
export class ConnectionProfileStore {
  constructor(private readonly directory: string) {}

  async load(): Promise<RemoteProfile[]> {
    let raw: Buffer;
    try { raw = await readBounded(join(this.directory, 'profiles.json'), 128 * 1024); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
    const body = JSON.parse(raw.toString('utf8'));
    if (!body || body.version !== 1 || Object.keys(body).some(key => !['version', 'profiles'].includes(key))
      || !Array.isArray(body.profiles) || body.profiles.length > 20) throw new Error('INVALID_PROFILE_STORE');
    const profiles = body.profiles.map(parseRemoteProfile);
    if (new Set(profiles.map(p => p.id)).size !== profiles.length) throw new Error('DUPLICATE_PROFILE');
    return profiles;
  }

  async save(profiles: RemoteProfile[]): Promise<void> {
    if (profiles.length > 20) throw new Error('PROFILE_LIMIT');
    const data = profiles.map(parseRemoteProfile);
    await atomicConnectionWrite(this.directory, 'profiles.json', `${JSON.stringify({ version: 1, profiles: data })}\n`);
  }
}
