import { randomUUID } from 'node:crypto';
import type { DesktopTerminalInput } from '@xopcai/endpoint-tools-protocol';

import { expect, it, vi } from 'vitest';

import { DesktopTerminalBroker, type DesktopTerminalScope } from '../desktop/terminal-broker.js';
import type { DesktopTerminalWorker } from '../desktop/terminal-worker.js';
import type { DesktopOperationSupervisor } from '../desktop/operation-supervisor.js';

function fixture() {
  const scope: DesktopTerminalScope = { gatewayId: randomUUID(), deviceId: randomUUID(), workspaceId: randomUUID(), authorizationRevision: 1,
    sessionId: randomUUID(), generation: randomUUID(), connectionInstanceId: randomUUID() };
  const intent = { operationId: randomUUID(), gatewayId: scope.gatewayId, deviceId: scope.deviceId, workspaceId: scope.workspaceId,
    authorizationRevision: 1, tool: 'desktop.terminal.open', argumentHash: 'a'.repeat(64), toolRevision: 'b'.repeat(64), expiresAt: Date.now() + 60000 };
  const worker = { ready: Promise.resolve(scope), stop: vi.fn(async () => ({ confirmed: true })), input: vi.fn(async () => ({ dispatch: 'accepted' })),
    acknowledge: vi.fn(), resize: vi.fn(async () => {}) };
  let current = true;
  const options = { current: () => current, confirmOpen: vi.fn(async () => true), confirmInput: vi.fn(async (_scope: DesktopTerminalScope, _input: DesktopTerminalInput, _signal: AbortSignal) => true), emit: vi.fn(),
    create: vi.fn(() => ({ worker: worker as unknown as DesktopTerminalWorker, supervisor: { execute: vi.fn(({ signal }: { signal: AbortSignal }) => new Promise(resolve => {
      const finish = () => resolve({ receipt: { state: 'stopped', executionStopped: true } });
      signal.addEventListener('abort', finish, { once: true }); if (signal.aborted) finish();
    })) } as unknown as DesktopOperationSupervisor })) };
  const broker = new DesktopTerminalBroker(options);
  const open = { scope, intent, args: { workspaceId: scope.workspaceId, argv: ['/bin/sh'] }, invocationId: randomUUID(), signal: new AbortController().signal };
  const input = { sessionId: scope.sessionId, generation: scope.generation, connectionInstanceId: scope.connectionInstanceId,
    inputId: randomUUID(), sequence: 1, bytes: Buffer.from('private fixture').toString('base64') };
  return { broker, scope, intent, open, input, worker, options, revoke: () => { current = false; } };
}

it('opens a running root only after consent, fences remote scopes and never skips native stdin approval', async () => {
  const f = fixture();
  try {
    expect(await f.broker.open(f.open)).toMatchObject({ state: 'running', executionStopped: false, operationId: f.intent.operationId });
    for (const change of [{ deviceId: randomUUID() }, { gatewayId: randomUUID() }, { workspaceId: randomUUID() }, { generation: randomUUID() }, { connectionInstanceId: randomUUID() }, { authorizationRevision: 2 }]) {
      await expect(f.broker.input({ ...f.scope, ...change }, f.input, new AbortController().signal)).rejects.toThrow('AUTHORITY_INVALID');
    }
    f.options.confirmInput.mockResolvedValueOnce(false);
    await expect(f.broker.input(f.scope, f.input, new AbortController().signal)).rejects.toThrow('USER_DENIED');
    expect(f.worker.input).not.toHaveBeenCalled();
    expect(await f.broker.input(f.scope, f.input, new AbortController().signal)).toMatchObject({ dispatch: 'accepted' });
    expect(f.options.confirmInput).toHaveBeenCalledTimes(2); expect(f.worker.input).toHaveBeenCalledOnce();
    await expect(f.broker.input(f.scope, { ...f.input, source: 'local-user' }, new AbortController().signal)).rejects.toThrow();
    expect(f.worker.input).toHaveBeenCalledOnce();
    expect(await f.broker.stop()).toEqual({ confirmed: true });
    await expect(f.broker.input(f.scope, f.input, new AbortController().signal)).rejects.toThrow('AUTHORITY_INVALID');
    await expect(f.broker.open(f.open)).rejects.toThrow('BUSY');
  } finally { await f.broker.stop(); }
});

