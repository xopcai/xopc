import { DurableState } from '../storage/sqlite/durable-state.js';
import { runSqliteWriteTransaction } from '../storage/sqlite/transaction.js';
import type { ShareRecord } from './share-types.js';

/** SQLite-only revocation for compound note deletion transactions. */
export function revokeNoteShareRecords(noteId: string): string[] {
  return runSqliteWriteTransaction(() => {
    const shares = new DurableState<ShareRecord>('shares');
    const revoked: string[] = [];
    for (const record of shares.values()) {
      if (record.kind !== 'note' || record.sourceNoteId !== noteId || record.revoked) continue;
      shares.set(record.id, { ...record, revoked: true });
      revoked.push(record.id);
    }
    return revoked;
  });
}

export function canRemoveRevokedNoteShareArtifact(id: string): boolean {
  const record = new DurableState<ShareRecord>('shares').get(id);
  return !record || (record.kind === 'note' && record.revoked);
}
