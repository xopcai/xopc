import { open, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { desktopExecutionGrantSchema } from '@xopcai/gateway-contract';
import { canonicalJson } from '@xopcai/endpoint-tools-protocol';
import { z } from 'zod';

import type { ConnectionEncryption } from '../gateway/credentials.js';
import { atomicConnectionWrite, readBounded } from '../gateway/profiles.js';
import { desktopBindingSchema } from './device-identity.js';

const recordSchema = z.strictObject({ version: z.literal(1), binding: desktopBindingSchema, transport: z.enum(['ssh', 'direct']),
  deviceId: z.uuid(), grant: desktopExecutionGrantSchema, authorizationRevision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  leaseGeneration: z.uuid(), parentPid: z.number().int().min(2).max(2147483647) });
export type DesktopExecutionGrantRecord = z.infer<typeof recordSchema>;

/** An fsynced barrier before granting execution. Recovery cannot infer stop from grant expiry or revocation. */
export class DesktopExecutionGrantLedger {
  private tail: Promise<unknown> = Promise.resolve();
  private failed = false;
  constructor(private readonly directory: string, private readonly encryption: ConnectionEncryption) {}
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.tail.catch(() => {}).then(async () => {
      if (this.failed) throw new Error('DESKTOP_GRANT_LEDGER_RESTART_REQUIRED');
      let timer: ReturnType<typeof setTimeout> | undefined;
      try { return await Promise.race([work(), new Promise<never>((_, reject) => { timer = setTimeout(() => {
        this.failed = true; reject(new Error('DESKTOP_GRANT_LEDGER_STORAGE_TIMEOUT'));
      }, 15000); })]); } finally { clearTimeout(timer); }
    });
    this.tail = next; return next;
  }
  private async files() {
    let names: string[];
    try { names = await readdir(this.directory); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
    if (names.length > 512 || names.some(name => !/^[a-f0-9-]{36}\.bin$/.test(name) && !/^\.pending-[a-f0-9-]{36}$/.test(name))) throw new Error('DESKTOP_GRANT_LEDGER_LIMIT');
    const files = names.filter(name => !name.startsWith('.pending-')).sort();
    if (files.length > 256) throw new Error('DESKTOP_GRANT_LEDGER_LIMIT');
    return files;
  }
  private async read(file: string) {
    if (!await this.encryption.available()) throw new Error('SECURE_STORAGE_UNAVAILABLE');
    const value = recordSchema.parse(JSON.parse(await this.encryption.decrypt(await readBounded(join(this.directory, file), 32768))));
    if (file !== value.grant.grantId + '.bin') throw new Error('DESKTOP_GRANT_LEDGER_IDENTITY_INVALID');
    return value;
  }
  private async sync() { const directory = await open(this.directory, 'r'); try { await directory.sync(); } finally { await directory.close(); } }
  save(input: DesktopExecutionGrantRecord): Promise<void> {
    const record = recordSchema.parse(input);
    return this.serial(async () => {
      const file = record.grant.grantId + '.bin', files = await this.files();
      if (files.includes(file)) { if (canonicalJson(await this.read(file)) !== canonicalJson(record)) throw new Error('DESKTOP_GRANT_LEDGER_CONFLICT'); return; }
      if (files.length >= 256) throw new Error('DESKTOP_GRANT_LEDGER_LIMIT');
      if (!await this.encryption.available()) throw new Error('SECURE_STORAGE_UNAVAILABLE');
      const bytes = await this.encryption.encrypt(JSON.stringify(record));
      if (this.failed) throw new Error('DESKTOP_GRANT_LEDGER_RESTART_REQUIRED');
      await atomicConnectionWrite(this.directory, file, bytes); await this.sync();
    });
  }
  pending(): Promise<DesktopExecutionGrantRecord[]> {
    return this.serial(async () => { const values: DesktopExecutionGrantRecord[] = []; for (const file of await this.files()) values.push(await this.read(file)); return values; });
  }
  /** Caller must first persist an independently signed stop receipt in the durable outbox. */
  close(input: DesktopExecutionGrantRecord): Promise<void> {
    const record = recordSchema.parse(input);
    return this.serial(async () => {
      const file = record.grant.grantId + '.bin';
      if (canonicalJson(await this.read(file)) !== canonicalJson(record)) throw new Error('DESKTOP_GRANT_LEDGER_CONFLICT');
      await rm(join(this.directory, file)); await this.sync();
    });
  }
}
