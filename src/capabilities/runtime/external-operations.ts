import { randomUUID } from 'node:crypto';

import { getSqliteDatabase, runSqliteWriteTransaction } from '../../storage/sqlite/transaction.js';
import { CapabilityError } from './errors.js';

type Outcome = 'running' | 'succeeded' | 'failed' | 'unknown';
type OperationRow = { operation_id: string; request_digest: string; descriptor_digest: string;
  state: Outcome; result_json: string; generation: number; lease_expires_at: number | null; recovery_mode: string };

/** Use only when the provider can prove that no effect was applied. Network errors are not proof. */
export class ExternalEffectNotAppliedError extends Error {}

export interface ExternalOperationInput {
  principalId: string;
  capabilityId: string;
  idempotencyKey: string;
  requestDigest: string;
  descriptorDigest: string;
  surface: string;
  recovery: 'manual' | 'provider-idempotent';
  leaseMs?: number;
  now?: () => number;
}

/** The callback must use operationId as the provider key when declaring provider-idempotent recovery. */
export async function executeExternalOperation<T>(input: ExternalOperationInput, execute: (operationId: string) => Promise<T>, validate?: (result: T) => T): Promise<T> {
  if (!input.principalId || !input.idempotencyKey.trim() || input.idempotencyKey.length > 200) {
    throw new CapabilityError('INVALID_INPUT', 'External operation identity is required');
  }
  if (input.leaseMs !== undefined && !Number.isFinite(input.leaseMs)) {
    throw new CapabilityError('INVALID_INPUT', 'Lease duration must be finite');
  }
  const now = input.now ?? Date.now;
  const invocationId = randomUUID();
  const claim = runSqliteWriteTransaction(db => {
    const row = db.prepare(`SELECT operation_id, request_digest, descriptor_digest, state, result_json, generation, lease_expires_at, recovery_mode
      FROM capability_operations WHERE principal_id = ? AND capability_id = ? AND idempotency_key = ?`)
      .get(input.principalId, input.capabilityId, input.idempotencyKey) as OperationRow | undefined;
    if (row && (row.request_digest !== input.requestDigest || row.descriptor_digest !== input.descriptorDigest || row.recovery_mode !== input.recovery)) {
      throw new CapabilityError('REVISION_CONFLICT', 'Operation parameters or contract changed', row.operation_id);
    }
    if (row?.state === 'succeeded') {
      db.prepare(`INSERT INTO capability_invocations
        (invocation_id, operation_id, surface, replayed, created_at, finished_at) VALUES (?, ?, ?, 1, ?, ?)`)
        .run(invocationId, row.operation_id, input.surface, now(), now());
      return { replay: true as const, result: JSON.parse(row.result_json) as T, operationId: row.operation_id, generation: row.generation };
    }
    if (row?.state === 'failed') throw new CapabilityError('UNAVAILABLE', 'Previous attempt was rejected without applying an effect; use a new intent to retry', row.operation_id);
    if (row?.state === 'running' && (row.lease_expires_at ?? 0) > now()) {
      throw new CapabilityError('IN_PROGRESS', 'The same external operation is still running', row.operation_id);
    }
    if (row && input.recovery === 'manual') {
      return { unknown: true as const, operationId: row.operation_id, generation: row.generation };
    }
    const operationId = row?.operation_id ?? randomUUID();
    const generation = (row?.generation ?? 0) + 1;
    const expires = now() + Math.max(1000, Math.min(input.leaseMs ?? 120000, 3600000));
    if (row) {
      db.prepare(`UPDATE capability_operations SET state = 'running', generation = ?, lease_expires_at = ?
        WHERE operation_id = ?`).run(generation, expires, operationId);
      db.prepare(`UPDATE capability_invocations SET state = 'unknown', finished_at = ?
        WHERE operation_id = ? AND state = 'running'`).run(now(), operationId);
    } else {
      db.prepare(`INSERT INTO capability_operations
        (operation_id, principal_id, capability_id, idempotency_key, request_digest, descriptor_digest,
          result_json, created_at, state, generation, lease_expires_at, recovery_mode) VALUES (?, ?, ?, ?, ?, ?, 'null', ?, 'running', ?, ?, ?)`)
        .run(operationId, input.principalId, input.capabilityId, input.idempotencyKey, input.requestDigest,
          input.descriptorDigest, now(), generation, expires, input.recovery);
    }
    db.prepare(`INSERT INTO capability_invocations
      (invocation_id, operation_id, surface, replayed, created_at, state) VALUES (?, ?, ?, 0, ?, 'running')`)
      .run(invocationId, operationId, input.surface, now());
    return { operationId, generation };
  });
  if ('replay' in claim) return claim.result;
  if ('unknown' in claim) {
    runSqliteWriteTransaction(db => {
      db.prepare(`UPDATE capability_operations SET state = 'unknown'
        WHERE operation_id = ? AND generation = ? AND state = 'running'`).run(claim.operationId, claim.generation);
      db.prepare(`UPDATE capability_invocations SET state = 'unknown', finished_at = ?
        WHERE operation_id = ? AND state = 'running'`).run(now(), claim.operationId);
    });
    throw new CapabilityError('OUTCOME_UNKNOWN', 'External outcome is unknown; verify it before issuing another write', claim.operationId);
  }
  try {
    const raw = await execute(claim.operationId);
    const evidence = JSON.stringify(raw);
    if (evidence !== undefined) getSqliteDatabase().prepare(`UPDATE capability_operations SET evidence_json = ?
      WHERE operation_id = ? AND generation = ?`).run(evidence, claim.operationId, claim.generation);
    const result = validate ? validate(raw) : raw;
    const json = JSON.stringify(result);
    if (json === undefined) throw new Error('External result must be JSON');
    const committed = runSqliteWriteTransaction(db => {
      const changed = db.prepare(`UPDATE capability_operations SET state = 'succeeded', result_json = ?, lease_expires_at = NULL
        WHERE operation_id = ? AND generation = ? AND state IN ('running', 'unknown')`)
        .run(json, claim.operationId, claim.generation).changes;
      if (changed) db.prepare(`UPDATE capability_invocations SET state = 'succeeded', finished_at = ? WHERE invocation_id = ?`).run(now(), invocationId);
      return changed;
    });
    if (!committed) throw new CapabilityError('OUTCOME_UNKNOWN', 'A newer recovery attempt owns this operation', claim.operationId);
    return JSON.parse(json) as T;
  } catch (error) {
    const state: Outcome = error instanceof ExternalEffectNotAppliedError ? 'failed' : 'unknown';
    runSqliteWriteTransaction(db => {
      db.prepare(`UPDATE capability_operations SET state = ?, lease_expires_at = NULL
        WHERE operation_id = ? AND generation = ? AND state = 'running'`).run(state, claim.operationId, claim.generation);
      db.prepare(`UPDATE capability_invocations SET state = ?, finished_at = ? WHERE invocation_id = ? AND state = 'running'`).run(state, now(), invocationId);
    });
    const rejection = error instanceof ExternalEffectNotAppliedError && error.cause instanceof CapabilityError ? error.cause : undefined;
    const failure = new CapabilityError(rejection?.code ?? (state === 'failed' ? 'UNAVAILABLE' : 'OUTCOME_UNKNOWN'),
      rejection?.message ?? (state === 'failed' ? 'Provider confirmed no effect was applied' : 'External outcome is unknown; do not resend with a new key without verification'), claim.operationId);
    failure.cause = error;
    throw failure;
  }
}
