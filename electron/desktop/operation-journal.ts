import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, mkdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

import { REMOTE_COMPUTER_DESCRIPTOR, REMOTE_COMPUTER_CONTROL_TOOL } from '@xopcai/computer-control-contract';

import { canonicalJson, desktopOperationReviewSchema, type DesktopOperationReview, desktopOperationAttemptSchema as attemptSchema, desktopOperationIntentSchema as intentSchema,
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
      ); CREATE TABLE IF NOT EXISTS stop_confirmations (operation_id TEXT PRIMARY KEY REFERENCES operations(operation_id), confirmed_at INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS operation_intents (operation_id TEXT PRIMARY KEY REFERENCES operations(operation_id), intent_json TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS operation_reviews (operation_id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, review_id TEXT NOT NULL UNIQUE, review_json TEXT NOT NULL, reviewed_at INTEGER NOT NULL);`);
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
    return this.write(database => Boolean(database.prepare("SELECT 1 FROM operations WHERE state IN ('unknown','stopped') AND NOT EXISTS (SELECT 1 FROM operation_reviews r WHERE r.operation_id=operations.operation_id AND r.fingerprint=operations.fingerprint) LIMIT 1").get()));
  }
  hasUnconfirmedStops(): boolean {
    return this.write(database => Boolean(database.prepare("SELECT 1 FROM operations WHERE state='unknown' AND NOT EXISTS (SELECT 1 FROM stop_confirmations s WHERE s.operation_id=operations.operation_id) LIMIT 1").get()));
  }
  unresolved(): Array<{ operationId: string; intent?: DesktopOperationIntent }> {
    return this.write(database => (database.prepare(`SELECT o.operation_id,i.intent_json FROM operations o
      LEFT JOIN operation_intents i ON i.operation_id=o.operation_id WHERE o.state IN ('unknown','stopped')
      AND NOT EXISTS(SELECT 1 FROM operation_reviews r WHERE r.operation_id=o.operation_id AND r.fingerprint=o.fingerprint)
      ORDER BY o.updated_at,o.operation_id LIMIT 8`).all() as { operation_id: string; intent_json: string | null }[]).map(row => {
      const intent = row.intent_json ? intentSchema.parse(JSON.parse(row.intent_json)) : undefined;
      if (intent && (intent.operationId !== row.operation_id || !this.row(database,intent))) throw new Error('DESKTOP_OPERATION_IDENTITY_MISMATCH');
      return { operationId: row.operation_id, ...(intent ? { intent } : {}) };
    }));
  }
  reviewed(input: DesktopOperationIntent): DesktopOperationReview | undefined {
    const intent = intentSchema.parse(input);
    return this.write(database => {
      const row = database.prepare('SELECT fingerprint,review_json FROM operation_reviews WHERE operation_id=?').get(intent.operationId) as { fingerprint: string; review_json: string } | undefined;
      if (row && row.fingerprint !== this.fingerprint(intent)) throw new Error('DESKTOP_OPERATION_IDENTITY_MISMATCH');
      return row ? desktopOperationReviewSchema.parse(JSON.parse(row.review_json)) : undefined;
    });
  }
  /** Main-process native human approval only. This preserves the outcome and permanently prevents replay of this identity. */
  review(input: DesktopOperationIntent, value: DesktopOperationReview): void {
    const intent = intentSchema.parse(input), review = desktopOperationReviewSchema.parse(value), fingerprint = this.fingerprint(intent), json = canonicalJson(review);
    if (review.intentFingerprint !== fingerprint) throw new Error('DESKTOP_OPERATION_IDENTITY_MISMATCH');
    this.write(database => {
      database.exec('BEGIN IMMEDIATE');
      try {
        const previous = database.prepare('SELECT fingerprint,review_json FROM operation_reviews WHERE operation_id=?').get(intent.operationId);
        if (previous) {
          if (previous.fingerprint !== fingerprint || previous.review_json !== json) throw new Error('DESKTOP_OPERATION_REVIEW_CONFLICT');
        } else {
          if (database.prepare('SELECT 1 FROM operation_reviews WHERE review_id=?').get(review.reviewId)) throw new Error('DESKTOP_OPERATION_REVIEW_CONFLICT');
          const row = this.row(database, intent), receipt = row ? this.receipt(intent, row) : undefined;
          if (receipt ? review.localStatus !== 'recorded' || !receipt.executionStopped || canonicalJson(receipt) !== canonicalJson(review.receipt)
            : review.localStatus !== 'not-found' || !(intent.tool === 'desktop.clipboard.write' || intent.tool === REMOTE_COMPUTER_CONTROL_TOOL && !intent.workspaceId
              && intent.toolRevision === createHash('sha256').update(canonicalJson(REMOTE_COMPUTER_DESCRIPTOR)).digest('hex') || ['desktop.workspace.write', 'desktop.command.run', 'desktop.terminal.open'].includes(intent.tool) && intent.workspaceId)) throw new Error('DESKTOP_OPERATION_STOP_UNCONFIRMED');
          if (!row) {
            if ((database.prepare('SELECT count(*) AS count FROM operations').get()!.count as number) >= 100000) throw new Error('DESKTOP_OPERATION_HISTORY_FULL');
            // A missing receipt is not permission to execute the old intent later.
            database.prepare("INSERT INTO operations VALUES (?,?,?,'unknown',NULL,?,NULL,NULL)").run(intent.operationId,fingerprint,this.lease.generation,Date.now());
            database.prepare('INSERT INTO stop_confirmations VALUES (?,?)').run(intent.operationId,Date.now());
          }
          database.prepare('INSERT INTO operation_intents VALUES (?,?) ON CONFLICT(operation_id) DO NOTHING').run(intent.operationId,JSON.stringify(intent));
          database.prepare('INSERT INTO operation_reviews VALUES (?,?,?,?,?)').run(intent.operationId,fingerprint,review.reviewId,json,Date.now());
        }
        database.exec('COMMIT');
      } catch (error) { database.exec('ROLLBACK'); throw error; }
    });
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
      database.exec('BEGIN IMMEDIATE');
      try {
        database.prepare("INSERT INTO operations VALUES (?,?,?,'recorded',NULL,?,NULL,NULL)").run(intent.operationId, this.fingerprint(intent), this.lease.generation, Date.now());
        database.prepare('INSERT INTO operation_intents VALUES (?,?)').run(intent.operationId,JSON.stringify(intent));
        database.exec('COMMIT');
      } catch (error) { database.exec('ROLLBACK'); throw error; }
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
