import { getEventListeners } from 'node:events';
import { createServer, type RequestListener } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import { fetchWithTimeoutGuarded } from '../index.js';

describe('provider request cancellation lifecycle', () => {
  const servers: ReturnType<typeof createServer>[] = [];
  afterEach(async () => {
    await Promise.all(servers.map(server => { server.closeAllConnections(); return new Promise<void>(done => server.close(() => done())); }));
    servers.length = 0;
  });
  async function serverFor(handler: RequestListener) {
    const server = createServer(handler); servers.push(server);
    await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }
  it('does not retain request controllers on a shared job signal after many audio segments', async () => {
    const url = await serverFor((_request, response) => response.end('ok'));
    const job = new AbortController();
    for (let segment = 0; segment < 100; segment++) {
      const response = await fetchWithTimeoutGuarded(url, { timeoutMs: 1_000, label: 'STT', allowPrivateNetwork: true, signal: job.signal });
      await response.text();
      expect(getEventListeners(job.signal, 'abort')).toHaveLength(0);
    }
  });
  it('removes the relay after a real transport disconnection', async () => {
    const url = await serverFor(request => request.socket.destroy());
    const job = new AbortController();
    await expect(fetchWithTimeoutGuarded(url, { timeoutMs: 1_000, label: 'STT', allowPrivateNetwork: true, signal: job.signal })).rejects.toThrow();
    expect(getEventListeners(job.signal, 'abort')).toHaveLength(0);
  });
  it('still aborts an in-flight request and releases its listener', async () => {
    let received!: () => void; const requestStarted = new Promise<void>(done => { received = done; });
    const url = await serverFor(() => { received(); });
    const job = new AbortController();
    const request = fetchWithTimeoutGuarded(url, { timeoutMs: 1_000, label: 'STT', allowPrivateNetwork: true, signal: job.signal });
    const rejected = expect(request).rejects.toThrow('Cancelled job');
    await requestStarted; job.abort(new Error('Cancelled job')); await rejected;
    expect(getEventListeners(job.signal, 'abort')).toHaveLength(0);
  });
  it('keeps caller cancellation connected while consuming a response body after headers arrive', async () => {
    const url = await serverFor((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/plain' }); response.write('partial');
    });
    const job = new AbortController();
    const response = await fetchWithTimeoutGuarded(url, { timeoutMs: 1_000, label: 'STT', allowPrivateNetwork: true, signal: job.signal });
    const rejected = expect(response.text()).rejects.toThrow();
    job.abort(new Error('Cancelled body read')); await rejected;
    expect(getEventListeners(job.signal, 'abort')).toHaveLength(0);
  });
});
