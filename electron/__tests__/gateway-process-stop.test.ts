import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';

import { beforeEach, describe, expect, it, vi } from 'vitest';

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
    if (signal === 'SIGKILL' || (signal === 'SIGTERM' && this.exitOnSigterm)) {
      this.signalCode = signal;
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
});
