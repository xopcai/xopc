import { createServer, type Server } from 'node:http';

import { afterEach, describe, expect, it, vi } from 'vitest';

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
