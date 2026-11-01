import { chmodSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

import { desktopTerminalBindingSchema, type DesktopTerminalBinding, type DesktopTerminalDispatch } from '@xopcai/endpoint-tools-protocol';
import { z } from 'zod';

import { requireNodeSqlite } from '../../src/infra/node-sqlite.js';
import { DesktopExecutionLease } from './operation-journal.js';
import type { DesktopTerminalInputLedger } from './terminal-bytes.js';

/** Durable metadata only. A pending/unknown byte dispatch is never replayed after a crash. */
export class DesktopTerminalLedger implements DesktopTerminalInputLedger {
  private database?: DatabaseSync;
  private readonly binding: DesktopTerminalBinding;
  constructor(private readonly lease: DesktopExecutionLease, binding: DesktopTerminalBinding) {
    lease.assertHeld(); this.binding = desktopTerminalBindingSchema.parse(binding);
    const path = join(lease.root, 'terminal-inputs.db'), database = new (requireNodeSqlite().DatabaseSync)(path);
    try {
      chmodSync(path, 0o600);
      if (database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='terminal_input_meta'").get()) {
        const existing = database.prepare('SELECT version FROM terminal_input_meta').all();
        if (existing.length !== 1 || existing[0].version !== 1) throw new Error('DESKTOP_TERMINAL_LEDGER_VERSION_UNSUPPORTED');
      }
      database.exec(`PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA busy_timeout=0;
        CREATE TABLE IF NOT EXISTS terminal_input_meta (version INTEGER NOT NULL);
        INSERT INTO terminal_input_meta SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM terminal_input_meta);
        CREATE TABLE IF NOT EXISTS terminal_inputs (input_id TEXT PRIMARY KEY,session_id TEXT NOT NULL,generation TEXT NOT NULL,connection_instance_id TEXT NOT NULL,
          sequence INTEGER NOT NULL,fingerprint TEXT NOT NULL,dispatch TEXT NOT NULL CHECK(dispatch IN ('pending','accepted','notStarted','unknown')),updated_at INTEGER NOT NULL,
          UNIQUE(session_id,generation,sequence));`);
      const versions = database.prepare('SELECT version FROM terminal_input_meta').all();
      if (versions.length !== 1 || versions[0].version !== 1) throw new Error('DESKTOP_TERMINAL_LEDGER_VERSION_UNSUPPORTED');
      this.database = database;
    } catch (error) { database.close(); throw error; }
  }
  private db() { this.lease.assertHeld(); if (!this.database) throw new Error('DESKTOP_TERMINAL_LEDGER_CLOSED'); return this.database; }
  async find(inputId: string) {
    z.uuid().parse(inputId);
    const row = this.db().prepare('SELECT * FROM terminal_inputs WHERE input_id=?').get(inputId);
    if (!row) return;
    const parsed = z.object({ session_id: z.uuid(), generation: z.uuid(), connection_instance_id: z.uuid(), sequence: z.number().int().min(1).max(1000),
      fingerprint: z.string().regex(/^[a-f0-9]{64}$/), dispatch: z.enum(['pending', 'accepted', 'notStarted', 'unknown']) }).parse(row);
    if (parsed.session_id !== this.binding.sessionId || parsed.generation !== this.binding.generation || parsed.connection_instance_id !== this.binding.connectionInstanceId) throw new Error('DESKTOP_TERMINAL_INPUT_IDENTITY_MISMATCH');
    return { sequence: parsed.sequence, fingerprint: parsed.fingerprint, dispatch: parsed.dispatch };
  }
  async record(inputId: string, fingerprint: string, sequence: number) {
    z.uuid().parse(inputId); z.string().regex(/^[a-f0-9]{64}$/).parse(fingerprint); z.number().int().min(1).max(1000).parse(sequence);
    const database = this.db();
    if ((database.prepare('SELECT count(*) AS count FROM terminal_inputs').get()!.count as number) >= 100000) throw new Error('DESKTOP_TERMINAL_LEDGER_FULL');
    database.prepare("INSERT INTO terminal_inputs VALUES (?,?,?,?,?,?,'pending',?)").run(inputId, this.binding.sessionId, this.binding.generation, this.binding.connectionInstanceId, sequence, fingerprint, Date.now());
  }
  async finish(inputId: string, dispatch: Exclude<DesktopTerminalDispatch, 'pending'>) {
    z.enum(['accepted', 'unknown', 'notStarted']).parse(dispatch);
    const previous = await this.find(inputId);
    if (!previous || previous.dispatch !== 'pending' && previous.dispatch !== dispatch && !(previous.dispatch === 'accepted' && dispatch === 'unknown')) throw new Error('DESKTOP_TERMINAL_INPUT_STATE_INVALID');
    this.db().prepare('UPDATE terminal_inputs SET dispatch=?,updated_at=? WHERE input_id=?').run(dispatch, Date.now(), inputId);
  }
  close() { const database = this.database; this.database = undefined; database?.close(); }
}
