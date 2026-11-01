import { randomUUID } from 'node:crypto';

import { COMPUTER_CONTROL_TOOL, COMPUTER_DESCRIPTOR, REMOTE_COMPUTER_CONTROL_TOOL, REMOTE_COMPUTER_DESCRIPTOR, type ComputerCommand } from '@xopcai/computer-control-contract';
import { endpointToolRevision } from '@xopcai/endpoint-tools-client';
import { beforeEach, expect, it, vi } from 'vitest';

import { EndpointToolExecutionError } from '../../endpoint-tools/invocation-service.js';
import type { EndpointToolRuntime } from '../../endpoint-tools/runtime.js';
import { requireXopcDatabase } from '../../storage/sqlite/connection.js';
import { getSqliteDatabase } from '../../storage/sqlite/transaction.js';
import { invokeComputerCommand } from '../endpoint-transport.js';

beforeEach(() => { requireXopcDatabase(); });
function fixture(remote = true) {
  const deviceId = randomUUID();
  const descriptor = remote ? REMOTE_COMPUTER_DESCRIPTOR : COMPUTER_DESCRIPTOR;
  const tool = { descriptor, revision: endpointToolRevision(descriptor as never) };
  const endpoint = { endpointId: 'endpoint-' + randomUUID(), principalId: deviceId, connectionId: randomUUID(), availability: 'foreground',
    executionAuthority: remote ? { deviceId, gatewayId: randomUUID(), grantId: randomUUID(), connectionInstanceId: randomUUID(), authorizationRevision: 1, expiresAt: Date.now() + 120000 } : undefined };
  const invoke = vi.fn(async (_input: { operationId?: string }) => ({ content: [{ type: 'json', value: { fixture: 'completed' } }] }));
  const get = vi.fn(() => endpoint), getTool = vi.fn((_id: string, name: string) => name === descriptor.name ? tool : undefined);
  const runtime = { registry: { get, getTool }, invocations: { invoke } } as unknown as EndpointToolRuntime;
  const sessionId = randomUUID();
  const command: ComputerCommand = { op: 'act', owner: randomUUID(), sessionId, envelope: {
    actionId: randomUUID(), sessionId, observationId: randomUUID(), brokerEpoch: randomUUID(), generation: 1,
    grantId: randomUUID(), deadlineAt: Date.now() + 25000,
    action: { kind: 'click', point: { x: 200, y: 100 }, button: 'left', count: 1 },
  } };
  return { runtime, endpoint, invoke, get, getTool, command, call: () => invokeComputerCommand(runtime, endpoint.endpointId, command) };
}
it('keeps the existing local transport free of remote operation identity and native policy changes', async () => {
  const f = fixture(false);
  await f.call();
  expect(f.invoke).toHaveBeenCalledWith(expect.objectContaining({ toolName: COMPUTER_CONTROL_TOOL }));
  expect(f.invoke.mock.calls[0][0]).not.toHaveProperty('operationId');
  expect(getSqliteDatabase().prepare('SELECT count(*) AS n FROM capability_operations WHERE principal_id=?').get(f.endpoint.principalId)).toEqual({ n: 0 });
});
it('commits a remote intent before invocation and returns cached metadata instead of dispatching an action twice', async () => {
  const f = fixture();
  f.invoke.mockImplementationOnce(async input => {
    expect(getSqliteDatabase().prepare('SELECT state FROM capability_operations WHERE operation_id=?').get(input.operationId)).toEqual({ state: 'running' });
    return { content: [{ type: 'json', value: { fixture: 'completed' } }] };
  });
  const first = await f.call();
  expect(f.invoke).toHaveBeenCalledWith(expect.objectContaining({ toolName: REMOTE_COMPUTER_CONTROL_TOOL, operationId: expect.any(String) }));
  expect(await f.call()).toEqual(first); expect(f.invoke).toHaveBeenCalledOnce();
});
it('uses the existing external-operation lease without shortening the thirty-second native call after dispatch overhead', async () => {
  const epoch = Date.now(); let ticks = 0;
  const clock = vi.spyOn(Date, 'now').mockImplementation(() => epoch + ticks++);
  try {
    const f = fixture();
    f.invoke.mockImplementationOnce(async input => {
      const row = getSqliteDatabase().prepare('SELECT lease_expires_at FROM capability_operations WHERE operation_id=?').get(input.operationId) as { lease_expires_at: number };
      expect(row.lease_expires_at).toBeGreaterThan(Date.now() + REMOTE_COMPUTER_DESCRIPTOR.timeoutMs);
      return { content: [{ type: 'json', value: { fixture: 'completed' } }] };
    });
    await f.call(); expect(REMOTE_COMPUTER_DESCRIPTOR.timeoutMs).toBe(30000);
  } finally { clock.mockRestore(); }
});
it('never replays an unknown action and rejects changed arguments for the same action identity', async () => {
  const f = fixture();
  f.invoke.mockRejectedValueOnce(new Error('fixture lost signed result'));
  await expect(f.call()).rejects.toMatchObject({ code: 'OUTCOME_UNKNOWN' });
  await expect(f.call()).rejects.toMatchObject({ code: 'OUTCOME_UNKNOWN' });
  expect(f.invoke).toHaveBeenCalledOnce();
  if (f.command.op !== 'act') throw new Error('Unexpected fixture');
  f.command.envelope.action = { kind: 'click', point: { x: 300, y: 100 }, button: 'left', count: 1 };
  await expect(f.call()).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
  expect(f.invoke).toHaveBeenCalledOnce();
});
it('distinguishes explicitly denied input from network uncertainty and gives new observations separate identities', async () => {
  const f = fixture();
  f.invoke.mockRejectedValueOnce(new EndpointToolExecutionError('USER_DENIED', 'fixture denied'));
  await expect(f.call()).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  const id = f.invoke.mock.calls[0][0].operationId;
  expect(getSqliteDatabase().prepare('SELECT state FROM capability_operations WHERE operation_id=?').get(id)).toEqual({ state: 'failed' });
  const command: ComputerCommand = { op: 'observe', owner: 'conversation', sessionId: 'session' };
  await invokeComputerCommand(f.runtime, f.endpoint.endpointId, command);
  await invokeComputerCommand(f.runtime, f.endpoint.endpointId, command);
  expect(f.invoke.mock.calls[1][0].operationId).not.toBe(f.invoke.mock.calls[2][0].operationId);
});
it('refuses changed connection authority and never falls back to the local transport for a remote grant', async () => {
  const f = fixture();
  f.getTool.mockReturnValueOnce(undefined);
  await expect(f.call()).rejects.toThrow('UPGRADE_REQUIRED');
  expect(f.invoke).not.toHaveBeenCalled();
  let reads = 0;
  const initial = structuredClone(f.endpoint);
  f.get.mockImplementation(() => ++reads === 1 ? initial : { ...f.endpoint, connectionId: randomUUID() });
  await expect(f.call()).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  expect(f.invoke).not.toHaveBeenCalled();
});
