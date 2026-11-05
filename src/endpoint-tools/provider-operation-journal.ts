import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, readdir, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';

import type { ProviderOperationJournal } from '@xopcai/endpoint-tools-client';
import { canonicalJson, providerOperationIntentSchema, providerOperationReceiptSchema, type ProviderOperationIntent, type ProviderOperationReceipt } from '@xopcai/endpoint-tools-protocol';
import { z } from 'zod';

/** Private per-host evidence. Store identity and digests, never arguments, results or credentials. */
export class FileProviderOperationJournal implements ProviderOperationJournal {
  private readonly active = new Map<string, string>();
  private initialized?: Promise<void>;
  private count = 0;

  constructor(private readonly directory: string, private readonly limit = 10_000) {}

  async begin(raw: ProviderOperationIntent): Promise<'started' | 'exists'> {
    const intent = providerOperationIntentSchema.parse(raw);
    await this.initialize();
    if (this.count >= this.limit) throw new Error('Device operation journal is full');
    const path = this.path(intent.operationId);
    let file: Awaited<ReturnType<typeof open>>;
    this.count += 1;
    try { file = await open(path, 'wx', 0o600); }
    catch (error) {
      this.count -= 1;
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const recorded = await this.read(intent.operationId);
      if (!recorded || canonicalJson(recorded.intent) !== canonicalJson(intent)) throw new Error('Device operation identity conflicts');
      return 'exists';
    }
    try { await file.writeFile(JSON.stringify({ intent, state: 'running', updatedAt: Date.now() })); await file.sync(); }
    finally { await file.close(); }
    await this.syncDirectory();
    this.active.set(intent.operationId, canonicalJson(intent));
    return 'started';
  }

  async finish(intent: ProviderOperationIntent, resultDigest?: string): Promise<ProviderOperationReceipt> {
    if (this.active.get(intent.operationId) !== canonicalJson(intent)) throw new Error('Device operation is not running under this intent');
    const receipt = providerOperationReceiptSchema.parse({ intent, state: resultDigest ? 'succeeded' : 'unknown', resultDigest, updatedAt: Date.now() });
    const path = this.path(intent.operationId), temporary = join(this.directory, `${randomUUID()}.tmp`);
    try {
      const file = await open(temporary, 'wx', 0o600);
      try { await file.writeFile(JSON.stringify(receipt)); await file.sync(); } finally { await file.close(); }
      await rename(temporary, path); await this.syncDirectory();
      return receipt;
    } finally { this.active.delete(intent.operationId); await unlink(temporary).catch(() => {}); }
  }

  async status(operationId: string): Promise<ProviderOperationReceipt | undefined> {
    const receipt = await this.read(operationId);
    return receipt?.state === 'running' && !this.active.has(operationId) ? { ...receipt, state: 'unknown' } : receipt;
  }

  private initialize(): Promise<void> {
    return this.initialized ??= (async () => {
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      this.count = (await readdir(this.directory)).filter(name => name.endsWith('.json')).length;
    })();
  }

  private path(operationId: string): string { return join(this.directory, `${z.uuid().parse(operationId)}.json`); }

  private async read(operationId: string): Promise<ProviderOperationReceipt | undefined> {
    try { return providerOperationReceiptSchema.parse(JSON.parse(await readFile(this.path(operationId), 'utf8'))); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
  }

  private async syncDirectory(): Promise<void> {
    if (process.platform === 'win32') return;
    const directory = await open(this.directory, 'r');
    try { await directory.sync(); } finally { await directory.close(); }
  }
}
