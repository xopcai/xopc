import crypto from 'node:crypto';
import { mkdir, open, readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { ExecutionCommand } from '@xopcai/realtime-protocol';

type Receipt = {
  fingerprint: string;
  result: unknown;
  completedAt: number;
};

type InFlight = {
  fingerprint: string;
  promise: Promise<unknown>;
};

const RECEIPT_RETENTION_MS = 7 * 24 * 60 * 60_000;
const PRUNE_INTERVAL_MS = 60 * 60_000;

function commandFingerprint(command: ExecutionCommand): string {
  return crypto.createHash('sha256').update(JSON.stringify({
    environmentId: command.environmentId,
    bindingEpoch: command.bindingEpoch,
    command: command.command,
    payload: command.payload,
  })).digest('hex');
}

function receiptName(idempotencyKey: string): string {
  return crypto.createHash('sha256').update(idempotencyKey).digest('hex');
}

async function readJson<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

export class ExecutionHostOperationJournal {
  private readonly inFlight = new Map<string, InFlight>();
  private readonly root: string;
  private lastPrunedAt = 0;

  constructor(stateDir: string) {
    this.root = join(stateDir, 'operations');
  }

  run(
    command: ExecutionCommand,
    execute: () => Promise<unknown>,
    options: { recoverAfterCrash: boolean },
  ): Promise<unknown> {
    const key = receiptName(command.idempotencyKey);
    const fingerprint = commandFingerprint(command);
    const running = this.inFlight.get(key);
    if (running) {
      return running.fingerprint === fingerprint
        ? running.promise
        : Promise.reject(new Error('Idempotency key is already used by a different execution command'));
    }
    const promise = this.runPersisted(key, fingerprint, execute, options)
      .finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, { fingerprint, promise });
    return promise;
  }

  private async runPersisted(
    key: string,
    fingerprint: string,
    execute: () => Promise<unknown>,
    options: { recoverAfterCrash: boolean },
  ): Promise<unknown> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    await this.pruneReceipts();
    const receiptPath = join(this.root, `${key}.result.json`);
    const pendingPath = join(this.root, `${key}.pending.json`);
    const receipt = await readJson<Receipt>(receiptPath);
    if (receipt) {
      if (receipt.fingerprint !== fingerprint) {
        throw new Error('Idempotency key was already used by a different execution command');
      }
      return receipt.result;
    }

    try {
      const pending = await open(pendingPath, 'wx', 0o600);
      try {
        await pending.writeFile(`${JSON.stringify({ fingerprint, startedAt: Date.now() })}\n`);
      } finally {
        await pending.close();
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const pending = await readJson<{ fingerprint?: string }>(pendingPath);
      if (pending?.fingerprint !== fingerprint) {
        throw new Error('Idempotency key has an incompatible unfinished command');
      }
      if (!options.recoverAfterCrash) {
        throw Object.assign(new Error('Execution outcome is indeterminate after an interrupted host process'), {
          code: 'INDETERMINATE_OPERATION',
        });
      }
      await unlink(pendingPath);
      const replacement = await open(pendingPath, 'wx', 0o600);
      try {
        await replacement.writeFile(`${JSON.stringify({ fingerprint, startedAt: Date.now(), recovered: true })}\n`);
      } finally {
        await replacement.close();
      }
    }

    try {
      const result = await execute();
      const temporary = `${receiptPath}.${crypto.randomUUID()}.tmp`;
      const record: Receipt = { fingerprint, result: result ?? null, completedAt: Date.now() };
      await writeFile(temporary, `${JSON.stringify(record)}\n`, { mode: 0o600, flag: 'wx' });
      await rename(temporary, receiptPath);
      await unlink(pendingPath).catch(() => undefined);
      return result;
    } catch (error) {
      await unlink(pendingPath).catch(() => undefined);
      throw error;
    }
  }

  private async pruneReceipts(now = Date.now()): Promise<void> {
    if (now - this.lastPrunedAt < PRUNE_INTERVAL_MS) return;
    this.lastPrunedAt = now;
    const names = await readdir(this.root);
    await Promise.all(names
      .filter((name) => name.endsWith('.result.json'))
      .map(async (name) => {
        const path = join(this.root, name);
        const info = await stat(path).catch(() => undefined);
        if (info && now - info.mtimeMs > RECEIPT_RETENTION_MS) {
          await unlink(path).catch(() => undefined);
        }
      }));
  }
}
