import { once } from 'node:events';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { expect, it } from 'vitest';
import { createComputerFlowNetworkProxy } from '../lib/computer-flow-network-proxy.mjs';
const { WebSocket, WebSocketServer } = createRequire(import.meta.url)('ws') as typeof import('ws');

it('preserves text frames and auth rejection codes; loses only a completed act result and still forwards release', async () => {
  const http = createServer((req, res) => {
    expect(req.headers.authorization).toBe('Bearer test-owner');
    res.writeHead(201); req.pipe(res);
  });
  const ws = new WebSocketServer({ server: http });
  await new Promise<void>(r => http.listen(0, '127.0.0.1', r));
  const proxy = createComputerFlowNetworkProxy((http.address() as any).port);
  await new Promise<void>(r => proxy.http.listen(0, '127.0.0.1', r));
  const port = (proxy.http.address() as any).port;
  let client: import('ws').WebSocket | undefined;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/endpoint-tools/principals`, {
      method: 'POST', headers: { Authorization: 'Bearer test-owner' }, body: 'unchanged request bytes',
    });
    expect(response.status).toBe(201); expect(await response.text()).toBe('unchanged request bytes'); expect(proxy.counts.registrations).toBe(1);
    const connected = once(ws, 'connection');
    client = new WebSocket(`ws://127.0.0.1:${port}/api/realtime/v1/ws`);
    const [backend] = await connected as [import('ws').WebSocket];
    if (client.readyState !== WebSocket.OPEN) await once(client, 'open');
    const hello = once(backend, 'message'); client.send(JSON.stringify({ kind: 'realtime.hello', payload: {} }));
    const [bytes, binary] = await hello; expect(binary).toBe(false); expect(JSON.parse(bytes.toString()).kind).toBe('realtime.hello');
    const invoke = (id: string, op: string) => JSON.stringify({ kind: 'endpoint.message', payload: { type: 'tool.invoke', payload: { invocationId: id, arguments: { op } } } });
    const next = once(client, 'message'); backend.send(invoke('act-1', 'act'));
    const [received, isBinary] = await next; expect(isBinary).toBe(false); expect(received.toString()).toBe(invoke('act-1', 'act'));
    proxy.arm();
    const result = (id: string, value: unknown) => JSON.stringify({ kind: 'endpoint.message', payload: { type: 'tool.result', payload: {
      invocationId: id, content: [{ type: 'json', value }],
    } } });
    const pending = once(backend, 'message'); client.send(result('act-1', { status: 'pending_action' }));
    expect(JSON.parse((await pending)[0].toString()).payload.payload.invocationId).toBe('act-1'); expect(proxy.state().lost).toBe(false);
    client.send(result('act-1', { receipt: { dispatch: 'completed' }, observation: { summary: JSON.stringify({ text: 'Verified Native Flow Destination' }) } }));
    // A later forwarded message is a transport-order barrier for the deliberately missing result.
    const released = once(backend, 'message'); client.send(result('release-1', { status: 'stopped' }));
    expect(JSON.parse((await released)[0].toString()).payload.payload.invocationId).toBe('release-1');
    expect(proxy.state()).toEqual({ lost: true, effect: true }); expect(proxy.counts.droppedResults).toBe(1); expect(proxy.counts.actAfterLoss).toBe(0);
    const close = once(client, 'close'); backend.close(4401, 'Realtime authentication failed'); expect((await close)[0]).toBe(4401);
  } finally {
    client?.terminate(); await proxy.close(); ws.close(); await new Promise<void>(r => http.close(() => r()));
  }
}, 10_000);
