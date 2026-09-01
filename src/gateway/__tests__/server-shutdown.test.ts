import type { Socket } from 'node:net';

import type { ServerType } from '@hono/node-server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { GatewayServer } from '../server.js';

describe('GatewayServer shutdown', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('destroys upgraded sockets that keep the HTTP close callback pending', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'log').mockImplementation(() => {});

    let finishClose: (() => void) | undefined;
    const rawServer = {
      close: vi.fn((callback: () => void) => {
        finishClose = callback;
      }),
      closeAllConnections: vi.fn(),
    } as unknown as ServerType;
    const socket = { destroy: vi.fn() } as unknown as Socket;
    let finishServiceStop: (() => void) | undefined;
    const service = {
      stop: vi.fn(
        () => new Promise<void>((resolve) => {
          finishServiceStop = resolve;
        }),
      ),
    };
    const gateway = Object.create(GatewayServer.prototype) as GatewayServer;
    Object.assign(gateway, {
      server: rawServer,
      extraServers: [],
      serverSockets: new Map([[rawServer, new Set([socket])]]),
      service,
    });

    const stopping = gateway.stop();

    expect(rawServer.close).toHaveBeenCalledOnce();
    expect(service.stop).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(2000);
    expect(rawServer.closeAllConnections).toHaveBeenCalledOnce();
    expect(socket.destroy).toHaveBeenCalledOnce();

    finishServiceStop!();
    finishClose!();
    await stopping;
  });
});
