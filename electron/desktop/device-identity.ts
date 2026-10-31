import { createHash, createPrivateKey, createPublicKey } from 'node:crypto';
import { join } from 'node:path';

import { z } from 'zod';

import type { ConnectionEncryption } from '../gateway/credentials.js';
import { atomicConnectionWrite, readBounded } from '../gateway/profiles.js';

const desktopOriginSchema = z.string().max(2048).url().refine(value => {
  try {
    const url = new URL(value);
    return value === url.origin && (url.protocol === 'https:'
      || url.protocol === 'http:' && ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname));
  } catch { return false; }
}, 'Desktop binding requires a canonical secure or loopback origin');
export const desktopBindingSchema = z.strictObject({
  profileId: z.uuid(), gatewayId: z.uuid(), origin: desktopOriginSchema, publicKey: z.string().min(80).max(512),
});
export type DesktopBinding = z.infer<typeof desktopBindingSchema>;
const refreshSchema = z.string().regex(/^xopc_rt_[0-9a-f-]{36}_[A-Za-z0-9_-]{43}$/);
export const desktopIdentitySchema = z.strictObject({
  version: z.literal(1), binding: desktopBindingSchema, phase: z.enum(['pending', 'enrolled', 'revoked']),
  privateKey: z.string().min(80).max(4096), displayName: z.string().trim().min(1).max(80),
  requestId: z.uuid(), completionKey: z.uuid(), pairingToken: z.string().max(256), initialRefreshToken: refreshSchema,
  deviceId: z.uuid().optional(), refreshToken: refreshSchema.optional(),
  rotation: z.strictObject({ requestId: z.uuid(), nextRefreshToken: refreshSchema }).optional(),
}).superRefine((record, context) => {
  if (record.phase === 'enrolled' && (!record.deviceId || !record.refreshToken)) context.addIssue({ code: 'custom', message: 'Enrolled desktop identity requires its own device id and refresh credential' });
});
export type DesktopIdentity = z.infer<typeof desktopIdentitySchema>;

/** A single encrypted record commits keys, enrollment intent and refresh rotation together. */
export class DesktopIdentityStore {
  private failed = false;
  constructor(private readonly directory: string, private readonly encryption: ConnectionEncryption) {}
  private key(binding: DesktopBinding): string {
    return createHash('sha256').update(JSON.stringify(desktopBindingSchema.parse(binding))).digest('hex') + '.bin';
  }
  private async encrypted<T>(work: () => Promise<T>): Promise<T> {
    if (this.failed) throw new Error('DESKTOP_IDENTITY_RESTART_REQUIRED');
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([work(), new Promise<never>((_, reject) => {
        timer = setTimeout(() => { this.failed = true; reject(new Error('DESKTOP_IDENTITY_STORAGE_TIMEOUT')); }, 15000);
      })]);
    } finally { clearTimeout(timer); }
  }
  async load(binding: DesktopBinding): Promise<DesktopIdentity | undefined> {
    return this.encrypted(async () => {
      if (!await this.encryption.available()) throw new Error('SECURE_STORAGE_UNAVAILABLE');
      let bytes: Buffer;
      try { bytes = await readBounded(join(this.directory, this.key(binding)), 32768); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
      const record = desktopIdentitySchema.parse(JSON.parse(await this.encryption.decrypt(bytes)));
      if (JSON.stringify(record.binding) !== JSON.stringify(desktopBindingSchema.parse(binding))) throw new Error('DESKTOP_IDENTITY_BINDING_MISMATCH');
      const privateKey = createPrivateKey(record.privateKey);
      if (privateKey.asymmetricKeyType !== 'ec' || privateKey.asymmetricKeyDetails?.namedCurve !== 'prime256v1') throw new Error('DESKTOP_IDENTITY_KEY_INVALID');
      if (createPublicKey(record.binding.publicKey).asymmetricKeyType !== 'ed25519') throw new Error('DESKTOP_GATEWAY_KEY_INVALID');
      return record;
    });
  }
  async save(record: DesktopIdentity): Promise<void> {
    return this.encrypted(async () => {
      const parsed = desktopIdentitySchema.parse(record);
      if (!await this.encryption.available()) throw new Error('SECURE_STORAGE_UNAVAILABLE');
      const bytes = await this.encryption.encrypt(JSON.stringify(parsed));
      if (this.failed) throw new Error('DESKTOP_IDENTITY_RESTART_REQUIRED');
      try { await atomicConnectionWrite(this.directory, this.key(parsed.binding), bytes); }
      catch (error) { this.failed = true; throw error; }
    });
  }
}
