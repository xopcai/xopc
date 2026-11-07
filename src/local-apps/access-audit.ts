import { randomUUID } from 'node:crypto';

import { DurableState } from '../storage/sqlite/durable-state.js';
import { getSqliteDatabase, runSqliteWriteTransaction } from '../storage/sqlite/transaction.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('LocalApps:Access');
export interface LocalAppAccessEvent {
  id: string;
  createdAt: number;
  principalId: string;
  action: string;
  releaseId?: string;
  grantRevision?: string;
  status: 'succeeded' | 'denied' | 'failed';
  resourceId?: string;
  resourceIds?: string[];
  surface?: string;
  code?: string;
  operationId?: string;
}

/** Bounded operational audit; never persist note bodies, search terms, tokens or results. */
export function recordLocalAppAccess(extensionId: string, event: Omit<LocalAppAccessEvent, 'id' | 'createdAt'>): void {
  try {
    runSqliteWriteTransaction(db => {
      const entry = { ...event, principalId: event.principalId.slice(0, 512), action: event.action.slice(0, 200),
        operationId: event.operationId?.slice(0, 128),
        resourceId: event.resourceId?.slice(0, 512), resourceIds: event.resourceIds?.slice(0, 200).map(id => id.slice(0, 512)),
        id: randomUUID(), createdAt: Date.now() };
      new DurableState('local-app-access-audit', extensionId).set(entry.id, entry);
      db.prepare(`DELETE FROM durable_state WHERE namespace = 'local-app-access-audit' AND scope = ? AND key NOT IN (
        SELECT key FROM durable_state WHERE namespace = 'local-app-access-audit' AND scope = ? ORDER BY rowid DESC LIMIT 1000
      )`).run(extensionId, extensionId);
    });
  } catch (err) {
    log.error({ err, extensionId, action: event.action }, 'Local app access audit could not be saved');
  }
}

export function listLocalAppAccess(extensionId: string): LocalAppAccessEvent[] {
  return (getSqliteDatabase().prepare(`SELECT payload FROM durable_state WHERE namespace = 'local-app-access-audit'
    AND scope = ? ORDER BY rowid DESC LIMIT 100`).all(extensionId) as Array<{ payload: string }>).map(row => JSON.parse(row.payload));
}
