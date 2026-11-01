import { createHash, randomUUID } from 'node:crypto';
import { open, readdir } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

import { z } from 'zod';

import type { ConnectionEncryption } from '../gateway/credentials.js';
import { atomicConnectionWrite, readBounded } from '../gateway/profiles.js';
import { desktopBindingSchema, type DesktopBinding } from './device-identity.js';

const recordSchema = z.strictObject({
  version: z.literal(1), binding: desktopBindingSchema, workspaceId: z.uuid(), ownerId: z.uuid(),
  socketPath: z.string().max(4096).refine(value => isAbsolute(value) && !value.includes('\0')),
  engineId: z.string().min(1).max(128), imageId: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  label: z.string().trim().min(1).max(80), createdAt: z.number().int().positive(),
});
export type DesktopContainerWorkspace = z.infer<typeof recordSchema>;

/** Retained data identity only, never retained permission. Every use still needs a fresh device/native execution grant. */
export class DesktopContainerWorkspaces {
  private failed = false;
  private tail: Promise<unknown> = Promise.resolve();
  constructor(private readonly root: string, private readonly encryption: ConnectionEncryption) {}
  private directory(binding: DesktopBinding) { return join(this.root, createHash('sha256').update(JSON.stringify(desktopBindingSchema.parse(binding))).digest('hex')); }
  private serialized<T>(work: () => Promise<T>): Promise<T> {
    const next = this.tail.catch(() => {}).then(async () => {
      if (this.failed) throw new Error('DESKTOP_CONTAINER_STORAGE_RESTART_REQUIRED');
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([work(), new Promise<never>((_, reject) => { timer = setTimeout(() => { this.failed = true; reject(new Error('DESKTOP_CONTAINER_STORAGE_TIMEOUT')); }, 15000); })]);
      } finally { clearTimeout(timer); }
    });
    this.tail = next; return next;
  }
  private async read(binding: DesktopBinding, workspaceId: string) {
    z.uuid().parse(workspaceId);
    if (!await this.encryption.available()) throw new Error('SECURE_STORAGE_UNAVAILABLE');
    const bytes = await readBounded(join(this.directory(binding), workspaceId + '.bin'), 16384);
    const record = recordSchema.parse(JSON.parse(await this.encryption.decrypt(bytes)));
    if (record.workspaceId !== workspaceId || JSON.stringify(record.binding) !== JSON.stringify(desktopBindingSchema.parse(binding))) throw new Error('DESKTOP_CONTAINER_WORKSPACE_IDENTITY_MISMATCH');
    return record;
  }
  private async names(binding: DesktopBinding) {
    let names: string[];
    try { names = await readdir(this.directory(binding)); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
    const records = names.filter(name => /^[a-f0-9-]{36}\.bin$/.test(name));
    if (names.length > 100 || records.length > 20) throw new Error('DESKTOP_CONTAINER_WORKSPACE_LIMIT');
    return records;
  }
  list(binding: DesktopBinding) {
    return this.serialized(async () => {
      const result = [];
      for (const name of await this.names(binding)) result.push(await this.read(binding, name.slice(0, -4)));
      return result;
    });
  }
  load(binding: DesktopBinding, workspaceId: string) { return this.serialized(() => this.read(binding, workspaceId)); }
  create(binding: DesktopBinding, input: { socketPath: string; engineId: string; imageId: string; label: string }, identity?: { workspaceId: string; ownerId: string }) {
    return this.serialized(async () => {
      if ((await this.names(binding)).length >= 20) throw new Error('DESKTOP_CONTAINER_WORKSPACE_LIMIT');
      const record = recordSchema.parse({ version: 1, binding, workspaceId: identity?.workspaceId ?? randomUUID(), ownerId: identity?.ownerId ?? randomUUID(), createdAt: Date.now(), ...input });
      try { await this.read(binding, record.workspaceId); throw new Error('DESKTOP_CONTAINER_WORKSPACE_ALREADY_RECORDED'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      if (!await this.encryption.available()) throw new Error('SECURE_STORAGE_UNAVAILABLE');
      const bytes = await this.encryption.encrypt(JSON.stringify(record));
      if (this.failed) throw new Error('DESKTOP_CONTAINER_STORAGE_RESTART_REQUIRED');
      const directory = this.directory(record.binding);
      await atomicConnectionWrite(directory, record.workspaceId + '.bin', bytes);
      const parent = await open(directory, 'r'); try { await parent.sync(); } finally { await parent.close(); }
      return record;
    });
  }
}
