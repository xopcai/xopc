import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { FrpcProcessHandle } from '../frpc-process.js';
import type { PersistedTunnelState } from '../tunnel-types.js';

const mocks = vi.hoisted(() => ({
  spawnFrpcProcess: vi.fn(),
}));

vi.mock('../frpc-process.js', () => ({
  spawnFrpcProcess: mocks.spawnFrpcProcess,
}));

import { TunnelService } from '../tunnel-service.js';

type FakeHandle = FrpcProcessHandle & {
  exit(code?: number | null, signal?: NodeJS.Signals | null): void;
};

function createHandle(pid: number): FakeHandle {
  let exitHandler: ((code: number | null, signal: NodeJS.Signals | null) => void) | undefined;
  const handle: FakeHandle = {
    pid,
    waitForLoginSuccess: Promise.resolve(),
    onExit: (handler) => {
      exitHandler = handler;
    },
    kill: vi.fn(async () => {
      exitHandler?.(null, 'SIGTERM');
    }),
    exit: (code = 1, signal = null) => {
      exitHandler?.(code, signal);
    },
  };
  return handle;
}

const persistedState: PersistedTunnelState = {
  tunnelId: 't_lifecycle',
  tunnelToken: 'tunnel-token',
  subdomain: 'lifecycle',
  publicUrl: 'https://lifecycle.frp.xopc.ai',
  frpcAuthToken: 'frpc-token',
  registeredAt: new Date().toISOString(),
  enabled: true,
};

describe('TunnelService frpc lifecycle', () => {
  let previousStateDir: string | undefined;
  let stateDir: string;

  beforeEach(() => {
    previousStateDir = process.env.XOPC_STATE_DIR;
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-tunnel-lifecycle-'));
    process.env.XOPC_STATE_DIR = stateDir;
    mocks.spawnFrpcProcess.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (previousStateDir === undefined) delete process.env.XOPC_STATE_DIR;
    else process.env.XOPC_STATE_DIR = previousStateDir;
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('does not reconnect when replacing the current frpc handle intentionally', async () => {
    const first = createHandle(101);
    const second = createHandle(102);
    mocks.spawnFrpcProcess.mockReturnValueOnce(first).mockReturnValueOnce(second);

    const service = new TunnelService();
    const reconnect = vi.fn().mockResolvedValue(undefined);
    const internal = service as unknown as {
      spawnAndWait(
        frpcBin: string,
        configPath: string,
        broker: { heartbeat: () => Promise<void> },
        state: PersistedTunnelState,
        heartbeatIntervalMs: number,
      ): Promise<void>;
      scheduleReconnect: typeof reconnect;
    };
    internal.scheduleReconnect = reconnect;
    const broker = { heartbeat: vi.fn().mockResolvedValue(undefined) };

    await internal.spawnAndWait('/tmp/frpc', '/tmp/first.toml', broker, persistedState, 30_000);
    await internal.spawnAndWait('/tmp/frpc', '/tmp/second.toml', broker, persistedState, 30_000);

    expect(first.kill).toHaveBeenCalledOnce();
    expect(reconnect).not.toHaveBeenCalled();

    await service.stop();
  });

  it('reconnects when the active frpc handle exits unexpectedly', async () => {
    const handle = createHandle(201);
    mocks.spawnFrpcProcess.mockReturnValueOnce(handle);

    const service = new TunnelService();
    const reconnect = vi.fn().mockResolvedValue(undefined);
    const internal = service as unknown as {
      spawnAndWait(
        frpcBin: string,
        configPath: string,
        broker: { heartbeat: () => Promise<void> },
        state: PersistedTunnelState,
        heartbeatIntervalMs: number,
      ): Promise<void>;
      scheduleReconnect: typeof reconnect;
    };
    internal.scheduleReconnect = reconnect;
    const broker = { heartbeat: vi.fn().mockResolvedValue(undefined) };

    await internal.spawnAndWait('/tmp/frpc', '/tmp/current.toml', broker, persistedState, 30_000);
    handle.exit(1);

    expect(reconnect).toHaveBeenCalledOnce();
    await service.stop();
  });
});
