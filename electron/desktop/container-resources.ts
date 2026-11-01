import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

import { canonicalJson, desktopOperationIntentSchema, type DesktopOperationIntent } from '@xopcai/endpoint-tools-protocol';
import { z } from 'zod';

import type { ConnectionEncryption } from '../gateway/credentials.js';
import { atomicConnectionWrite, readBounded } from '../gateway/profiles.js';

const hash = (value: unknown) => createHash('sha256').update(canonicalJson(value)).digest('hex');
const recordSchema = z.strictObject({
  version: z.literal(1), intent: desktopOperationIntentSchema, intentFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  socketPath: z.string().max(4096).refine(isAbsolute), engineId: z.string().min(1).max(128), imageId: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  ownerId: z.uuid(), workspaceId: z.uuid(), argv: z.array(z.string().max(8192).refine(value => !value.includes('\0'))).min(1).max(128),
  phase: z.enum(['prepared', 'created', 'stopped']), containerId: z.string().regex(/^[a-f0-9]{64}$/).optional(),
}).superRefine((record, context) => {
  if (!['desktop.command.run', 'desktop.terminal.open'].includes(record.intent.tool) || record.intent.workspaceId !== record.workspaceId || record.intentFingerprint !== hash(record.intent)
    || !record.argv[0] || Buffer.byteLength(JSON.stringify(record.argv)) > 32768 || record.phase === 'created' && !record.containerId
    || hash({ workspaceId: record.workspaceId, argv: record.argv }) !== record.intent.argumentHash) context.addIssue({ code: 'custom', message: 'Container operation binding is invalid' });
});
export type DesktopContainerResource = z.infer<typeof recordSchema>;
type ResourceLocation = Pick<DesktopContainerResource, 'socketPath' | 'engineId' | 'imageId' | 'ownerId' | 'workspaceId' | 'argv'>;

/** Fixed-user-root encrypted metadata; reading a record never creates, starts or retries a container. */
export class DesktopContainerResources {
  private failed = false;
  constructor(private readonly directory: string, private readonly encryption: ConnectionEncryption) {}
  private async storage<T>(work: () => Promise<T>): Promise<T> {
    if (this.failed) throw new Error('DESKTOP_CONTAINER_STORAGE_RESTART_REQUIRED');
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([work(), new Promise<never>((_, reject) => {
        timer = setTimeout(() => { this.failed = true; reject(new Error('DESKTOP_CONTAINER_STORAGE_TIMEOUT')); }, 15000);
      })]);
    } finally { clearTimeout(timer); }
  }
  async load(input: DesktopOperationIntent): Promise<DesktopContainerResource> {
    const intent = desktopOperationIntentSchema.parse(input);
    return this.storage(async () => {
      if (!await this.encryption.available()) throw new Error('SECURE_STORAGE_UNAVAILABLE');
      const bytes = await readBounded(join(this.directory, `${intent.operationId}.bin`), 65536);
      const record = recordSchema.parse(JSON.parse(await this.encryption.decrypt(bytes)));
      if (record.intentFingerprint !== hash(intent)) throw new Error('DESKTOP_CONTAINER_RESOURCE_IDENTITY_MISMATCH');
      return record;
    });
  }
  private async save(record: DesktopContainerResource) {
    return this.storage(async () => {
      const parsed = recordSchema.parse(record);
      if (!await this.encryption.available()) throw new Error('SECURE_STORAGE_UNAVAILABLE');
      const bytes = await this.encryption.encrypt(JSON.stringify(parsed));
      if (this.failed) throw new Error('DESKTOP_CONTAINER_STORAGE_RESTART_REQUIRED');
      await atomicConnectionWrite(this.directory, `${record.intent.operationId}.bin`, bytes);
      const directory = await open(this.directory, 'r');
      try { await directory.sync(); } finally { await directory.close(); }
    });
  }
  async prepare(input: DesktopOperationIntent, location: ResourceLocation) {
    const intent = desktopOperationIntentSchema.parse(input);
    try { await this.load(intent); throw new Error('DESKTOP_CONTAINER_RESOURCE_ALREADY_EXISTS'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    await this.save(recordSchema.parse({ version: 1, intent, intentFingerprint: hash(intent), ...location, phase: 'prepared' }));
  }
  async created(intent: DesktopOperationIntent, id: string) {
    const record = await this.load(intent);
    if (record.phase === 'stopped' || record.containerId && record.containerId !== id) throw new Error('DESKTOP_CONTAINER_RESOURCE_IDENTITY_MISMATCH');
    record.phase = 'created'; record.containerId = id; await this.save(record);
  }
  async stopped(intent: DesktopOperationIntent) {
    const record = await this.load(intent); record.phase = 'stopped'; await this.save(record);
  }
}
