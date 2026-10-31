import { createHash } from 'node:crypto';
import { open, opendir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { z } from 'zod';

import type { ConnectionEncryption } from '../gateway/credentials.js';
import { atomicConnectionWrite, readBounded, type RemoteProfile } from '../gateway/profiles.js';

const uuid = z.string().uuid();
export const chatStateSchema = z.strictObject({
  version: z.literal(1), selected: uuid.optional(),
  drafts: z.record(uuid, z.string().max(8192)).refine(value => Object.keys(value).length <= 20),
  pending: z.strictObject({ conversationId: uuid, clientMessageId: uuid, createdAt: z.number().int().nonnegative() }).optional(),
});
export type ChatState = z.infer<typeof chatStateSchema>;
export type ChatNamespace = { profileId: string; gatewayId: string; publicKey: string };
const empty = (): ChatState => ({ version: 1, drafts: {} });
const fileName = (scope: ChatNamespace) => {
  uuid.parse(scope.profileId); uuid.parse(scope.gatewayId);
  return `${scope.profileId}-${createHash('sha256').update(`${scope.gatewayId}\0${scope.publicKey}`).digest('hex')}.bin`;
};

/** Encrypted UI recovery hints only; never a local transcript or a replay queue. */
export class RemoteChatStateStore {
  private failed = false;
  constructor(private readonly directory: string, private readonly encryption: ConnectionEncryption) {}
  private async bounded<T>(operation: () => Promise<T>): Promise<T> {
    if (this.failed) throw new Error('CHAT_STATE_RESTART_REQUIRED');
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([operation(), new Promise<never>((_, reject) => {
        timer = setTimeout(() => { this.failed = true; reject(new Error('CHAT_STATE_RESTART_REQUIRED')); }, 15_000);
      })]);
    } catch { throw new Error(this.failed ? 'CHAT_STATE_RESTART_REQUIRED' : 'CHAT_STATE_UNAVAILABLE'); }
    finally { clearTimeout(timer); }
  }
  read(scope: ChatNamespace): Promise<ChatState> {
    return this.bounded(async () => {
      let data: Buffer;
      try { data = await readBounded(join(this.directory, fileName(scope)), 512 * 1024); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return empty(); throw error; }
      if (!await this.encryption.available()) throw new Error();
      const envelope = JSON.parse(await this.encryption.decrypt(data));
      if (envelope.namespace !== fileName(scope)) throw new Error();
      return chatStateSchema.parse(envelope.state);
    });
  }
  write(scope: ChatNamespace, value: unknown): Promise<ChatState> {
    return this.bounded(async () => {
      const state = chatStateSchema.parse(value);
      const text = JSON.stringify({ namespace: fileName(scope), state });
      if (Buffer.byteLength(text) > 256 * 1024 || !await this.encryption.available()) throw new Error();
      const data = await this.encryption.encrypt(text);
      if (this.failed) throw new Error();
      await atomicConnectionWrite(this.directory, fileName(scope), data);
      for (const directory of [this.directory, dirname(this.directory)]) {
        const handle = await open(directory, 'r');
        try { await handle.sync(); } finally { await handle.close(); }
      }
      return state;
    });
  }
  prune(profiles: readonly RemoteProfile[]): Promise<void> {
    return this.bounded(async () => {
      const allowed = new Set(profiles.flatMap(profile => profile.identity ? [fileName({ profileId: profile.id, ...profile.identity })] : []));
      let entries;
      try { entries = await opendir(this.directory); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
      let count = 0;
      for await (const entry of entries) {
        if (++count > 60) throw new Error();
        if (/^[0-9a-f-]{36}-[0-9a-f]{64}\.bin$/.test(entry.name) && !allowed.has(entry.name)) await rm(join(this.directory, entry.name));
      }
    });
  }
}
