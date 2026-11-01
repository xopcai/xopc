import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { REMOTE_COMPUTER_DESCRIPTOR } from '@xopcai/computer-control-contract';
import { REMOTE_BROWSER_DESCRIPTOR } from '@xopcai/browser-control-contract/remote';
import { endpointToolRevision } from '@xopcai/endpoint-tools-client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { DesktopExecutionLease, DesktopOperationJournal, type DesktopOperationIntent } from '../desktop/operation-journal.js';

let directory: string, lease: DesktopExecutionLease | undefined, journal: DesktopOperationJournal | undefined;
const intent = (): DesktopOperationIntent => ({ operationId: randomUUID(), gatewayId: randomUUID(), deviceId: randomUUID(),
  workspaceId: randomUUID(), tool: 'workspace.write', argumentHash: 'a'.repeat(64), toolRevision: 'd'.repeat(64), authorizationRevision: 1, expiresAt: Date.now() + 60000 });
beforeEach(() => { directory = mkdtempSync(join(tmpdir(), 'xopc-operation-journal-')); });
afterEach(() => { vi.restoreAllMocks(); journal?.close(); lease?.close(); journal = undefined; lease = undefined; rmSync(directory, { recursive: true, force: true }); });

it('requires one physical lease across path aliases and one journal per lease', () => {
  lease = new DesktopExecutionLease(join(directory, 'owner'));
  symlinkSync(join(directory, 'owner'), join(directory, 'alias'));
  expect(() => new DesktopExecutionLease(join(directory, 'alias'))).toThrow('DESKTOP_EXECUTOR_ALREADY_OWNED');
  journal = new DesktopOperationJournal(lease);
  expect(() => new DesktopOperationJournal(lease!)).toThrow('DESKTOP_JOURNAL_ALREADY_ATTACHED');
});

it('preserves terminal receipts and rejects changed intent or automatic duplicate execution', () => {
  lease = new DesktopExecutionLease(directory); journal = new DesktopOperationJournal(lease);
  const operation = intent(); expect(journal.record(operation).fresh).toBe(true); journal.start(operation, { invocationId: randomUUID(), connectionInstanceId: randomUUID() });
  journal.finish(operation, 'succeeded', 'b'.repeat(64));
  expect(journal.record(operation)).toMatchObject({ fresh: false, receipt: { state: 'succeeded', resultHash: 'b'.repeat(64) } });
  expect(() => journal!.start(operation, { invocationId: randomUUID(), connectionInstanceId: randomUUID() })).toThrow('DESKTOP_OPERATION_STATE_INVALID');
  for (const changed of [{ gatewayId: randomUUID() }, { deviceId: randomUUID() }, { workspaceId: randomUUID() }, { argumentHash: 'c'.repeat(64) }, { toolRevision: 'e'.repeat(64) }, { authorizationRevision: 2 }, { expiresAt: operation.expiresAt + 1 }]) {
    expect(() => journal!.record({ ...operation, ...changed })).toThrow('DESKTOP_OPERATION_IDENTITY_MISMATCH');
  }
});

it('never treats cancel requested or a recovered in-flight operation as confirmed stopped', () => {
  lease = new DesktopExecutionLease(directory); journal = new DesktopOperationJournal(lease);
  const operation = intent(); journal.record(operation); journal.start(operation, { invocationId: randomUUID(), connectionInstanceId: randomUUID() }); journal.requestStop(operation);
  expect(journal.inspect(operation)?.state).toBe('cancel-requested');
  journal.close(); lease.close();
  lease = new DesktopExecutionLease(directory); journal = new DesktopOperationJournal(lease);
  expect(journal.record(operation)).toMatchObject({ fresh: false, receipt: { state: 'unknown' } });
  expect(() => journal!.start(operation, { invocationId: randomUUID(), connectionInstanceId: randomUUID() })).toThrow('DESKTOP_OPERATION_STATE_INVALID');
  expect(() => journal!.finish(operation, 'stopped')).toThrow('DESKTOP_OPERATION_STATE_INVALID');
});