it('starts no executor after denied or stale open consent, and aborts a pending native input when stopped', async () => {
  const f = fixture(); f.options.confirmOpen.mockResolvedValueOnce(false);
  await expect(f.broker.open(f.open)).rejects.toThrow('USER_DENIED'); expect(f.options.create).not.toHaveBeenCalled();
  f.options.confirmOpen.mockImplementationOnce(async () => { f.revoke(); return true; });
  await expect(f.broker.open(f.open)).rejects.toThrow('AUTHORITY_INVALID'); expect(f.options.create).not.toHaveBeenCalled();
  const g = fixture();
  try {
    await g.broker.open(g.open);
    let reached!: () => void; const waiting = new Promise<void>(resolve => { reached = resolve; });
    g.options.confirmInput.mockImplementationOnce(async (_scope, _input, signal) => { reached(); return new Promise((_resolve, reject) => { signal.addEventListener('abort', () => reject(new Error('fixture approval aborted')), { once: true }); }); });
    const input = g.broker.input(g.scope, g.input, new AbortController().signal), rejected = expect(input).rejects.toThrow('approval aborted');
    await waiting; await expect(g.broker.input(g.scope, g.input, new AbortController().signal)).rejects.toThrow('INPUT_BUSY');
    expect(await g.broker.stop()).toEqual({ confirmed: true }); await rejected; expect(g.worker.input).not.toHaveBeenCalled();
  } finally { await g.broker.stop(); }
});

it('rejects failed root startup instead of waiting forever for terminal readiness, and keeps unconfirmed stop blocked', async () => {
  const f = fixture(); f.worker.ready = new Promise(() => {});
  f.options.create.mockImplementationOnce(() => ({ worker: f.worker as unknown as DesktopTerminalWorker,
    supervisor: { execute: async () => { throw new Error('fixture journal blocked'); } } as unknown as DesktopOperationSupervisor }));
  await expect(f.broker.open(f.open)).rejects.toThrow('journal blocked');
  expect(await f.broker.stop()).toEqual({ confirmed: false });
  await expect(f.broker.open(f.open)).rejects.toThrow('BUSY');
  const g = fixture();
  await g.broker.open(g.open); g.worker.stop.mockResolvedValueOnce({ confirmed: false });
  expect(await g.broker.stop()).toEqual({ confirmed: false });
  await expect(g.broker.input(g.scope, g.input, new AbortController().signal)).rejects.toThrow('AUTHORITY_INVALID');
  expect(await g.broker.stop()).toEqual({ confirmed: true });
});

it('keeps the original three-second stop budget and never treats a closed root transport as resource stop proof', async () => {
  const f = fixture(); await f.broker.open(f.open);
  vi.useFakeTimers();
  try {
    f.worker.stop.mockImplementationOnce(() => new Promise(() => {}));
    const stop = f.broker.stop();
    await vi.advanceTimersByTimeAsync(2999);
    let finished = false; void stop.then(() => { finished = true; }); await Promise.resolve(); expect(finished).toBe(false);
    await vi.advanceTimersByTimeAsync(1); expect(await stop).toEqual({ confirmed: false });
    await expect(f.broker.input(f.scope, f.input, new AbortController().signal)).rejects.toThrow('AUTHORITY_INVALID');
    expect(await f.broker.stop()).toEqual({ confirmed: true });
  } finally { vi.useRealTimers(); }
});

it('fences a late native open approval after an offline stop even when the dialog callback ignores cancellation', async () => {
  const f = fixture(); let approve!: (accepted: boolean) => void;
  f.options.confirmOpen.mockImplementationOnce(() => new Promise(resolve => { approve = resolve; }));
  const open = f.broker.open(f.open), rejected = expect(open).rejects.toThrow();
  expect(await f.broker.stop()).toEqual({ confirmed: true });
  approve(true); await rejected; expect(f.options.create).not.toHaveBeenCalled();
  await expect(f.broker.open(f.open)).rejects.toThrow('BUSY');
});
