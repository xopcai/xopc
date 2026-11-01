import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, mkdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

import { desktopOperationAttemptSchema as attemptSchema, desktopOperationIntentSchema as intentSchema,
  type DesktopOperationAttempt, type DesktopOperationIntent, type DesktopOperationState, type DesktopOperationReceipt } from '@xopcai/endpoint-tools-protocol';

import { requireNodeSqlite } from '../../src/infra/node-sqlite.js';

export type { DesktopOperationIntent, DesktopOperationState, DesktopOperationReceipt } from '@xopcai/endpoint-tools-protocol';
type Row = { stop_confirmed: number; invocation_id: string | null; connection_instance_id: string | null; fingerprint: string; state: DesktopOperationState; result_hash: string | null; updated_at: number };

/** OS-released SQLite lock. Every executor must use the same trusted per-user root. */
export class DesktopExecutionLease {
  readonly generation = randomUUID();
  private database?: DatabaseSync;
  private journalAttached = false;
  readonly root: string;
  constructor(root: string) {
    mkdirSync(root, { recursive: true, mode: 0o700 }); this.root = realpathSync(root);
    const path = join(this.root, 'executor-lock.db');
    const database = new (requireNodeSqlite().DatabaseSync)(path);
    try {
      chmodSync(path, 0o600);
      database.exec('PRAGMA busy_timeout=0; PRAGMA locking_mode=EXCLUSIVE; BEGIN EXCLUSIVE');
      this.database = database;
    } catch (error) { database.close(); throw new Error('DESKTOP_EXECUTOR_ALREADY_OWNED', { cause: error }); }
  }
  assertHeld(): void { if (!this.database) throw new Error('DESKTOP_EXECUTOR_LEASE_CLOSED'); }
  attachJournal(): void {
    this.assertHeld();
    if (this.journalAttached) throw new Error('DESKTOP_JOURNAL_ALREADY_ATTACHED');
    this.journalAttached = true;
  }
  close(): void { const database = this.database; this.database = undefined; database?.close(); }
}

