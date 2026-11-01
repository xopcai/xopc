import { createHash, generateKeyPairSync, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { DesktopOperationIntent, DesktopOperationReview } from '@xopcai/endpoint-tools-protocol';
import { REMOTE_COMPUTER_DESCRIPTOR } from '@xopcai/computer-control-contract';
import { REMOTE_BROWSER_DESCRIPTOR } from '@xopcai/browser-control-contract/remote';
import { endpointToolRevision } from '@xopcai/endpoint-tools-client';
import { afterEach, beforeEach, expect, it } from 'vitest';

import { executeExternalOperation } from '../../../capabilities/runtime/external-operations.js';
import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../connection.js';
import { createDevice, revokeDevice } from '../device-access-repository.js';
import { revokeDesktopExecutionGrant, setDesktopExecutionGrant } from '../desktop-execution-repository.js';
import { hasReviewedDesktopExecutionStop, listDesktopOperationsForReview, recordDesktopOperationIntent, reviewDesktopOperation } from '../desktop-operation-repository.js';
import { getSqliteDatabase } from '../transaction.js';

let root: string, deviceId: string, gatewayId: string, grantId: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'xopc-operation-review-')); resetXopcDatabaseSingletonForTest(); openXopcDatabase({ path: join(root, 'gateway.db') });
  deviceId = createDevice({ displayName: 'Review fixture', platform: 'desktop', scopes: ['gateway.status', 'device.self'], publicKeyJwk: generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).publicKey.export({ format: 'jwk' }) }).id;
  gatewayId = randomUUID(); grantId = randomUUID();
  setDesktopExecutionGrant(deviceId, 0, { version: 1, grantId, localApprovalId: randomUUID(), expiresAt: Date.now() + 60000, toolRevisions: { 'desktop.clipboard.write': 'd'.repeat(64) } });
});
afterEach(() => { closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); rmSync(root, { recursive: true, force: true }); });
const operation = (key: string, run: (intent: DesktopOperationIntent) => unknown) => executeExternalOperation({ principalId: deviceId, capabilityId: 'fixture', idempotencyKey: key,
  requestDigest: 'a'.repeat(64), descriptorDigest: 'd'.repeat(64), surface: 'fixture', recovery: 'manual' }, id => {
  const intent = recordDesktopOperationIntent({ operationId: id, gatewayId, deviceId, tool: 'desktop.clipboard.write', argumentHash: 'a'.repeat(64), toolRevision: 'd'.repeat(64), authorizationRevision: 1, expiresAt: Date.now() + 10000 }, grantId);
  return Promise.resolve(run(intent));
});
const body = (intent: DesktopOperationIntent): DesktopOperationReview => ({ reviewId: randomUUID(), expectedGeneration: 1,
  intentFingerprint: createHash('sha256').update(JSON.stringify(intent)).digest('hex'), executorStopped: true, localStatus: 'recorded',
  receipt: { operationId: intent.operationId, state: 'unknown', executionStopped: true, updatedAt: Date.now() } });
