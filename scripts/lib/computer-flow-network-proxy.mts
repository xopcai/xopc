/** Transparent loopback fault proxy for the opt-in live matrix; never used by production. */
import assert from 'node:assert/strict';
import { EXPECT } from './computer-flow-network-target.mjs';
import { createServer, request as httpRequest } from 'node:http';
import { createRequire } from 'node:module';
const { WebSocket, WebSocketServer } = createRequire(import.meta.url)('ws') as typeof import('ws');

export function createComputerFlowNetworkProxy(gatewayPort: number) {
  const counts = { registrations: 0, tickets: 0, uploads: 0, hellos: 0, invokes: 0, droppedResults: 0, actAfterLoss: 0 };
  const invocations = new Map<string, string>(); const sockets = new Set<import('ws').WebSocket>();
  let fault = false, lost = false, effect = false;
  const http = createServer((req, res) => {
    const path = req.url ?? '';
    const upstream = httpRequest({ hostname: '127.0.0.1', port: gatewayPort, method: req.method, path, headers: req.headers }, answer => {
      if (answer.statusCode && answer.statusCode >= 200 && answer.statusCode < 300) {
        if (path === '/api/endpoint-tools/principals') counts.registrations++;
        if (path === '/api/realtime/tickets') counts.tickets++;
        if (/\/invocations\/.*\/files\?/.test(path)) counts.uploads++;
      }
      res.writeHead(answer.statusCode!, answer.headers); answer.pipe(res);
    });
    upstream.on('error', () => { res.writeHead(502); res.end(); }); req.pipe(upstream);
  });
  const ws = new WebSocketServer({ server: http, path: '/api/realtime/v1/ws' });
  ws.on('connection', downstream => {
    const upstream = new WebSocket(`ws://127.0.0.1:${gatewayPort}/api/realtime/v1/ws`);
    sockets.add(downstream); sockets.add(upstream);
    const queue: Buffer[] = [];
    upstream.on('open', () => { for (const data of queue.splice(0)) upstream.send(data, { binary: false }); });
    downstream.on('message', data => {
      const bytes = Buffer.from(data as any), outer = JSON.parse(bytes.toString());
      if (outer.kind === 'realtime.hello') counts.hellos++;
      const message = outer.kind === 'endpoint.message' ? outer.payload : undefined;
      if (message?.type === 'tool.result' && invocations.get(message.payload.invocationId) === 'act' && fault) {
        const result = message.payload.content.find((c: any) => c.type === 'json')?.value;
        if (result?.receipt?.dispatch === 'completed') {
          assert.equal(counts.droppedResults, 0, 'Never lose more than one result');
          effect = JSON.parse(result.observation.summary).text.includes(EXPECT.text); assert.ok(effect);
          counts.droppedResults++; lost = true; return;
        }
      }
      if (upstream.readyState === WebSocket.OPEN) upstream.send(bytes, { binary: false }); else queue.push(bytes);
    });
    upstream.on('message', data => {
      const outer = JSON.parse(data.toString()), message = outer.kind === 'endpoint.message' ? outer.payload : undefined;
      if (message?.type === 'tool.invoke') {
        counts.invokes++; invocations.set(message.payload.invocationId, message.payload.arguments.op);
        if (lost && message.payload.arguments.op === 'act') counts.actAfterLoss++;
      }
      if (downstream.readyState === WebSocket.OPEN) downstream.send(data, { binary: false });
    });
    downstream.on('close', () => { sockets.delete(downstream); upstream.close(); }); upstream.on('close', code => { sockets.delete(upstream); downstream.close(code >= 3000 && code < 5000 ? code : 1000); });
    downstream.on('error', () => upstream.terminate()); upstream.on('error', () => downstream.terminate());
  });
  return { http, counts, arm: () => { fault = true; }, state: () => ({ lost, effect }), close: async () => {
    for (const s of sockets) s.terminate(); ws.close(); await new Promise<void>(r => http.close(() => r()));
  } };
}
