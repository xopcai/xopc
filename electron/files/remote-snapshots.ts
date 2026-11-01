import { createHash, randomUUID } from 'node:crypto';
import { open, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { FileResourceSchema, type FileResource } from '@xopcai/gateway-contract';
import { z } from 'zod';

import type { ChatNamespace } from '../chat/state.js';
import type { ConnectionEncryption } from '../gateway/credentials.js';
import { atomicConnectionWrite, readBounded } from '../gateway/profiles.js';

const textSchema = z.string().refine(value => Buffer.byteLength(value, 'utf8') <= 32768 && Buffer.from(value, 'utf8').toString('utf8') === value);
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const recordSchema = z.strictObject({
  version: z.literal(1), id: z.uuid(), namespace: z.string().regex(/^[a-f0-9]{64}$/),
  resource: FileResourceSchema, text: textSchema, baseHash: z.string().regex(/^[a-f0-9]{64}$/),
  state: z.enum(['clean', 'dirty', 'uploading', 'unknown', 'conflict']), attemptId: z.uuid().optional(),
});
export type RemoteFileSnapshot = z.infer<typeof recordSchema>;
export interface RemoteFileTransport {
  read(id: string, signal: AbortSignal): Promise<{ resource: FileResource; text: string; etag: string }>;
  put(id: string, text: string, revision: string, signal: AbortSignal): Promise<{ status: 'conflict' } | { status: 'saved'; resource: FileResource }>;
}

/** Remote-only encrypted draft cache. No arbitrary filesystem paths or replay queue are exposed. */
export class RemoteFileSnapshots {
  private readonly scope: string;
  private readonly directory: string;
  private tail: Promise<unknown> = Promise.resolve();
  private failed = false;
  constructor(private readonly options: {
    root: string; namespace: ChatNamespace; encryption: ConnectionEncryption; transport: RemoteFileTransport;
    current(): boolean;
    confirm(snapshot: RemoteFileSnapshot, signal: AbortSignal): Promise<boolean>;
  }) {
    const namespace = z.strictObject({ profileId: z.uuid(), gatewayId: z.uuid(), publicKey: z.string().min(80).max(512) }).parse(options.namespace);
    this.scope = hash(JSON.stringify(namespace)); this.directory = join(options.root, this.scope);
  }
  private current() {
    if (this.failed) throw new Error('REMOTE_FILE_RESTART_REQUIRED');
    if (!this.options.current()) throw new Error('STALE_CONNECTION_EPOCH');
  }
  private serialize<T>(work: () => Promise<T>): Promise<T> {
    const next = this.tail.catch(() => {}).then(() => { this.current(); return work(); });
    this.tail = next; return next;
  }
  private async storage<T>(work: () => Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([work(), new Promise<never>((_, reject) => {
        timer = setTimeout(() => { this.failed = true; reject(new Error('REMOTE_FILE_STORAGE_TIMEOUT')); }, 15000);
      })]);
    } finally { clearTimeout(timer); }
  }
  private async names(): Promise<string[]> {
    let names: string[];
    try { names = await this.storage(() => readdir(this.directory)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
    const records = names.filter(name => /^[a-f0-9-]{36}\.bin$/.test(name));
    if (names.length > 100 || records.length > 20) throw new Error('REMOTE_FILE_CACHE_LIMIT');
    return records;
  }
  private async save(record: RemoteFileSnapshot): Promise<void> {
    return this.storage(async () => {
      this.current();
      if (!await this.options.encryption.available()) throw new Error('SECURE_STORAGE_UNAVAILABLE');
      const bytes = await this.options.encryption.encrypt(JSON.stringify(recordSchema.parse(record)));
      this.current(); await atomicConnectionWrite(this.directory, record.id + '.bin', bytes);
      const directory = await open(this.directory, 'r');
      try { await directory.sync(); } finally { await directory.close(); }
      this.current();
    });
  }
  private async read(id: unknown): Promise<RemoteFileSnapshot> {
    const uuid = z.uuid().parse(id);
    const record = await this.storage(async () => {
      if (!await this.options.encryption.available()) throw new Error('SECURE_STORAGE_UNAVAILABLE');
      const bytes = await readBounded(join(this.directory, uuid + '.bin'), 256 * 1024);
      return recordSchema.parse(JSON.parse(await this.options.encryption.decrypt(bytes)));
    });
    this.current();
    if (record.id !== uuid || record.namespace !== this.scope) throw new Error('REMOTE_FILE_IDENTITY_MISMATCH');
    if (record.state === 'uploading') { record.state = 'unknown'; await this.save(record); }
    return record;
  }
  list() {
    return this.serialize(async () => {
      const records = [];
      for (const name of await this.names()) {
        const record = await this.read(name.slice(0, -4));
        records.push({ id: record.id, name: record.resource.name, state: record.state });
      }
      this.current(); return records;
    });
  }
  get(id: unknown) { return this.serialize(() => this.read(id)); }
  download(id: unknown) {
    return this.serialize(async () => {
      if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,160}\.[A-Za-z0-9_-]{1,4000}$/.test(id)) throw new Error('REMOTE_FILE_ID_INVALID');
      if ((await this.names()).length >= 20) throw new Error('REMOTE_FILE_CACHE_LIMIT');
      const response = await this.options.transport.read(id, AbortSignal.timeout(10000)); this.current();
      const resource = FileResourceSchema.parse(response.resource), text = textSchema.parse(response.text);
      if (resource.id !== id || resource.kind !== 'file' || resource.size !== Buffer.byteLength(text, 'utf8')
        || response.etag !== resource.revision || !resource.capabilities.includes('edit')) throw new Error('REMOTE_FILE_SNAPSHOT_CHANGED');
      const record: RemoteFileSnapshot = { version: 1, id: randomUUID(), namespace: this.scope, resource, text, baseHash: hash(text), state: 'clean' };
      await this.save(record); return record;
    });
  }
  edit(id: unknown, content: unknown) {
    return this.serialize(async () => {
      const text = textSchema.parse(content), record = await this.read(id);
      if (['uploading', 'unknown'].includes(record.state)) throw new Error('REMOTE_FILE_OUTCOME_UNKNOWN');
      record.text = text; record.state = hash(text) === record.baseHash ? 'clean' : 'dirty';
      await this.save(record); return record;
    });
  }
  upload(id: unknown) {
    return this.serialize(async () => {
      const record = await this.read(id);
      if (record.state !== 'dirty') throw new Error(record.state === 'unknown' ? 'REMOTE_FILE_OUTCOME_UNKNOWN' : 'REMOTE_FILE_NOT_DIRTY');
      const signal = AbortSignal.timeout(60000);
      if (!await this.options.confirm(structuredClone(record), signal)) throw new Error('REMOTE_FILE_USER_DENIED');
      signal.throwIfAborted(); this.current();
      record.state = 'uploading'; record.attemptId = randomUUID(); await this.save(record);
      try {
        const response = await this.options.transport.put(record.resource.id, record.text, record.resource.revision, AbortSignal.timeout(10000));
        this.current();
        if (response.status === 'conflict') record.state = 'conflict';
        else {
          const resource = FileResourceSchema.parse(response.resource);
          if (resource.id !== record.resource.id || resource.kind !== 'file' || resource.size !== Buffer.byteLength(record.text)) throw new Error('REMOTE_FILE_RESPONSE_INVALID');
          record.resource = resource; record.baseHash = hash(record.text); record.state = 'clean';
        }
        await this.save(record); return record;
      } catch {
        // Keep the persisted uploading record on stale identity/storage failure. Recovery converts it to unknown, never a retry.
        record.state = 'unknown';
        try { await this.save(record); } catch { /* The prior durable record remains uncertain. */ }
        throw new Error('REMOTE_FILE_OUTCOME_UNKNOWN');
      }
    });
  }
}
