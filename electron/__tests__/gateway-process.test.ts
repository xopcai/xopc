import { createServer, type Server } from 'node:http';

import { afterEach, describe, expect, it, vi } from 'vitest';
import { COMPUTER_DESCRIPTOR, COMPUTER_FRAME_MAX_BYTES } from '@xopcai/computer-control-contract';
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
  getGatewayConnectionDescriptor,
  isEmbeddedGatewayRegistered,
  registerEmbeddedGatewayRuntime,
  registerGatewayConnection,
  restartEmbeddedGatewayFromSavedConfig,
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
          computerFrameUploadMaxBytes: COMPUTER_FRAME_MAX_BYTES,
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

  it.each(['missing', 'old-contract', 'old-realtime', 'old-endpoint', 'old-upload-limit', 'html'])('rejects %s gateways before reuse and after spawn', async (variant) => {
    const server = createServer((req, res) => {
      if (req.url === '/api/config') { res.end('{}'); return; }
      if (variant === 'missing') { res.writeHead(404); res.end(); return; }
      if (variant === 'html') { res.end('<html>not an API</html>'); return; }
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: true, payload: {
        realtimeProtocolVersion: variant === 'old-realtime' ? -1 : REALTIME_PROTOCOL_VERSION,
        computerFrameUploadMaxBytes: variant === 'old-upload-limit' ? 1024 * 1024 : COMPUTER_FRAME_MAX_BYTES,
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

it('reports authenticated readiness promptly without skipping compatibility checks', async () => {
  vi.useFakeTimers();
  let available = false;
  let ready: number | undefined;
  const fetch = vi.fn(async (url: string, options?: RequestInit) => {
    expect(options?.headers).toEqual({ Authorization: 'Bearer readiness-test' });
    if (url.endsWith('/api/config')) return new Response('{}', { status: available ? 200 : 503 });
    expect(url).toContain('/api/endpoint-tools/compatibility');
    return Response.json({ ok: true, payload: { realtimeProtocolVersion: REALTIME_PROTOCOL_VERSION,
      computerFrameUploadMaxBytes: COMPUTER_FRAME_MAX_BYTES, endpointProtocolVersion: ENDPOINT_PROTOCOL_VERSION,
      computerControl: COMPUTER_DESCRIPTOR } });
  });
  vi.stubGlobal('fetch', fetch);
  const pending = waitForGatewayReady(12345, 'readiness-test', { exitCode: null, signalCode: null } as any, 2000)
    .then(port => { ready = port; });
  try {
    await vi.advanceTimersByTimeAsync(1);
    expect(ready).toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(1);
    available = true;
    await vi.advanceTimersByTimeAsync(149);
    expect(ready).toBe(12345);
    expect(fetch).toHaveBeenCalledTimes(3);
  } finally {
    available = true;
    await vi.advanceTimersByTimeAsync(2000);
    await pending;
    vi.unstubAllGlobals();
    vi.useRealTimers();
  }
});

describe('gateway connection', () => {
  const runtime = { port: 18790, authToken: 'owned', bind: 'loopback' as const,
    configPath: '/tmp/isolated/xopc.json', workspacePath: '/tmp/isolated/workspace' };

  it('rejects concurrent restarts and a connection replacement while credentials are resolving', async () => {
    registerEmbeddedGatewayRuntime(runtime);
    let release!: (value: { port: number; token: string; bind: 'loopback'; bindHost: string }) => void;
    const pending = new Promise<{ port: number; token: string; bind: 'loopback'; bindHost: string }>(resolve => { release = resolve; });
    const resolveCredentials = vi.fn(() => pending);
    const params = { configPath: runtime.configPath, workspacePath: runtime.workspacePath, resolveCredentials };
    const first = restartEmbeddedGatewayFromSavedConfig(params);
    await vi.waitFor(() => expect(resolveCredentials).toHaveBeenCalledTimes(1));
    await expect(restartEmbeddedGatewayFromSavedConfig(params)).rejects.toThrow('already in progress');
    registerGatewayConnection({ port: 18791, token: 'external' });
    const rejected = expect(first).rejects.toThrow('connection changed');
    release({ port: 18790, token: 'owned', bind: 'loopback', bindHost: '127.0.0.1' });
    await rejected;
    expect(getGatewayConnection()).toEqual({ port: 18791, token: 'external' });
    expect(isEmbeddedGatewayRegistered()).toBe(false);
    // A failed attempt releases the restart lock as well as preserving the successor.
    registerEmbeddedGatewayRuntime(runtime);
    await expect(restartEmbeddedGatewayFromSavedConfig({ ...params,
      resolveCredentials: async () => { throw new Error('credential fixture'); } })).rejects.toThrow('credential fixture');
    registerGatewayConnection({ port: 18791, token: 'external' });
  });

  it('reuses a compatible service at the saved port without claiming its process', async () => {
    const token = 'existing-service';
    const server = createServer((request, response) => {
      if (request.headers.authorization !== `Bearer ${token}`) { response.writeHead(401).end(); return; }
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify(request.url === '/api/config' ? {} : { ok: true, payload: {
        realtimeProtocolVersion: REALTIME_PROTOCOL_VERSION, endpointProtocolVersion: ENDPOINT_PROTOCOL_VERSION,
        computerFrameUploadMaxBytes: COMPUTER_FRAME_MAX_BYTES, computerControl: COMPUTER_DESCRIPTOR,
      } }));
    });
    const port = await listen(server);
    registerEmbeddedGatewayRuntime(runtime);
    await expect(restartEmbeddedGatewayFromSavedConfig({ configPath: runtime.configPath,
      workspacePath: runtime.workspacePath, resolveCredentials: async () => ({
        port, token, bind: 'loopback', bindHost: '127.0.0.1',
      }) })).resolves.toEqual({ port, token });
    expect(server.listening).toBe(true);
    expect(getGatewayConnectionDescriptor()).toMatchObject({ ownership: 'external-local', port });
    expect(isEmbeddedGatewayRegistered()).toBe(false);
  });

  it('stores connection details independently from gateway process ownership', () => {
    registerGatewayConnection({ port: 18790, token: 'dev-token' });

    expect(getGatewayConnection()).toEqual({ port: 18790, token: 'dev-token' });
    expect(getGatewayCredential()).toBe('dev-token');
  });

  it('does not leave embedded restart authority attached to a reused external connection', async () => {
    registerEmbeddedGatewayRuntime({ port: 18790, authToken: 'owned', bind: 'loopback',
      configPath: '/tmp/isolated/xopc.json', workspacePath: '/tmp/isolated/workspace' });
    expect(isEmbeddedGatewayRegistered()).toBe(true);
    expect(getGatewayConnectionDescriptor()).toMatchObject({ ownership: 'embedded', mode: 'local' });
    registerGatewayConnection({ port: 18791, token: 'external' });
    expect(isEmbeddedGatewayRegistered()).toBe(false);
    expect(getGatewayConnectionDescriptor()).toMatchObject({ ownership: 'external-local', port: 18791 });
    const resolveCredentials = vi.fn();
    await expect(restartEmbeddedGatewayFromSavedConfig({ configPath: '/tmp/isolated/xopc.json',
      workspacePath: '/tmp/isolated/workspace', resolveCredentials })).rejects.toThrow('not registered');
    expect(resolveCredentials).not.toHaveBeenCalled();
  });
});
