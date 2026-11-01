import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
  spawnSync: vi.fn(),
}));

vi.mock('node:child_process', () => mocks);

vi.mock('electron', () => ({
  app: {
    getAppPath: () => process.cwd(),
    isPackaged: false,
  },
}));

import { spawnGatewayProcess, stopGatewayProcessAndWait } from '../gateway-process.js';

class FakeChildProcess extends EventEmitter {
  pid = 12345;
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  stdout = null;
  stderr = null;
  readonly killSignals: Array<NodeJS.Signals | undefined> = [];

  constructor(private readonly exitOnSigterm: boolean) {
    super();
  }

  kill(signal?: NodeJS.Signals): boolean {
    this.killSignals.push(signal);
    if (signal === 'SIGKILL' || ((!signal || signal === 'SIGTERM') && this.exitOnSigterm)) {
      this.signalCode = signal ?? 'SIGTERM';
      queueMicrotask(() => this.emit('exit', null, signal));
    }
    return true;
  }
}

function spawnFakeGateway(child: FakeChildProcess): void {
  mocks.spawn.mockReturnValue(child as unknown as ChildProcess);
  spawnGatewayProcess({
    configPath: '/tmp/xopc-test/xopc.json',
    workspacePath: '/tmp/xopc-test/workspace',
    port: 18790,
    bind: 'loopback',
  });
}

describe('embedded gateway shutdown', () => {
  beforeEach(() => {
    mocks.spawn.mockReset();
    mocks.spawnSync.mockReset();
    vi.stubGlobal('process', { ...process, platform: 'darwin' });
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

  it('rejects an unconfirmed shutdown and retains the owned handle for cleanup', async () => {
    vi.useFakeTimers();
    const child = new FakeChildProcess(false);
    child.kill = vi.fn(() => false);
    spawnFakeGateway(child);
    const stopped = expect(stopGatewayProcessAndWait(10)).rejects.toThrow('did not exit');
    await vi.advanceTimersByTimeAsync(2010);
    await stopped;
    child.kill = vi.fn(() => {
      child.signalCode = 'SIGKILL';
      queueMicrotask(() => child.emit('exit', null, 'SIGKILL'));
      return true;
    });
    await stopGatewayProcessAndWait(10);
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('waits for a graceful SIGTERM exit', async () => {
    const child = new FakeChildProcess(true);
    spawnFakeGateway(child);

    await stopGatewayProcessAndWait(50);

    expect(child.killSignals).toEqual(['SIGTERM']);
  });

  it('escalates to SIGKILL when the child ignores SIGTERM', async () => {
    const child = new FakeChildProcess(false);
    spawnFakeGateway(child);

    await stopGatewayProcessAndWait(10);

    expect(child.killSignals).toEqual(['SIGTERM', 'SIGKILL']);
  });

  it('stops the owned Windows process tree without opening a console', async () => {
    vi.stubGlobal('process', { ...process, platform: 'win32' });
    const child = new FakeChildProcess(true);
    spawnFakeGateway(child);
    mocks.spawnSync.mockImplementation(() => {
      child.signalCode = 'SIGKILL';
      queueMicrotask(() => child.emit('exit', null, 'SIGKILL'));
      return { status: 0 };
    });
    await stopGatewayProcessAndWait(50);
    expect(mocks.spawnSync).toHaveBeenCalledWith('taskkill', ['/PID', '12345', '/T', '/F'],
      expect.objectContaining({ windowsHide: true, stdio: 'ignore' }));
    expect(child.killSignals).toEqual([]);
  });

  it.each([{ status: 1 }, { status: null, error: new Error('taskkill unavailable') }])('falls back when Windows taskkill fails: %j', async result => {
    vi.stubGlobal('process', { ...process, platform: 'win32' });
    const child = new FakeChildProcess(true);
    spawnFakeGateway(child);
    mocks.spawnSync.mockReturnValue(result);
    await stopGatewayProcessAndWait(50);
    expect(child.killSignals).toEqual([undefined]);
  });
});
