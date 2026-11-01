import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

import { canonicalJson, desktopOperationIntentSchema, type DesktopOperationIntent } from '@xopcai/endpoint-tools-protocol';
import { z } from 'zod';

import type { ConnectionEncryption } from '../gateway/credentials.js';
import { atomicConnectionWrite, readBounded } from '../gateway/profiles.js';

const hash = (value: unknown) => createHash('sha256').update(canonicalJson(value)).digest('hex');
const contextSchema = z.strictObject({
  version: z.literal(1), intentFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  root: z.strictObject({ path: z.string().max(32768).refine(value => isAbsolute(value) && !value.includes('\0')),
    device: z.string().regex(/^\d+$/), inode: z.string().regex(/^\d+$/) }),
  workspaceId: z.uuid(), relativePath: z.string().min(1).max(4096),
  expectedVersion: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
});
export type DesktopWorkspaceRecoveryContext = z.infer<typeof contextSchema>;

/** Main-only encrypted location metadata. It never contains file contents, reopens a directory or grants execution authority. */
export class DesktopWorkspaceRecoveryStore {
  private failed = false;
  constructor(private readonly directory: string, private readonly encryption: ConnectionEncryption) {}
  private async bounded<T>(work: () => Promise<T>): Promise<T> {
    if (this.failed) throw new Error('WORKSPACE_RECOVERY_RESTART_REQUIRED');
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([work(), new Promise<never>((_, reject) => {
        timer = setTimeout(() => { this.failed = true; reject(new Error('WORKSPACE_RECOVERY_STORAGE_TIMEOUT')); }, 15000);
      })]);
    } finally { clearTimeout(timer); }
  }
  private path(intent: DesktopOperationIntent) { return join(this.directory, `${intent.operationId}.bin`); }
  async load(input: DesktopOperationIntent): Promise<DesktopWorkspaceRecoveryContext> {
    const intent = desktopOperationIntentSchema.parse(input);
    return this.bounded(async () => {
      if (!await this.encryption.available()) throw new Error('SECURE_STORAGE_UNAVAILABLE');
      try {
        const record = contextSchema.parse(JSON.parse(await this.encryption.decrypt(await readBounded(this.path(intent), 65536))));
        if (record.intentFingerprint !== hash(intent) || record.workspaceId !== intent.workspaceId || intent.tool !== 'desktop.workspace.write') throw new Error('WORKSPACE_RECOVERY_IDENTITY_MISMATCH');
        return record;
      } catch { throw new Error('WORKSPACE_RECOVERY_CONTEXT_UNAVAILABLE'); }
    });
  }
  async save(input: DesktopOperationIntent, args: Record<string, unknown>, root: DesktopWorkspaceRecoveryContext['root']): Promise<void> {
    const intent = desktopOperationIntentSchema.parse(input);
    if (intent.tool !== 'desktop.workspace.write' || intent.workspaceId !== args.workspaceId || intent.argumentHash !== hash(args)) throw new Error('WORKSPACE_RECOVERY_IDENTITY_MISMATCH');
    const record = contextSchema.parse({ version: 1, intentFingerprint: hash(intent), root, workspaceId: intent.workspaceId,
      relativePath: args.relativePath, expectedVersion: args.expectedVersion });
    return this.bounded(async () => {
      if (!await this.encryption.available()) throw new Error('SECURE_STORAGE_UNAVAILABLE');
      const bytes = await this.encryption.encrypt(JSON.stringify(record));
      if (this.failed) throw new Error('WORKSPACE_RECOVERY_RESTART_REQUIRED');
      await atomicConnectionWrite(this.directory, `${intent.operationId}.bin`, bytes);
      // The directory entry must survive a crash before a file effect can begin.
      const directory = await open(this.directory, 'r');
      try { await directory.sync(); } finally { await directory.close(); }
    });
  }
}