it('checks expiry again immediately before execution and refuses writes after lease closure', () => {
  lease = new DesktopExecutionLease(directory); journal = new DesktopOperationJournal(lease);
  expect(() => journal!.record({ ...intent(), expiresAt: Date.now() - 1 })).toThrow('DESKTOP_OPERATION_EXPIRED');
  const operation = intent(); journal.record(operation);
  const clock = vi.spyOn(Date, 'now').mockReturnValue(operation.expiresAt + 1);
  expect(() => journal!.start(operation, { invocationId: randomUUID(), connectionInstanceId: randomUUID() })).toThrow('DESKTOP_OPERATION_EXPIRED');
  clock.mockRestore(); lease.close();
  expect(() => journal!.start(operation, { invocationId: randomUUID(), connectionInstanceId: randomUUID() })).toThrow('DESKTOP_EXECUTOR_LEASE_CLOSED');
});

it('quarantines the writer after a durable-storage error without admitting another operation', () => {
  lease = new DesktopExecutionLease(directory); journal = new DesktopOperationJournal(lease);
  const injector = new DatabaseSync(join(directory, 'operations.db'));
  injector.exec("CREATE TRIGGER fail_intent BEFORE INSERT ON operations BEGIN SELECT RAISE(ABORT, 'injected disk failure'); END;"); injector.close();
  expect(() => journal!.record(intent())).toThrow('injected disk failure');
  expect(() => journal!.record(intent())).toThrow('DESKTOP_JOURNAL_UNAVAILABLE');
});

it('keeps lost durable completion unknown on recovery and refuses another start', () => {
  lease = new DesktopExecutionLease(directory); journal = new DesktopOperationJournal(lease);
  const operation = intent(), invocationId = randomUUID(), connectionInstanceId = randomUUID();
  journal.record(operation); journal.start(operation, { invocationId, connectionInstanceId });
  const injector = new DatabaseSync(join(directory, 'operations.db'));
  injector.exec("CREATE TRIGGER fail_result BEFORE UPDATE ON operations WHEN NEW.state='succeeded' BEGIN SELECT RAISE(ABORT, 'injected result failure'); END;"); injector.close();
  expect(() => journal!.finish(operation, 'succeeded', 'b'.repeat(64))).toThrow('injected result failure');
  journal.close(); lease.close(); lease = new DesktopExecutionLease(directory); journal = new DesktopOperationJournal(lease);
  expect(journal.inspect(operation)).toMatchObject({ state: 'unknown', invocationId, connectionInstanceId });
  expect(() => journal!.start(operation, { invocationId: randomUUID(), connectionInstanceId: randomUUID() })).toThrow('DESKTOP_OPERATION_STATE_INVALID');
});

it('reads a journal fingerprint written by the original v1 intent schema without reinterpreting its identity', () => {
  lease = new DesktopExecutionLease(directory); journal = new DesktopOperationJournal(lease);
  const operation: DesktopOperationIntent = { operationId: '00000000-0000-4000-8000-000000000001', gatewayId: '00000000-0000-4000-8000-000000000002',
    deviceId: '00000000-0000-4000-8000-000000000003', workspaceId: '00000000-0000-4000-8000-000000000004', tool: 'fixture.write',
    argumentHash: 'a'.repeat(64), toolRevision: 'b'.repeat(64), authorizationRevision: 3, expiresAt: 1800000000000 };
  const fixture = new DatabaseSync(join(directory, 'operations.db'));
  fixture.prepare('INSERT INTO operations(operation_id,fingerprint,generation,state,updated_at) VALUES (?,?,?,?,?)')
    .run(operation.operationId, 'a450b44a1b01a48b3c81a656d179208de17ac0b7192851b2ce9862875dd00c13', randomUUID(), 'succeeded', Date.now());
  fixture.close();
  expect(journal.record(operation)).toMatchObject({ fresh: false, receipt: { state: 'succeeded', executionStopped: true } });
});

