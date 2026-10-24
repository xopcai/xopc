import { randomUUID } from 'node:crypto';

import { getSqliteDatabase, runSqliteWriteTransaction } from '../../storage/sqlite/transaction.js';
import type { BrowserSetup } from './types.js';

export function readBrowserSetup(id: string): BrowserSetup | undefined {
  const row = getSqliteDatabase().prepare('SELECT payload_json FROM browser_setup_runs WHERE id = ?').get(id) as { payload_json: string } | undefined;
  return row ? JSON.parse(row.payload_json) as BrowserSetup : undefined;
}

export function findBrowserSetup(conversationId: string, agentId: string): BrowserSetup | undefined {
  const row = getSqliteDatabase().prepare('SELECT payload_json FROM browser_setup_runs WHERE conversation_id = ? AND agent_id = ? ORDER BY updated_at DESC, rowid DESC LIMIT 1')
    .get(conversationId, agentId) as { payload_json: string } | undefined;
  return row ? JSON.parse(row.payload_json) as BrowserSetup : undefined;
}

export function createBrowserSetup(conversationId: string, agentId: string, configRevision: string): BrowserSetup {
  return runSqliteWriteTransaction(db => {
    const existing = findBrowserSetup(conversationId, agentId);
    if (existing && existing.state !== 'cancelled' && existing.state !== 'completed') return existing;
    const now = Date.now();
    const setup: BrowserSetup = { id: randomUUID(), conversationId, agentId, configRevision, state: 'plan_ready', revision: 1, createdAt: now, updatedAt: now };
    db.prepare('INSERT INTO browser_setup_runs (id, conversation_id, agent_id, revision, updated_at, payload_json) VALUES (?, ?, ?, ?, ?, ?)')
      .run(setup.id, conversationId, agentId, setup.revision, now, JSON.stringify(setup));
    return setup;
  });
}

export function saveBrowserSetup(next: BrowserSetup, expectedRevision: number): BrowserSetup {
  next = { ...next, revision: expectedRevision + 1, updatedAt: Date.now() };
  const result = getSqliteDatabase().prepare('UPDATE browser_setup_runs SET revision = ?, updated_at = ?, payload_json = ? WHERE id = ? AND revision = ?')
    .run(next.revision, next.updatedAt, JSON.stringify(next), next.id, expectedRevision);
  if (result.changes !== 1) throw new Error('SETUP_CONFLICT: Configuration progress changed. Read it again.');
  return next;
}
