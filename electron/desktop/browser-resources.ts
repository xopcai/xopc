import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';
import { join } from 'node:path';

import { REMOTE_BROWSER_CONTROL_TOOL } from '@xopcai/browser-control-contract/remote';
import { canonicalJson, desktopOperationIntentSchema, type DesktopOperationIntent } from '@xopcai/endpoint-tools-protocol';
import { z } from 'zod';

import type { ConnectionEncryption } from '../gateway/credentials.js';
import { atomicConnectionWrite, readBounded } from '../gateway/profiles.js';

const fingerprint = (intent: DesktopOperationIntent) => createHash('sha256').update(canonicalJson(intent)).digest('hex');
const pid = z.number().int().min(2).max(2147483647);
const recordSchema = z.strictObject({ version: z.literal(1), intent: desktopOperationIntentSchema,
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/), parentPid: pid, phase: z.enum(['preparing', 'ready']),
  workerGroup: pid.optional(), generation: z.uuid().optional(),
}).refine(value => value.intent.tool === REMOTE_BROWSER_CONTROL_TOOL && !value.intent.workspaceId
  && value.fingerprint === fingerprint(value.intent) && value.workerGroup !== value.parentPid
  && (value.phase === 'ready' ? Boolean(value.workerGroup && value.generation) : value.workerGroup === undefined && value.generation === undefined));
const exists = (value: number) => { try { process.kill(value, 0); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false; throw error; } };

/** Only immutable recovery identities. Never stores page text, credentials, DOM refs or screenshots. */
export class DesktopBrowserResources {
  private tail: Promise<unknown> = Promise.resolve();
  private failed = false;
  constructor(private readonly directory: string, private readonly encryption: ConnectionEncryption,
    private readonly processExists: (pid: number) => boolean = exists) {}
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.tail.catch(() => {}).then(async () => {
      if (this.failed) throw new Error('DESKTOP_BROWSER_STORAGE_RESTART_REQUIRED');
      let timer: ReturnType<typeof setTimeout> | undefined;
      try { return await Promise.race([work(), new Promise<never>((_, reject) => { timer = setTimeout(() => {
        this.failed = true; reject(new Error('DESKTOP_BROWSER_STORAGE_TIMEOUT'));
      }, 15000); })]); } finally { clearTimeout(timer); }
    });
    this.tail = next; return next;
  }
  private async read(intent: DesktopOperationIntent) {
    if (!await this.encryption.available()) throw new Error('SECURE_STORAGE_UNAVAILABLE');
    const record = recordSchema.parse(JSON.parse(await this.encryption.decrypt(await readBounded(join(this.directory, intent.operationId + '.bin'), 16384))));
    if (record.fingerprint !== fingerprint(intent)) throw new Error('DESKTOP_BROWSER_RESOURCE_IDENTITY_MISMATCH');
    return record;
  }
  private async write(input: z.infer<typeof recordSchema>) {
    const record = recordSchema.parse(input);
    if (!await this.encryption.available()) throw new Error('SECURE_STORAGE_UNAVAILABLE');
    const bytes = await this.encryption.encrypt(JSON.stringify(record));
    if (this.failed) throw new Error('DESKTOP_BROWSER_STORAGE_RESTART_REQUIRED');
    await atomicConnectionWrite(this.directory, record.intent.operationId + '.bin', bytes);
    const directory = await open(this.directory, 'r'); try { await directory.sync(); } finally { await directory.close(); }
  }
  begin(raw: DesktopOperationIntent) {
    const intent = desktopOperationIntentSchema.parse(raw);
    return this.serial(async () => {
      try { await this.read(intent); throw new Error('DESKTOP_BROWSER_RESOURCE_ALREADY_EXISTS'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      await this.write({ version: 1, intent, fingerprint: fingerprint(intent), parentPid: process.pid, phase: 'preparing' });
    });
  }
  ready(raw: DesktopOperationIntent, identity: { workerGroup: number; generation: string }) {
    const intent = desktopOperationIntentSchema.parse(raw);
    pid.parse(identity.workerGroup); z.uuid().parse(identity.generation);
    return this.serial(async () => {
      const record = await this.read(intent);
      if (record.parentPid !== process.pid || record.phase !== 'preparing') throw new Error('DESKTOP_BROWSER_RESOURCE_ALREADY_EXISTS');
      await this.write({ ...record, phase: 'ready', ...identity });
    });
  }
  recoverAfterParentExit(raw: DesktopOperationIntent) {
    const intent = desktopOperationIntentSchema.parse(raw);
    return this.serial(async () => { const record = await this.read(intent);
      return !this.processExists(record.parentPid) && (record.phase === 'preparing' || !this.processExists(-record.workerGroup!));
    });
  }
}
