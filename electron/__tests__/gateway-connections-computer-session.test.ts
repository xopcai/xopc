import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { canonicalJson, type DesktopOperationIntent } from '@xopcai/endpoint-tools-protocol';
import { expect, it, vi } from 'vitest';

import { ComputerBroker, type ComputerDriver } from '../../src/computer/broker.js';
import { DesktopComputerSession } from '../desktop/computer-session.js';
import { DesktopExecutionLease, DesktopOperationJournal } from '../desktop/operation-journal.js';
import { DesktopOperationSupervisor } from '../desktop/operation-supervisor.js';

const model = { modelRef: 'fixture/gui', profile: 'gui-plus-2026-02-26' as const, origin: 'https://model.invalid', runtimeLocation: 'remote' as const };
const target = { appId: 'fixture', pid: 1, processIdentity: '1:100', windowId: '10', width: 800, height: 600, geometryRevision: '1' };
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'xopc-computer-operation-'));
  const lease = new DesktopExecutionLease(root), journal = new DesktopOperationJournal(lease);
  let current = true, approve = true;
  const driver: ComputerDriver = {
    discover: vi.fn(async () => [{ appId: 'fixture', name: 'Fixture', running: true }]),
    resolveTarget: vi.fn(async () => target),
    observe: vi.fn(async () => ({ target, summary: 'fixture', stateDigest: 'a', image: new Uint8Array([1, 2, 3]), mimeType: 'image/png', imageWidth: 800, imageHeight: 600 })),
    perform: vi.fn(async () => {}), stop: vi.fn(async () => {}),
  };
  const requestApproval = vi.fn(async () => approve);
  let broker: ComputerBroker | undefined;
  const createBroker = vi.fn(() => {
    expect(journal.inspect(activeIntent!)?.state).toBe('running');
    return broker = new ComputerBroker(driver, { deferApproval: false, isVisible: () => current, requestApproval }, { enabled: true });
  });
  const uploadFrame = vi.fn(async () => ({ type: 'file' as const, fileId: randomUUID(), name: 'observation.png', mimeType: 'image/png', size: 3, sha256: 'a'.repeat(64) }));
  const session = new DesktopComputerSession({ current: () => current, createBroker, uploadFrame });
  const gatewayId = randomUUID(), deviceId = randomUUID(), connectionInstanceId = randomUUID();
  let activeIntent: DesktopOperationIntent | undefined;
  const supervisor = new DesktopOperationSupervisor({ journal, createWorker: (_tool, intent) => session.worker(intent!), authority: () => ({ gatewayId, deviceId, authorizationRevision: 1, toolRevision: 'a'.repeat(64), active: current, expiresAt: Date.now() + 120000 }) });
  const execute = (args: Record<string, unknown>, signal = new AbortController().signal, supplied?: DesktopOperationIntent) => {
    const intent = supplied ?? { operationId: randomUUID(), gatewayId, deviceId, tool: 'desktop.computer.remote_control', toolRevision: 'a'.repeat(64), authorizationRevision: 1,
      argumentHash: createHash('sha256').update(canonicalJson(args)).digest('hex'), expiresAt: Date.now() + 60000 };
    activeIntent = intent;
    return { intent, outcome: supervisor.execute({ intent, arguments: args, signal, invocationId: randomUUID(), connectionInstanceId }) };
  };
  return { journal, driver, createBroker, requestApproval, uploadFrame, session, supervisor, execute,
    revoke: () => { current = false; }, deny: () => { approve = false; },
    close: async () => { await session.stop(); await broker?.dispose(); journal.close(); lease.close(); await rm(root, { recursive: true, force: true }); } };
}
async function open(f: Awaited<ReturnType<typeof fixture>>) {
  const discovery = await f.execute({ op: 'discover', owner: 'conversation', sessionId: 'discovery', query: 'Fixture' }).outcome;
  const appRef = (discovery.result as any).content[0].value.apps[0].appRef;
  return await f.execute({ op: 'open', owner: 'conversation', sessionId: 'session', appRef, mode: 'control', prepare: false, model }).outcome;
}
it('creates the private broker only after the durable intent and reuses the dedicated Computer protocol without repeating an operation', async () => {
  const f = await fixture();
  try {
    expect(f.createBroker).not.toHaveBeenCalled();
    await open(f);
    const args = { op: 'observe', owner: 'conversation', sessionId: 'session' };
    const invocation = f.execute(args), outcome = await invocation.outcome;
    expect(outcome.receipt.state).toBe('succeeded');
    expect(f.uploadFrame).toHaveBeenCalledOnce();
    const frame = f.uploadFrame.mock.calls[0][0]; expect([...frame.bytes]).toEqual([0, 0, 0]);
    expect((await f.execute(args, undefined, invocation.intent).outcome).repeated).toBe(true);
    expect(f.uploadFrame).toHaveBeenCalledOnce();
    expect(f.createBroker).toHaveBeenCalledOnce();
    const observation = (outcome.result as any).content[0].value;
    const action = await f.execute({ op: 'act', owner: 'conversation', sessionId: 'session', envelope: {
      actionId: randomUUID(), sessionId: 'session', observationId: observation.observation.id, brokerEpoch: observation.brokerEpoch,
      generation: observation.generation, grantId: observation.grantId, deadlineAt: Date.now() + 30000,
      action: { kind: 'click', point: { x: 200, y: 100 }, button: 'left', count: 1 },
    } }).outcome;
    expect(action.receipt.state).toBe('succeeded'); expect(f.driver.perform).toHaveBeenCalledOnce();
    expect(f.requestApproval).toHaveBeenCalledTimes(2);
  } finally { await f.close(); }
});
it('keeps grants separate by conversation owner and rejects a worker stopped before run without creating any driver', async () => {
  const f = await fixture();
  try {
    await open(f);
    const other = await f.execute({ op: 'status', owner: 'other', sessionId: 'session' }).outcome;
    expect(other.receipt.state).toBe('unknown'); expect(f.driver.perform).not.toHaveBeenCalled();
    expect(f.supervisor.status().blocked).toBe(true);
  } finally { await f.close(); }
  const g = await fixture();
  try {
    const intent = { operationId: randomUUID(), gatewayId: randomUUID(), deviceId: randomUUID(), tool: 'desktop.computer.remote_control', toolRevision: 'a'.repeat(64), authorizationRevision: 1, argumentHash: 'b'.repeat(64), expiresAt: Date.now() + 30000 };
    const worker = g.session.worker(intent); expect(await worker.stop()).toEqual({ confirmed: true });
    await expect(worker.run({ op: 'discover', owner: 'conversation', sessionId: 'discovery', query: '' }, new AbortController().signal)).rejects.toThrow('AUTHORITY_INVALID');
    expect(g.createBroker).not.toHaveBeenCalled();
  } finally { await g.close(); }
});
it('preserves unknown and blocks retries when the verified input frame upload is lost', async () => {
  const f = await fixture();
  try {
    await open(f);
    const observed = await f.execute({ op: 'observe', owner: 'conversation', sessionId: 'session' }).outcome;
    const value = (observed.result as any).content[0].value;
    f.uploadFrame.mockRejectedValueOnce(new Error('fixture lost upload receipt'));
    const operation = f.execute({ op: 'act', owner: 'conversation', sessionId: 'session', envelope: {
      actionId: randomUUID(), sessionId: 'session', observationId: value.observation.id, brokerEpoch: value.brokerEpoch,
      generation: value.generation, grantId: value.grantId, deadlineAt: Date.now() + 30000,
      action: { kind: 'click', point: { x: 200, y: 100 }, button: 'left', count: 1 },
    } });
    const result = await operation.outcome;
    expect(result.receipt.state).toBe('unknown'); expect(f.driver.perform).toHaveBeenCalledOnce();
    expect(f.supervisor.status().blocked).toBe(true);
    expect(f.driver.stop).toHaveBeenCalled();
  } finally { await f.close(); }
});
it('keeps native session denial free of target preparation and verifies stop independently before closing', async () => {
  const f = await fixture();
  try {
    f.deny();
    const result = await open(f);
    expect((result.result as any).content[0].value.status).toBe('stopped');
    expect(f.driver.resolveTarget).not.toHaveBeenCalled();
    expect(f.driver.perform).not.toHaveBeenCalled();
    vi.mocked(f.driver.stop).mockRejectedValueOnce(new Error('fixture stop unconfirmed'));
    expect(await f.session.stop()).toEqual({ confirmed: false });
    expect(await f.session.stop()).toEqual({ confirmed: true });
  } finally { await f.close(); }
});
it('aborts an outstanding native approval and never prepares the target after a late approval', async () => {
  const f = await fixture();
  try {
    const discovery = await f.execute({ op: 'discover', owner: 'conversation', sessionId: 'discovery', query: 'Fixture' }).outcome;
    const appRef = (discovery.result as any).content[0].value.apps[0].appRef;
    let approve!: (value: boolean) => void;
    f.requestApproval.mockImplementationOnce(() => new Promise<boolean>(resolve => { approve = resolve; }));
    const controller = new AbortController();
    const operation = f.execute({ op: 'open', owner: 'conversation', sessionId: 'session', appRef, mode: 'control', prepare: true, model }, controller.signal);
    await vi.waitFor(() => expect(f.requestApproval).toHaveBeenCalledOnce());
    controller.abort();
    const result = await operation.outcome;
    expect(['unknown', 'stopped']).toContain(result.receipt.state);
    expect(result.receipt.executionStopped).toBe(true);
    approve(true);
    await new Promise(resolve => setImmediate(resolve));
    expect(f.driver.resolveTarget).not.toHaveBeenCalled();
    expect(f.driver.perform).not.toHaveBeenCalled();
    expect(f.supervisor.status().blocked).toBe(true);
  } finally { await f.close(); }
});
