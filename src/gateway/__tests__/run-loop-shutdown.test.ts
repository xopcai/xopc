import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  acquireGatewayLock: vi.fn(),
  releaseLock: vi.fn(),
}));

vi.mock('../../config/commands.flags.js', () => ({
  isRestartEnabled: vi.fn(() => false),
}));

vi.mock('../../config/index.js', () => ({
  loadConfig: vi.fn(() => ({})),
}));

vi.mock('../../migrations/runner.js', () => ({
  runBootstrapMigrationsSync: vi.fn(),
}));

vi.mock('../lock.js', () => ({
  acquireGatewayLock: mocks.acquireGatewayLock,
}));

vi.mock('../respawn.js', () => ({
  restartGatewayProcessWithFreshPid: vi.fn(() => ({ mode: 'disabled' })),
}));

vi.mock('../../infra/restart.js', () => ({
  consumeGatewayRestartIntentSync: vi.fn(() => false),
  consumeGatewaySigusr1RestartAuthorization: vi.fn(() => false),
  isGatewaySigusr1RestartExternallyAllowed: vi.fn(() => false),
  resetGatewayRestartStateForInProcessRestart: vi.fn(),
  scheduleGatewaySigusr1Restart: vi.fn(),
  setGatewaySigusr1RestartPolicy: vi.fn(),
}));

import type { GatewayServer } from '../server.js';
import { runGatewayLoop } from '../run-loop.js';

describe('gateway run-loop shutdown', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps SIGINT controlled while closing and returns after releasing the lock', async () => {
    mocks.releaseLock.mockResolvedValue(undefined);
    mocks.acquireGatewayLock.mockResolvedValue({ release: mocks.releaseLock });

    let finishClose: (() => void) | undefined;
    const close = vi.fn(
      () => new Promise<void>((resolve) => {
        finishClose = resolve;
      }),
    );
    const forceCloseConnections = vi.fn();
    const start = vi.fn(async () => ({ close, forceCloseConnections }) as unknown as GatewayServer);
    const existingSigintListeners = new Set(process.listeners('SIGINT'));
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const running = runGatewayLoop({ configPath: '/tmp/xopc-test.json', port: 18790, start });
    await vi.waitFor(() => expect(start).toHaveBeenCalledOnce());

    const onSigint = process
      .listeners('SIGINT')
      .find((listener) => !existingSigintListeners.has(listener));
    expect(onSigint).toBeDefined();

    onSigint!();
    await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(process.listeners('SIGINT')).toContain(onSigint);

    onSigint!();
    expect(forceCloseConnections).toHaveBeenCalledOnce();

    finishClose!();
    await running;

    expect(mocks.releaseLock).toHaveBeenCalledOnce();
    expect(process.listeners('SIGINT')).not.toContain(onSigint);
  });

  it('force exits when shutdown still hangs after connections were force closed', async () => {
    mocks.releaseLock.mockResolvedValue(undefined);
    mocks.acquireGatewayLock.mockResolvedValue({ release: mocks.releaseLock });

    let finishClose: (() => void) | undefined;
    const close = vi.fn(
      () => new Promise<void>((resolve) => {
        finishClose = resolve;
      }),
    );
    const forceCloseConnections = vi.fn();
    const start = vi.fn(async () => ({ close, forceCloseConnections }) as unknown as GatewayServer);
    const existingSigintListeners = new Set(process.listeners('SIGINT'));
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const running = runGatewayLoop({ configPath: '/tmp/xopc-test.json', port: 18790, start });
    await vi.waitFor(() => expect(start).toHaveBeenCalledOnce());

    const onSigint = process
      .listeners('SIGINT')
      .find((listener) => !existingSigintListeners.has(listener));
    expect(onSigint).toBeDefined();

    onSigint!();
    await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
    onSigint!();
    expect(forceCloseConnections).toHaveBeenCalledOnce();

    onSigint!();
    expect(exit).toHaveBeenCalledWith(0);

    finishClose!();
    await running;
  });
});