async function unknown(key: string) {
  let intent: DesktopOperationIntent | undefined;
  await expect(operation(key, value => { intent = value; throw new Error('lost fixture completion'); })).rejects.toMatchObject({ code: 'OUTCOME_UNKNOWN' });
  expect(intent).toBeDefined(); return intent!;
}
it('retains an unknown outcome and its original replay prohibition while a native human review permits new intents', async () => {
  const intent = await unknown('original'), review = body(intent);
  expect(listDesktopOperationsForReview(deviceId, gatewayId)).toMatchObject([{ intent, generation: 1 }]);
  await expect(operation('blocked-new-intent', () => true)).rejects.toMatchObject({ code: 'OUTCOME_UNKNOWN' });
  expect(reviewDesktopOperation(intent.operationId, deviceId, gatewayId, review)).toMatchObject({ reviewed: true, outcome: 'unknown' });
  expect(reviewDesktopOperation(intent.operationId, deviceId, gatewayId, review)).toMatchObject({ reviewed: true });
  expect(listDesktopOperationsForReview(deviceId, gatewayId)).toEqual([]);
  expect(getSqliteDatabase().prepare('SELECT state FROM capability_operations WHERE operation_id=?').get(intent.operationId)?.state).toBe('unknown');
  let calls = 0;
  await expect(operation('original', () => { calls++; return true; })).rejects.toMatchObject({ code: 'OUTCOME_UNKNOWN' }); expect(calls).toBe(0);
  await expect(operation('explicit-new-intent', () => { calls++; return true; })).resolves.toBe(true); expect(calls).toBe(1);
});
it('rejects changed identity, generation, fingerprint and unconfirmed stop without clearing the block', async () => {
  const intent = await unknown('original'), review = body(intent);
  for (const changed of [{ ...review, expectedGeneration: 2 }, { ...review, intentFingerprint: 'e'.repeat(64) }, { ...review, receipt: { ...review.receipt!, operationId: randomUUID() } },
    { ...review, receipt: { ...review.receipt!, executionStopped: false } }]) expect(() => reviewDesktopOperation(intent.operationId, deviceId, gatewayId, changed)).toThrow();
  expect(() => reviewDesktopOperation(intent.operationId, randomUUID(), gatewayId, review)).toThrow();
  expect(() => reviewDesktopOperation(intent.operationId, deviceId, randomUUID(), review)).toThrow();
  expect(getSqliteDatabase().prepare('SELECT count(*) AS count FROM desktop_operation_reviews').get()?.count).toBe(0);
  revokeDevice(deviceId); expect(() => reviewDesktopOperation(intent.operationId, deviceId, gatewayId, review)).toThrow();
});
it('does not reuse a native review identity for another operation or silently replace earlier evidence', async () => {
  const first = await unknown('first'), review = body(first); reviewDesktopOperation(first.operationId, deviceId, gatewayId, review);
  const second = await unknown('second');
  expect(() => reviewDesktopOperation(second.operationId, deviceId, gatewayId, { ...body(second), reviewId: review.reviewId })).toThrow('REVIEW_CONFLICT');
  expect(() => reviewDesktopOperation(first.operationId, deviceId, gatewayId, { ...review, reviewId: randomUUID() })).toThrow('REVIEW_CONFLICT');
  expect(listDesktopOperationsForReview(deviceId, gatewayId)).toHaveLength(1);
});
it.each([REMOTE_COMPUTER_DESCRIPTOR, REMOTE_BROWSER_DESCRIPTOR])('releases only the exact old $name scope after every unknown has native review and old execution authority is inactive', async descriptor => {
  const toolRevision = endpointToolRevision(descriptor as never), nextGrantId = randomUUID();
  const grant = setDesktopExecutionGrant(deviceId, 1, { version: 1, grantId: nextGrantId, localApprovalId: randomUUID(), expiresAt: Date.now() + 60000,
    toolRevisions: { [descriptor.name]: toolRevision } });
  const scope = { gatewayId, deviceId, authorizationRevision: grant.revision, tool: descriptor.name, toolRevision };
  const lost = async (key: string) => {
    let intent!: DesktopOperationIntent;
    await expect(executeExternalOperation({ principalId: deviceId, capabilityId: 'control-fixture', idempotencyKey: key,
      requestDigest: 'a'.repeat(64), descriptorDigest: toolRevision, surface: 'fixture', recovery: 'manual' }, operationId => {
      intent = recordDesktopOperationIntent({ operationId, gatewayId, deviceId, tool: descriptor.name, toolRevision, argumentHash: 'a'.repeat(64),
        authorizationRevision: grant.revision, expiresAt: Date.now() + 10000 }, nextGrantId);
      throw new Error('Lost control reply');
    })).rejects.toMatchObject({ code: 'OUTCOME_UNKNOWN' });
    return intent;
  };
  const first = await lost('control-first');
  expect(hasReviewedDesktopExecutionStop(scope)).toBe(false);
  reviewDesktopOperation(first.operationId, deviceId, gatewayId, body(first));
  expect(hasReviewedDesktopExecutionStop(scope)).toBe(false);
  const second = await lost('control-second');
  revokeDesktopExecutionGrant(deviceId, nextGrantId, grant.revision);
  expect(hasReviewedDesktopExecutionStop(scope)).toBe(false);
  reviewDesktopOperation(second.operationId, deviceId, gatewayId, body(second));
  expect(hasReviewedDesktopExecutionStop(scope)).toBe(true);
  for (const patch of [{ deviceId: randomUUID() }, { gatewayId: randomUUID() }, { authorizationRevision: grant.revision + 1 },
    { toolRevision: 'e'.repeat(64) }, { tool: descriptor.name === REMOTE_COMPUTER_DESCRIPTOR.name ? REMOTE_BROWSER_DESCRIPTOR.name : REMOTE_COMPUTER_DESCRIPTOR.name }]) {
    expect(hasReviewedDesktopExecutionStop({ ...scope, ...patch })).toBe(false);
  }
  expect(getSqliteDatabase().prepare("SELECT count(*) AS count FROM capability_operations WHERE principal_id=? AND state='unknown'").get(deviceId)?.count).toBe(2);
});
