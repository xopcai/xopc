import { readdir, rm, open } from 'node:fs/promises';
import { join } from 'node:path';

import { signedDesktopExecutionStopSchema, type SignedDesktopExecutionStop } from '@xopcai/gateway-contract';
import { canonicalJson } from '@xopcai/endpoint-tools-protocol';
import { z } from 'zod';

import type { ConnectionEncryption } from '../gateway/credentials.js';
import { atomicConnectionWrite, readBounded } from '../gateway/profiles.js';
import { desktopBindingSchema, type DesktopBinding } from './device-identity.js';
import type { DesktopDeviceAuth } from './device-auth.js';

const recordSchema = z.strictObject({ version: z.literal(1), binding: desktopBindingSchema, signed: signedDesktopExecutionStopSchema })
  .refine(value => value.binding.gatewayId === value.signed.receipt.gatewayId);

/** Stop-only durable outbox, independent of access tokens and current enrollment. Confirmed receipts are audited on the Gateway. */
export class DesktopExecutionStopOutbox {
  private tail: Promise<unknown> = Promise.resolve();
  private failed = false;
  constructor(private readonly directory: string, private readonly encryption: ConnectionEncryption) {}
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.tail.catch(() => {}).then(async () => {
      if (this.failed) throw new Error('DESKTOP_STOP_OUTBOX_RESTART_REQUIRED');
      let timer: ReturnType<typeof setTimeout> | undefined;
      try { return await Promise.race([work(), new Promise<never>((_, reject) => { timer = setTimeout(() => {
        this.failed = true; reject(new Error('DESKTOP_STOP_OUTBOX_STORAGE_TIMEOUT'));
      }, 15000); })]); } finally { clearTimeout(timer); }
    });
    this.tail = next; return next;
  }
  private async listFiles(): Promise<string[]> {
    let files: string[];
    try { files = await readdir(this.directory); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
    if (files.length > 512 || files.some(file => !/^[a-f0-9-]{36}\.bin$/.test(file) && !/^\.pending-[a-f0-9-]{36}$/.test(file))) throw new Error('DESKTOP_STOP_OUTBOX_LIMIT');
    const committed = files.filter(file => !file.startsWith('.pending-'));
    if (committed.length > 256) throw new Error('DESKTOP_STOP_OUTBOX_LIMIT');
    return committed.sort();
  }
  private async read(file: string) {
    if (!await this.encryption.available()) throw new Error('SECURE_STORAGE_UNAVAILABLE');
    const value = recordSchema.parse(JSON.parse(await this.encryption.decrypt(await readBounded(join(this.directory, file), 16384))));
    if (file !== value.signed.receipt.stopId + '.bin') throw new Error('DESKTOP_STOP_OUTBOX_IDENTITY_INVALID');
    return value;
  }
  private async sync() { const directory = await open(this.directory, 'r'); try { await directory.sync(); } finally { await directory.close(); } }
  async save(binding: DesktopBinding, signed: SignedDesktopExecutionStop): Promise<void> {
    const record = recordSchema.parse({ version: 1, binding, signed });
    return this.serial(async () => {
      const file = record.signed.receipt.stopId + '.bin', files = await this.listFiles();
      if (files.includes(file)) { if (canonicalJson(await this.read(file)) !== canonicalJson(record)) throw new Error('DESKTOP_STOP_OUTBOX_CONFLICT'); return; }
      if (files.length >= 256) throw new Error('DESKTOP_STOP_OUTBOX_LIMIT');
      if (!await this.encryption.available()) throw new Error('SECURE_STORAGE_UNAVAILABLE');
      const bytes = await this.encryption.encrypt(JSON.stringify(record));
      if (this.failed) throw new Error('DESKTOP_STOP_OUTBOX_RESTART_REQUIRED');
      await atomicConnectionWrite(this.directory, file, bytes); await this.sync();
    });
  }
  pending(binding: DesktopBinding): Promise<SignedDesktopExecutionStop[]> {
    const current = desktopBindingSchema.parse(binding);
    return this.serial(async () => {
      const values: SignedDesktopExecutionStop[] = [];
      for (const file of await this.listFiles()) {
        const record = await this.read(file);
        if (record.binding.gatewayId === current.gatewayId && record.binding.publicKey === current.publicKey) values.push(record.signed);
      }
      return values;
    });
  }
  confirm(input: SignedDesktopExecutionStop): Promise<void> {
    const signed = signedDesktopExecutionStopSchema.parse(input), file = signed.receipt.stopId + '.bin';
    return this.serial(async () => {
      const record = await this.read(file);
      if (canonicalJson(record.signed) !== canonicalJson(signed)) throw new Error('DESKTOP_STOP_OUTBOX_CONFLICT');
      await rm(join(this.directory, file)); await this.sync();
    });
  }
  async flush(binding: DesktopBinding, client: DesktopDeviceAuth): Promise<{ confirmed: number; pending: number }> {
    const values = await this.pending(binding); let confirmed = 0;
    for (const signed of values.slice(0, 8)) {
      try { await client.submitExecutionStop(signed, AbortSignal.timeout(5000)); }
      catch { continue; }
      await this.confirm(signed); confirmed++;
    }
    return { confirmed, pending: values.length - confirmed };
  }
}