it('requires independent stop confirmation for a human review and never rewrites or replays the unknown outcome', () => {
  lease = new DesktopExecutionLease(directory); journal = new DesktopOperationJournal(lease);
  const operation = intent(); journal.record(operation); journal.start(operation, { invocationId: randomUUID(), connectionInstanceId: randomUUID() });
  journal.finish(operation, 'unknown');
  const body = { reviewId: randomUUID(), expectedGeneration: 1, intentFingerprint: createHash('sha256').update(JSON.stringify(operation)).digest('hex'), executorStopped: true as const, localStatus: 'recorded' as const, receipt: journal.inspect(operation)! };
  expect(() => journal!.review(operation, body)).toThrow(); expect(journal.hasUnknown()).toBe(true);
  body.receipt = journal.confirmUnknownStopped(operation); journal.review(operation, body);
  expect(journal.hasUnknown()).toBe(false); expect(journal.inspect(operation)).toMatchObject({ state: 'unknown', executionStopped: true });
  expect(journal.record(operation).fresh).toBe(false); journal.review(operation, body); expect(journal.reviewed(operation)).toEqual(body);
  expect(() => journal!.review(operation, { ...body, reviewId: randomUUID() })).toThrow('REVIEW_CONFLICT');
  expect(() => journal!.record({ ...operation, expiresAt: operation.expiresAt + 1 })).toThrow('IDENTITY_MISMATCH');
  journal.close(); lease.close(); lease = new DesktopExecutionLease(directory); journal = new DesktopOperationJournal(lease);
  expect(journal.hasUnknown()).toBe(false); expect(journal.record(operation).fresh).toBe(false);
});
it.each(['clipboard', 'computer', 'browser'] as const)('makes a permanent unknown tombstone for an explicitly reviewed operation that never started: %s', kind => {
  lease = new DesktopExecutionLease(directory); journal = new DesktopOperationJournal(lease);
  const operation = { ...intent(), ...(kind === 'clipboard' ? { tool: 'desktop.clipboard.write' }
    : { workspaceId: undefined, tool: kind === 'browser' ? REMOTE_BROWSER_DESCRIPTOR.name : REMOTE_COMPUTER_DESCRIPTOR.name,
      toolRevision: endpointToolRevision((kind === 'browser' ? REMOTE_BROWSER_DESCRIPTOR : REMOTE_COMPUTER_DESCRIPTOR) as never) }) };
  const body = { reviewId: randomUUID(), expectedGeneration: 1, intentFingerprint: createHash('sha256').update(JSON.stringify(operation)).digest('hex'), executorStopped: true as const, localStatus: 'not-found' as const };
  expect(journal.inspect(operation)).toBeUndefined(); journal.review(operation, body); journal.review(operation, body);
  expect(journal.inspect(operation)).toMatchObject({ state: 'unknown', executionStopped: true }); expect(journal.hasUnknown()).toBe(false);
  expect(journal.record(operation).fresh).toBe(false);
  expect(() => journal!.record({ ...operation, deviceId: randomUUID() })).toThrow('IDENTITY_MISMATCH');
  if (kind === 'computer') for (const patch of [{ toolRevision: 'b'.repeat(64) }, { workspaceId: randomUUID() }]) {
    const invalid = { ...operation, operationId: randomUUID(), ...patch };
    expect(() => journal!.review(invalid, { ...body, reviewId: randomUUID(), intentFingerprint: createHash('sha256').update(JSON.stringify(invalid)).digest('hex') })).toThrow('STOP_UNCONFIRMED');
  }
  const unsafe = { ...intent(), tool: 'workspace.command' };
  expect(() => journal!.review(unsafe, { ...body, reviewId: randomUUID(), intentFingerprint: createHash('sha256').update(JSON.stringify(unsafe)).digest('hex') })).toThrow('STOP_UNCONFIRMED');
});

it('enumerates an exact crashed grant generation including successful operations and rejects a mismatched scope', () => {
  lease = new DesktopExecutionLease(directory); journal = new DesktopOperationJournal(lease);
  const operation = intent(); journal.record(operation); journal.start(operation, { invocationId: randomUUID(), connectionInstanceId: randomUUID() });
  journal.finish(operation, 'succeeded', 'f'.repeat(64));
  const scope = { gatewayId: operation.gatewayId, deviceId: operation.deviceId, authorizationRevision: operation.authorizationRevision };
  expect(journal.generationIntents(lease.generation, scope)).toEqual([operation]);
  expect(journal.generationIntents(randomUUID(), scope)).toEqual([]);
  expect(() => journal!.generationIntents(lease!.generation, { ...scope, deviceId: randomUUID() })).toThrow('IDENTITY_MISMATCH');
  expect(journal.inspect(operation)).toMatchObject({ state: 'succeeded', executionStopped: true });
});
