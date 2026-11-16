/** Live native iOS A/B against the active local Gateway's existing official tunnel. */
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { Agent, request as requestHTTPS } from 'node:https';
import type { Socket } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import ws from 'ws';

const pairs = Number(process.argv[2] ?? 6);
assert.ok(Number.isSafeInteger(pairs) && pairs >= 1 && pairs <= 16, 'Pass 1–16 paired samples');
const state = process.env.XOPC_STATE_DIR ?? join(homedir(), '.xopc');
const config = JSON.parse(await readFile(process.env.XOPC_CONFIG_PATH ?? join(state, 'xopc.json'), 'utf8'));
const token = process.env.XOPC_GATEWAY_TOKEN || config.gateway?.auth?.token;
assert.ok(token, 'Gateway owner credential is required');
const base = `http://127.0.0.1:${config.gateway?.port ?? 18790}`;
const response = await fetch(base + '/api/tunnel/status', {
  headers: { Authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(3000),
});
assert.equal(response.status, 200);
const envelope = await response.json() as { payload?: { state: string; publicUrl: string }; state: string; publicUrl: string };
const status = envelope.payload ?? envelope;
assert.equal(status.state, 'connected');
const origin = new URL(status.publicUrl);
assert.ok(origin.protocol === 'https:' && !origin.username && !origin.password && !origin.port &&
  /^[a-z0-9]{4,16}\.frp\.xopc\.ai$/.test(origin.hostname), 'An official FRP address is required');

const fixturePath = '/' + randomUUID();
const sockets = new Set<Socket>();
const resultDirectory = await mkdtemp(join(tmpdir(), 'xopc-ios-realtime-'));
const resultBundle = join(resultDirectory, 'benchmark.xcresult');
const model = process.env.XOPC_IOS_REALTIME_MODEL ?? 'deepseek/deepseek-flash';
const agent = new Agent({ keepAlive: true });
const websockets = new ws.WebSocketServer({ noServer: true });
const publicSocket = new URL('/api/realtime/v1/ws', origin);
publicSocket.protocol = 'wss:';
const relay = createServer((request, response) => {
  if (request.method === 'GET' && request.url === fixturePath) {
    const port = (relay.address() as { port: number }).port;
    return response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify({
      origin: `http://127.0.0.1:${port}`, token, pairs, model,
    }));
  }
  if (!request.url?.startsWith('/api/')) return response.writeHead(404).end();
  const route = request.url.replace(/\/sessions\/[^/?]+/g, '/sessions/:id').split('?')[0];
  const headers = { ...request.headers, host: origin.host };
  const upstream = requestHTTPS(new URL(request.url, origin), { method: request.method, headers, agent, timeout: 15_000 }, reply => {
    if (process.env.XOPC_IOS_REALTIME_DEBUG) process.stderr.write(`FRP ${request.method} ${route} ${reply.statusCode}\n`);
    response.writeHead(reply.statusCode ?? 502, reply.headers);
    reply.once('error', () => response.destroy());
    reply.pipe(response);
  });
  upstream.once('timeout', () => upstream.destroy());
  upstream.once('error', (error: NodeJS.ErrnoException) => {
    if (process.env.XOPC_IOS_REALTIME_DEBUG) process.stderr.write(`FRP ${request.method} ${route} ${error.code ?? 'error'}\n`);
    if (!response.headersSent) response.writeHead(502).end();
    else response.destroy();
  });
  request.once('error', () => upstream.destroy());
  response.once('close', () => { if (!response.writableEnded) upstream.destroy(); });
  request.pipe(upstream);
});
relay.on('connection', socket => {
  sockets.add(socket);
  socket.once('close', () => sockets.delete(socket));
});
// Keep URLSession on loopback. Every HTTP call and socket still traverses the same FRP, with normal upstream TLS validation.
relay.on('upgrade', (request, client, head) => {
  if (request.url !== publicSocket.pathname) return client.destroy();
  const upstream = new ws(publicSocket, { handshakeTimeout: 12_000 });
  upstream.once('open', () => websockets.handleUpgrade(request, client, head, downstream => {
    downstream.on('message', (data, binary) => upstream.send(data, { binary }));
    upstream.on('message', (data, binary) => downstream.send(data, { binary }));
    downstream.once('error', () => upstream.terminate());
    upstream.once('close', (code, reason) => {
      if (code === 1005 || code === 1006) downstream.terminate();
      else downstream.close(code, reason);
    });
  }));
  upstream.once('error', () => {
    if (process.env.XOPC_IOS_REALTIME_DEBUG) process.stderr.write('FRP websocket upgrade failed\n');
    client.destroy();
  });
  client.once('error', () => upstream.terminate());
  client.once('close', () => upstream.terminate());
});
relay.listen(0, '127.0.0.1');
await once(relay, 'listening');
const port = (relay.address() as { port: number }).port;
const child = spawn('xcodebuild', [
  '-project', 'apps/mobile-ios/XopcMobile.xcodeproj', '-scheme', 'XopcMobile',
  '-destination', process.env.XOPC_IOS_REALTIME_DESTINATION ?? 'platform=iOS Simulator,name=iPhone 17 Pro',
  '-derivedDataPath', process.env.XOPC_IOS_REALTIME_DERIVED_DATA ?? join(resultDirectory, 'DerivedData'),
  '-only-testing:XopcMobileTests/RealtimeRunFRPTests/testLiveReuseAndResume', '-parallel-testing-enabled', 'NO',
  '-test-timeouts-enabled', 'YES', '-maximum-test-execution-time-allowance', '300',
  '-resultBundlePath', resultBundle, 'CODE_SIGNING_ALLOWED=YES', 'CODE_SIGN_IDENTITY=-', 'test',
], { env: { ...process.env, TEST_RUNNER_XOPC_IOS_RUN_STREAM_FIXTURE: `http://127.0.0.1:${port}${fixturePath}` },
  stdio: 'inherit' });
try {
  const [exit] = await once(child, 'exit');
  console.log(JSON.stringify({ model, pairs, resultBundle }));
  if (exit === 0) {
    const summary = JSON.parse(execFileSync('xcrun', ['xcresulttool', 'get', 'test-results', 'summary', '--path', resultBundle],
      { encoding: 'utf8' })) as { passedTests: number; skippedTests: number };
    assert.equal(summary.passedTests, 1, 'The live FRP test must run and pass');
    assert.equal(summary.skippedTests, 0, 'The live FRP test cannot be skipped');
  } else {
    process.exitCode = 1;
  }
} finally {
  for (const socket of sockets) socket.destroy();
  agent.destroy();
  websockets.close();
  relay.close();
}
