import { randomUUID } from 'node:crypto';

import { getSqliteDatabase, runSqliteWriteTransaction } from './transaction.js';

export type MemoryReferenceGrantScope = 'once' | 'session' | 'always';
export type MemoryReferenceConsentStatus = 'pending' | 'granted' | 'denied' | 'consumed';

export type MemoryReferenceConsent = {
  id: string;
  recordId: string;
  sessionKey: string;
  purpose: string;
  status: MemoryReferenceConsentStatus;
  grantScope?: MemoryReferenceGrantScope;
  expiresAt?: string;
  createdAt: string;
  updatedAt: string;
};

type ConsentRow = {
  consent_id: string;
  record_id: string;
  session_key: string;
  purpose: string;
  status: MemoryReferenceConsentStatus;
  grant_scope: MemoryReferenceGrantScope | null;
  expires_at: number | null;
  created_at: number;
  updated_at: number;
};

function fromRow(row: ConsentRow): MemoryReferenceConsent {
  return {
    id: row.consent_id,
    recordId: row.record_id,
    sessionKey: row.session_key,
    purpose: row.purpose,
    status: row.status,
    ...(row.grant_scope ? { grantScope: row.grant_scope } : {}),
    ...(row.expires_at ? { expiresAt: new Date(row.expires_at).toISOString() } : {}),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

export function ensureMemoryReferenceConsentRequest(input: {
  recordId: string;
  sessionKey: string;
  purpose: string;
}): MemoryReferenceConsent {
  return runSqliteWriteTransaction((db) => {
    const existing = db.prepare(`
      SELECT * FROM memory_reference_consents
      WHERE record_id = ? AND session_key = ? AND status = 'pending'
    `).get(input.recordId, input.sessionKey) as ConsentRow | undefined;
    if (existing) return fromRow(existing);
    const id = randomUUID();
    const now = Date.now();
    db.prepare(`
      INSERT INTO memory_reference_consents (
        consent_id, record_id, session_key, purpose, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'pending', ?, ?)
    `).run(id, input.recordId, input.sessionKey, input.purpose.trim().slice(0, 500), now, now);
    return fromRow(db.prepare('SELECT * FROM memory_reference_consents WHERE consent_id = ?').get(id) as ConsentRow);
  });
}

export function listMemoryReferenceConsents(options: {
  status?: MemoryReferenceConsentStatus;
  sessionKey?: string;
} = {}): MemoryReferenceConsent[] {
  const clauses: string[] = [];
  const params: string[] = [];
  if (options.status) {
    clauses.push('status = ?');
    params.push(options.status);
  }
  if (options.sessionKey) {
    clauses.push('session_key = ?');
    params.push(options.sessionKey);
  }
  const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
  return (getSqliteDatabase().prepare(
    `SELECT * FROM memory_reference_consents${where} ORDER BY created_at DESC`,
  ).all(...params) as ConsentRow[]).map(fromRow);
}

export function decideMemoryReferenceConsent(
  id: string,
  decision: 'deny' | MemoryReferenceGrantScope,
): MemoryReferenceConsent | undefined {
  return runSqliteWriteTransaction((db) => {
    const current = db.prepare('SELECT * FROM memory_reference_consents WHERE consent_id = ?').get(id) as ConsentRow | undefined;
    if (!current || current.status !== 'pending') return undefined;
    const now = Date.now();
    const expiresAt = decision === 'once'
      ? now + 15 * 60 * 1_000
      : decision === 'session' ? now + 24 * 60 * 60 * 1_000 : null;
    db.prepare(`
      UPDATE memory_reference_consents
      SET status = ?, grant_scope = ?, expires_at = ?, updated_at = ?
      WHERE consent_id = ?
    `).run(decision === 'deny' ? 'denied' : 'granted', decision === 'deny' ? null : decision, expiresAt, now, id);
    return fromRow(db.prepare('SELECT * FROM memory_reference_consents WHERE consent_id = ?').get(id) as ConsentRow);
  });
}

export function revokeMemoryReferenceConsent(id: string): MemoryReferenceConsent | undefined {
  return runSqliteWriteTransaction((db) => {
    const current = db.prepare('SELECT * FROM memory_reference_consents WHERE consent_id = ?').get(id) as ConsentRow | undefined;
    if (!current || current.status !== 'granted') return undefined;
    const now = Date.now();
    db.prepare(`
      UPDATE memory_reference_consents
      SET status = 'denied', grant_scope = NULL, expires_at = NULL, updated_at = ?
      WHERE consent_id = ? AND status = 'granted'
    `).run(now, id);
    return fromRow(db.prepare('SELECT * FROM memory_reference_consents WHERE consent_id = ?').get(id) as ConsentRow);
  });
}

export function hasMemoryReferenceConsent(recordId: string, sessionKey: string): boolean {
  const now = Date.now();
  return Boolean(getSqliteDatabase().prepare(`
    SELECT 1 FROM memory_reference_consents
    WHERE record_id = ? AND status = 'granted'
      AND (expires_at IS NULL OR expires_at > ?)
      AND (grant_scope = 'always' OR session_key = ?)
    LIMIT 1
  `).get(recordId, now, sessionKey));
}

/** Resolve a valid grant. One-shot grants are consumed atomically. */
export function consumeMemoryReferenceConsent(recordId: string, sessionKey: string): boolean {
  return runSqliteWriteTransaction((db) => {
    const now = Date.now();
    const row = db.prepare(`
      SELECT * FROM memory_reference_consents
      WHERE record_id = ? AND status = 'granted'
        AND (expires_at IS NULL OR expires_at > ?)
        AND (grant_scope = 'always' OR session_key = ?)
      ORDER BY CASE grant_scope WHEN 'once' THEN 0 WHEN 'session' THEN 1 ELSE 2 END, updated_at DESC
      LIMIT 1
    `).get(recordId, now, sessionKey) as ConsentRow | undefined;
    if (!row) return false;
    if (row.grant_scope === 'once') {
      db.prepare(`UPDATE memory_reference_consents SET status = 'consumed', updated_at = ? WHERE consent_id = ?`)
        .run(now, row.consent_id);
    }
    db.prepare(`
      UPDATE memory_reference_consents SET status = 'consumed', updated_at = ?
      WHERE record_id = ? AND session_key = ? AND status = 'pending'
    `).run(now, recordId, sessionKey);
    return true;
  });
}
