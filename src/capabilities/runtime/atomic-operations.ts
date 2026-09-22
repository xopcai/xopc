import { randomUUID } from 'node:crypto';

import { runSqliteWriteTransaction } from '../../storage/sqlite/transaction.js';
import { withOperation } from '../../infra/operation-context.js';

export class OperationConflictError extends Error {}

/** Only synchronous, same-database effects belong here. No leases or retries are needed under SQLite's write lock. */
export function executeAtomicOperation(input: {
  principalId: string;
  capabilityId: string;
  idempotencyKey: string;
  requestDigest: string;
  descriptorDigest: string;
  surface: string;
}, execute: (operationId: string) => unknown): unknown {
  return runSqliteWriteTransaction(db => {
    const existing = db.prepare(`SELECT operation_id, request_digest, descriptor_digest, result_json, state, recovery_mode
      FROM capability_operations WHERE principal_id = ? AND capability_id = ? AND idempotency_key = ?`)
      .get(input.principalId, input.capabilityId, input.idempotencyKey) as {
        operation_id: string; request_digest: string; descriptor_digest: string; result_json: string; state: string; recovery_mode: string;
      } | undefined;
    if (existing && (existing.request_digest !== input.requestDigest || existing.descriptor_digest !== input.descriptorDigest
      || existing.state !== 'succeeded' || existing.recovery_mode !== 'atomic')) {
      throw new OperationConflictError('Idempotency key already identifies a different operation');
    }
    const operationId = existing?.operation_id ?? randomUUID();
    const now = Date.now();
    let result: unknown;
    if (existing) {
      result = JSON.parse(existing.result_json);
    } else {
      result = withOperation(operationId, () => execute(operationId));
      if (result && typeof (result as { then?: unknown }).then === 'function') {
        throw new Error('Atomic capability handlers must be synchronous');
      }
      const serialized = JSON.stringify(result);
      if (serialized === undefined) throw new Error('Atomic capability result must be JSON');
      db.prepare(`INSERT INTO capability_operations
        (operation_id, principal_id, capability_id, idempotency_key, request_digest, descriptor_digest, result_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(operationId, input.principalId, input.capabilityId,
          input.idempotencyKey, input.requestDigest, input.descriptorDigest, serialized, now);
      result = JSON.parse(serialized);
    }
    db.prepare(`INSERT INTO capability_invocations (invocation_id, operation_id, surface, replayed, created_at)
      VALUES (?, ?, ?, ?, ?)`).run(randomUUID(), operationId, input.surface, existing ? 1 : 0, now);
    return result;
  });
}
