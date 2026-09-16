import { createServer, type Server } from 'node:http';

import { afterEach, describe, expect, it, vi } from 'vitest';
import { COMPUTER_DESCRIPTOR } from '@xopcai/computer-control-contract';
import { ENDPOINT_PROTOCOL_VERSION } from '@xopcai/endpoint-tools-protocol';
import { REALTIME_PROTOCOL_VERSION } from '@xopcai/realtime-protocol';

vi.mock('electron', () => ({
  app: {
    getAppPath: () => process.cwd(),
    isPackaged: false,
  },
}));

import {
  getGatewayConnection,
  getGatewayCredential,
  registerGatewayConnection,
  resolveGatewayStartupMode,
  waitForGatewayReady,
} from '../gateway-process.js';

const servers: Server[] = [];

function listen(server: Server, port = 0): Promise<number> {
  servers.push(server);
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const address = server.address();
      if (address && typeof address === 'object') {
        resolve(address.port);
      } else {
        reject(new Error('Server did not report a TCP port'));
      }
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

async function allocateFreePort(): Promise<number> {
  const server = createServer();
  const port = await listen(server);
  await closeServer(server);
  servers.splice(servers.indexOf(server), 1);
  return port;
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map((server) =>
      closeServer(server).catch(() => {
        /* already closed */
      }),
    ),
  );
});

describe('resolveGatewayStartupMode', () => {
  it('reuses an existing gateway that accepts the configured token', async () => {
    const token = 'configured-token';
    const server = createServer((req, res) => {
      if (req.url === '/api/config' && req.headers.authorization === `Bearer ${token}`) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{}');
        return;
      }
      if (req.url === '/api/endpoint-tools/compatibility' && req.headers.authorization === `Bearer ${token}`) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, payload: { realtimeProtocolVersion: REALTIME_PROTOCOL_VERSION,
          endpointProtocolVersion: ENDPOINT_PROTOCOL_VERSION, computerControl: { ...COMPUTER_DESCRIPTOR, title: 'Updated display title' } } }));
        return;
      }
      res.writeHead(401);
      res.end();
    });
    const port = await listen(server);

    await expect(resolveGatewayStartupMode({ port, token, bindHost: '127.0.0.1' })).resolves.toBe(
      'reuse',
    );
  });

  it('spawns when the configured port is free', async () => {
    const port = await allocateFreePort();

    await expect(
      resolveGatewayStartupMode({ port, token: 'configured-token', bindHost: '127.0.0.1' }),
    ).resolves.toBe('spawn');
  });

  it.each(['missing', 'old-contract', 'old-realtime', 'old-endpoint', 'html'])('rejects %s gateways before reuse and after spawn', async (variant) => {
    const server = createServer((req, res) => {
      if (req.url === '/api/config') { res.end('{}'); return; }
      if (variant === 'missing') { res.writeHead(404); res.end(); return; }
      if (variant === 'html') { res.end('<html>not an API</html>'); return; }
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: true, payload: {
        realtimeProtocolVersion: variant === 'old-realtime' ? -1 : REALTIME_PROTOCOL_VERSION,
        endpointProtocolVersion: variant === 'old-endpoint' ? -1 : ENDPOINT_PROTOCOL_VERSION,
        computerControl: variant === 'old-contract' ? { ...COMPUTER_DESCRIPTOR, inputSchema: {} } : COMPUTER_DESCRIPTOR,
      } }));
    });
    const port = await listen(server);
    const failure = { failure: { kind: 'gateway_protocol_incompatible', port } };
    await expect(resolveGatewayStartupMode({ port, token: 'test', bindHost: '127.0.0.1' })).rejects.toMatchObject(failure);
    await expect(waitForGatewayReady(port, 'test', { exitCode: null, signalCode: null } as any, 2000)).rejects.toMatchObject(failure);
    expect(server.listening).toBe(true);
  });

  it('fails when the port is occupied by a process with a different token', async () => {
    const server = createServer((_req, res) => {
      res.writeHead(401);
      res.end();
    });
    const port = await listen(server);

    await expect(
      resolveGatewayStartupMode({ port, token: 'configured-token', bindHost: '127.0.0.1' }),
    ).rejects.toThrow(`Gateway port ${port} is already in use`);
  });
});

describe('gateway connection', () => {
  it('stores connection details independently from gateway process ownership', () => {
    registerGatewayConnection({ port: 18790, token: 'dev-token' });

    expect(getGatewayConnection()).toEqual({ port: 18790, token: 'dev-token' });
    expect(getGatewayCredential()).toBe('dev-token');
  });
});
