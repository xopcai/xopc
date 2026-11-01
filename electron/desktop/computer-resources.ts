import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';
import { join } from 'node:path';

import { REMOTE_COMPUTER_CONTROL_TOOL } from '@xopcai/computer-control-contract';
import { canonicalJson, desktopOperationIntentSchema, type DesktopOperationIntent } from '@xopcai/endpoint-tools-protocol';
import { z } from 'zod';

import type { ConnectionEncryption } from '../gateway/credentials.js';
import { atomicConnectionWrite, readBounded } from '../gateway/profiles.js';

const hash = (input: unknown) => createHash('sha256').update(canonicalJson(input)).digest('hex');
const pid = z.number().int().min(2).max(2147483647);
const identitySchema = z.strictObject({ driverPid: pid, generation: z.string().min(1).max(256).regex(/^[A-Za-z0-9:_-]+$/) });
const resourceSchema = z.strictObject({ version: z.literal(1), intent: desktopOperationIntentSchema,
  intentFingerprint: z.string().regex(/^[a-f0-9]{64}$/), parentPid: pid,
  phase: z.enum(['preparing', 'ready']), driver: identitySchema.optional(),
}).refine(value => value.intent.tool === REMOTE_COMPUTER_CONTROL_TOOL && !value.intent.workspaceId
  && value.intentFingerprint === hash(value.intent) && (value.phase === 'ready') === Boolean(value.driver)
  && value.parentPid !== value.driver?.driverPid, 'Computer resource binding is invalid');

function processExists(processId: number): boolean {
  try { process.kill(processId, 0); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false; throw error; }
}

/** Main-owned immutable locator only. No screenshot, action text, private socket or process-kill API is persisted. */
export class DesktopComputerResources {
  private failed = false;
  private tail: Promise<unknown> = Promise.resolve();
  constructor(private readonly directory: string, private readonly encryption: ConnectionEncryption,
    private readonly exists: (pid: number) => boolean = processExists) {}
  private serialized<T>(work: () => Promise<T>): Promise<T> {
    const next = this.tail.catch(() => {}).then(async () => {
      if (this.failed) throw new Error('DESKTOP_COMPUTER_STORAGE_RESTART_REQUIRED');
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try { return await Promise.race([work(), new Promise<never>((_, reject) => {
        timeout = setTimeout(() => { this.failed = true; reject(new Error('DESKTOP_COMPUTER_STORAGE_TIMEOUT')); }, 15000);
      })]); } finally { clearTimeout(timeout); }
    });
    this.tail = next; return next;
  }
  private async read(intent: DesktopOperationIntent) {
    if (!await this.encryption.available()) throw new Error('SECURE_STORAGE_UNAVAILABLE');
    const bytes = await readBounded(join(this.directory, intent.operationId + '.bin'), 16384);
    const record = resourceSchema.parse(JSON.parse(await this.encryption.decrypt(bytes)));
    if (record.intentFingerprint !== hash(intent)) throw new Error('DESKTOP_COMPUTER_RESOURCE_IDENTITY_MISMATCH');
    return record;
  }
  load(input: DesktopOperationIntent) {
    const intent = desktopOperationIntentSchema.parse(input);
    return this.serialized(() => this.read(intent));
  }
  private async write(record: z.infer<typeof resourceSchema>) {
    const parsed = resourceSchema.parse(record);
    if (!await this.encryption.available()) throw new Error('SECURE_STORAGE_UNAVAILABLE');
    const bytes = await this.encryption.encrypt(JSON.stringify(parsed));
    if (this.failed) throw new Error('DESKTOP_COMPUTER_STORAGE_RESTART_REQUIRED');
    await atomicConnectionWrite(this.directory, record.intent.operationId + '.bin', bytes);
    const directory = await open(this.directory, 'r');
    try { await directory.sync(); } finally { await directory.close(); }
  }
  /** Commit before warming up the private daemon. No application discovery, preparation or input is allowed yet. */
  begin(input: DesktopOperationIntent) {
    const intent = desktopOperationIntentSchema.parse(input);
    const record = resourceSchema.parse({ version: 1, intent, intentFingerprint: hash(intent), parentPid: process.pid, phase: 'preparing' });
    return this.serialized(async () => {
      try { await this.read(intent); throw new Error('DESKTOP_COMPUTER_RESOURCE_ALREADY_EXISTS'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      await this.write(record);
    });
  }
  /** This fsynced transition is the mandatory barrier before ComputerBroker.command. */
  ready(input: DesktopOperationIntent, driver: z.infer<typeof identitySchema>) {
    const intent = desktopOperationIntentSchema.parse(input), identity = identitySchema.parse(driver);
    return this.serialized(async () => {
      const record = await this.read(intent);
      if (record.phase !== 'preparing' || record.parentPid !== process.pid) throw new Error('DESKTOP_COMPUTER_RESOURCE_ALREADY_EXISTS');
      await this.write(resourceSchema.parse({ ...record, phase: 'ready', driver: identity }));
    });
  }
  prepare(input: DesktopOperationIntent, driver: z.infer<typeof identitySchema>) {
    identitySchema.parse(driver);
    return this.begin(input).then(() => this.ready(input, driver));
  }
  /** Parent and daemon must both be absent. An alive or reused PID always keeps the operation quarantined. */
  recoverAfterParentExit(input: DesktopOperationIntent): Promise<boolean> {
    const intent = desktopOperationIntentSchema.parse(input);
    return this.serialized(async () => {
      const record = await this.read(intent);
      // A dead parent cannot pass the ready barrier or enqueue native commands later.
      return !this.exists(record.parentPid) && (record.phase === 'preparing' || !!record.driver && !this.exists(record.driver.driverPid));
    });
  }
}