/** Metadata-only durable intent ledger; it grants no tool or execution authority. */
export class DesktopOperationJournal {
  private database?: DatabaseSync;
  private failed = false;
  private supervisorAttached = false;
  constructor(private readonly lease: DesktopExecutionLease) {
    lease.attachJournal();
    const path = join(lease.root, 'operations.db');
    const database = new (requireNodeSqlite().DatabaseSync)(path);
    try {
      chmodSync(path, 0o600);
      const existing = database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='journal_meta'").get();
      if (existing) {
        const versions = database.prepare('SELECT version FROM journal_meta').all();
        if (versions.length !== 1 || versions[0].version !== 1) throw new Error('DESKTOP_JOURNAL_VERSION_UNSUPPORTED');
      }
      database.exec(`PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA busy_timeout=0; BEGIN IMMEDIATE;
        CREATE TABLE IF NOT EXISTS journal_meta (version INTEGER NOT NULL);
        INSERT INTO journal_meta SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM journal_meta);`);
      const versions = database.prepare('SELECT version FROM journal_meta').all();
      if (versions.length !== 1 || versions[0].version !== 1) throw new Error('DESKTOP_JOURNAL_VERSION_UNSUPPORTED');
      database.exec(`CREATE TABLE IF NOT EXISTS operations (
        operation_id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, generation TEXT NOT NULL,
        state TEXT NOT NULL CHECK(state IN ('recorded','running','cancel-requested','succeeded','failed','stopped','unknown')),
        result_hash TEXT, updated_at INTEGER NOT NULL, invocation_id TEXT, connection_instance_id TEXT
      ); CREATE TABLE IF NOT EXISTS stop_confirmations (operation_id TEXT PRIMARY KEY REFERENCES operations(operation_id), confirmed_at INTEGER NOT NULL);`);
      // A crashed owner cannot prove whether an external side effect occurred.
      database.prepare("UPDATE operations SET state='unknown', updated_at=? WHERE state IN ('recorded','running','cancel-requested')")
        .run(Date.now());
      database.exec('COMMIT');
      this.database = database;
    } catch (error) { try { database.exec('ROLLBACK'); } catch { /* Initialization may have failed before BEGIN. */ } database.close(); throw error; }
  }
  private write<T>(work: (database: DatabaseSync) => T): T {
    this.lease.assertHeld();
    if (!this.database || this.failed) throw new Error('DESKTOP_JOURNAL_UNAVAILABLE');
    try { return work(this.database); }
    catch (error) {
      // Input/state rejections do not imply a disk failure.
      if (!(error instanceof Error && /^DESKTOP_OPERATION_/.test(error.message))) this.failed = true;
      throw error;
    }
  }
  private fingerprint(intent: DesktopOperationIntent): string {
    return createHash('sha256').update(JSON.stringify(intentSchema.parse(intent))).digest('hex');
  }
  private row(database: DatabaseSync, intent: DesktopOperationIntent): Row | undefined {
    const row = database.prepare('SELECT fingerprint,state,result_hash,updated_at,invocation_id,connection_instance_id,EXISTS(SELECT 1 FROM stop_confirmations s WHERE s.operation_id=operations.operation_id) AS stop_confirmed FROM operations WHERE operation_id=?').get(intent.operationId) as Row | undefined;
    if (row && row.fingerprint !== this.fingerprint(intent)) throw new Error('DESKTOP_OPERATION_IDENTITY_MISMATCH');
    return row;
  }
  private receipt(intent: DesktopOperationIntent, row: Row): DesktopOperationReceipt {
    return { operationId: intent.operationId, state: row.state, executionStopped: ['succeeded', 'failed', 'stopped'].includes(row.state) || row.stop_confirmed === 1,
      ...(row.result_hash ? { resultHash: row.result_hash } : {}), updatedAt: row.updated_at, ...(row.invocation_id ? { invocationId: row.invocation_id } : {}), ...(row.connection_instance_id ? { connectionInstanceId: row.connection_instance_id } : {}) };
  }
  inspect(input: DesktopOperationIntent): DesktopOperationReceipt | undefined {
    const intent = intentSchema.parse(input);
    return this.write(database => { const row = this.row(database, intent); return row ? this.receipt(intent, row) : undefined; });
  }
  hasUnknown(): boolean {
    return this.write(database => Boolean(database.prepare("SELECT 1 FROM operations WHERE state='unknown' LIMIT 1").get()));
  }
  attachSupervisor(): void {
    if (this.supervisorAttached) throw new Error('DESKTOP_SUPERVISOR_ALREADY_ATTACHED');
    this.write(() => { this.supervisorAttached = true; });
  }
  confirmUnknownStopped(input: DesktopOperationIntent): DesktopOperationReceipt {
    const intent = intentSchema.parse(input);
    return this.write(database => {
      if (this.row(database, intent)?.state !== 'unknown') throw new Error('DESKTOP_OPERATION_STATE_INVALID');
      database.prepare('INSERT INTO stop_confirmations VALUES (?,?) ON CONFLICT(operation_id) DO NOTHING').run(intent.operationId, Date.now());
      return this.receipt(intent, this.row(database, intent)!);
    });
  }
  record(input: DesktopOperationIntent): { fresh: boolean; receipt: DesktopOperationReceipt } {
    const intent = intentSchema.parse(input);
    return this.write(database => {
      const existing = this.row(database, intent);
      if (existing) return { fresh: false, receipt: this.receipt(intent, existing) };
      if (intent.expiresAt <= Date.now()) throw new Error('DESKTOP_OPERATION_EXPIRED');
      // Never evict deduplication history automatically to admit a new side effect.
      if ((database.prepare('SELECT count(*) AS count FROM operations').get()!.count as number) >= 100000) throw new Error('DESKTOP_OPERATION_HISTORY_FULL');
      database.prepare("INSERT INTO operations VALUES (?,?,?,'recorded',NULL,?,NULL,NULL)").run(intent.operationId, this.fingerprint(intent), this.lease.generation, Date.now());
      return { fresh: true, receipt: this.receipt(intent, this.row(database, intent)!) };
    });
  }
  start(input: DesktopOperationIntent, attempt: DesktopOperationAttempt): DesktopOperationReceipt {
    return this.transition(input, ['recorded'], 'running', undefined, true, attemptSchema.parse(attempt));
  }
  requestStop(input: DesktopOperationIntent): DesktopOperationReceipt {
    return this.transition(input, ['running'], 'cancel-requested');
  }
  finish(input: DesktopOperationIntent, state: 'succeeded' | 'failed' | 'stopped' | 'unknown', resultHash?: string): DesktopOperationReceipt {
    if (resultHash !== undefined && !/^[a-f0-9]{64}$/.test(resultHash)) throw new Error('DESKTOP_OPERATION_RESULT_INVALID');
    return this.transition(input, ['running', 'cancel-requested'], state, resultHash);
  }
  private transition(input: DesktopOperationIntent, from: DesktopOperationState[], state: DesktopOperationState, hash?: string, checkExpiry = false, attempt?: DesktopOperationAttempt): DesktopOperationReceipt {
    const intent = intentSchema.parse(input);
    return this.write(database => {
      const previous = this.row(database, intent);
      if (!previous || !from.includes(previous.state)) throw new Error('DESKTOP_OPERATION_STATE_INVALID');
      if (checkExpiry && intent.expiresAt <= Date.now()) throw new Error('DESKTOP_OPERATION_EXPIRED');
      const changed = database.prepare('UPDATE operations SET state=?, result_hash=?, updated_at=?, invocation_id=COALESCE(?,invocation_id), connection_instance_id=COALESCE(?,connection_instance_id) WHERE operation_id=? AND generation=?')
        .run(state, hash ?? null, Date.now(), attempt?.invocationId ?? null, attempt?.connectionInstanceId ?? null, intent.operationId, this.lease.generation);
      if (changed.changes !== 1) throw new Error('DESKTOP_OPERATION_OWNER_CHANGED');
      return this.receipt(intent, this.row(database, intent)!);
    });
  }
  close(): void { const database = this.database; this.database = undefined; database?.close(); }
}
