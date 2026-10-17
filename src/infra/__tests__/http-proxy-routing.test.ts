import { createServer, request, type Server } from 'node:http';
import { connect, type Socket } from 'node:net';
import { once } from 'node:events';
import { getGlobalDispatcher, setGlobalDispatcher } from 'undici';
import { expect, it } from 'vitest';

import { configureGatewayHttpProxy } from '../http-proxy-env.js';

async function listen(server: Server): Promise<number> {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return (server.address() as { port: number }).port;
}

it('routes real fetch through a configured HTTP proxy and keeps loopback direct', async () => {
  const previous = getGlobalDispatcher();
  const sockets = new Set<Socket>();
  const origin = createServer((_req, res) => res.end('proxy-routing-ok'));
  const originPort = await listen(origin);
  const targets: string[] = [];
  const proxy = createServer((req, res) => {
    targets.push(new URL(req.url!).host);
    const upstream = request({ host: '127.0.0.1', port: originPort, path: new URL(req.url!).pathname }, response => {
      res.writeHead(response.statusCode!, response.headers);
      response.pipe(res);
    });
    upstream.on('error', () => res.destroy());
    req.pipe(upstream);
  });
  proxy.on('connect', (req, client, head) => {
    targets.push(req.url!);
    const upstream = connect(originPort, '127.0.0.1', () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      upstream.write(head);
      client.pipe(upstream).pipe(client);
    });
    sockets.add(upstream);
    upstream.on('error', () => client.destroy());
    client.on('error', () => upstream.destroy());
  });
  for (const server of [origin, proxy]) server.on('connection', socket => sockets.add(socket));
  const proxyPort = await listen(proxy);
  try {
    configureGatewayHttpProxy({ mode: 'custom', url: `http://127.0.0.1:${proxyPort}`, noProxy: '' }, { HTTP_PROXY: 'http://invalid.invalid', NO_PROXY: '*' });
    expect(await (await fetch('http://provider.invalid/probe', { signal: AbortSignal.timeout(3000) })).text()).toBe('proxy-routing-ok');
    expect(targets).toEqual(['provider.invalid']);
    expect(await (await fetch(`http://127.0.0.1:${originPort}/probe`)).text()).toBe('proxy-routing-ok');
    expect(targets).toHaveLength(1);
    await getGlobalDispatcher().close();
    configureGatewayHttpProxy({ mode: 'direct', url: '', noProxy: '' }, { HTTP_PROXY: `http://127.0.0.1:${proxyPort}` });
    expect(await (await fetch(`http://127.0.0.1:${originPort}/direct`)).text()).toBe('proxy-routing-ok');
    expect(targets).toHaveLength(1);
    await getGlobalDispatcher().close();
    configureGatewayHttpProxy(undefined, { HTTP_PROXY: `http://127.0.0.1:${proxyPort}`, NO_PROXY: '*' });
    expect(await (await fetch(`http://127.0.0.1:${originPort}/environment`)).text()).toBe('proxy-routing-ok');
    expect(targets).toHaveLength(1);
  } finally {
    const current = getGlobalDispatcher();
    setGlobalDispatcher(previous);
    await current.destroy();
    for (const socket of sockets) socket.destroy();
    await Promise.all([origin, proxy].map(server => new Promise<void>(resolve => server.close(() => resolve()))));
  }
});
