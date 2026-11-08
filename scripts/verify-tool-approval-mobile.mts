import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, request as httpRequest } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { AgentDefaultsSchema } from '../src/agent-config/schema.js';
import { seedTestAgentCatalog } from '../src/agent-catalog/test-support.js';
import { ConfigSchema } from '../src/config/schema.js';
import { closeXopcDatabase, openXopcDatabase } from '../src/storage/sqlite/connection.js';
import { ensureSessionRecord } from '../src/storage/sqlite/session-repository.js';
import { appendTranscriptEntry } from '../src/storage/sqlite/transcript-repository.js';

// Isolated real Gateway/tool fixture for native UI tests. Only inference and the
// expiry deadline are controlled; approval responses use production endpoints.
const root = await mkdtemp(join(tmpdir(), 'xopc-mobile-approval-'));
const evidence = resolve(process.env.XOPC_APPROVAL_EVIDENCE ?? '/tmp/xopc-tool-approval-mobile');
await mkdir(evidence, { recursive: true });
const token = randomUUID();
let port = 0;
let setupId: string | undefined;
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2', '-keyout', join(root, 'ca.key'),
  '-out', join(evidence, 'test-root.pem'), '-subj', '/CN=xopc isolated approval CA',
  '-addext', 'basicConstraints=critical,CA:TRUE', '-addext', 'keyUsage=critical,keyCertSign,cRLSign'], { stdio: 'ignore' });
execFileSync('openssl', ['req', '-new', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(root, 'tls.key'),
  '-out', join(root, 'tls.csr'), '-subj', '/CN=localhost'], { stdio: 'ignore' });
await writeFile(join(root, 'tls.ext'), 'basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=IP:127.0.0.1,DNS:localhost\n');
execFileSync('openssl', ['x509', '-req', '-in', join(root, 'tls.csr'), '-CA', join(evidence, 'test-root.pem'), '-CAkey', join(root, 'ca.key'),
  '-CAcreateserial', '-out', join(root, 'tls.crt'), '-days', '2', '-extfile', join(root, 'tls.ext')], { stdio: 'ignore' });
const tls = createHttpsServer({ key: await readFile(join(root, 'tls.key')), cert: await readFile(join(root, 'tls.crt')) }, (req, res) => {
  const upstream = httpRequest({ host: '127.0.0.1', port, path: req.url, method: req.method, headers: req.headers }, response => {
    res.writeHead(response.statusCode!, response.headers); response.pipe(res);
  });
  upstream.on('error', () => res.destroy()); req.pipe(upstream);
});
tls.on('upgrade', (req, socket, head) => {
  const upstream = connect(port, '127.0.0.1', () => {
    upstream.write(`${req.method} ${req.url} HTTP/1.1\r\n${req.rawHeaders.reduce((lines, value, index) => lines + (index % 2 ? value + '\r\n' : value + ': '), '')}\r\n`);
    if (head.length) upstream.write(head); socket.pipe(upstream); upstream.pipe(socket);
  });
  upstream.on('error', () => socket.destroy()); socket.on('error', () => upstream.destroy());
  socket.on('close', () => upstream.destroy());
});
tls.listen(0, '127.0.0.1'); await once(tls, 'listening');
const tlsAddress = tls.address(); assert(tlsAddress && typeof tlsAddress !== 'string');
const secureGateway = `https://127.0.0.1:${tlsAddress.port}`;
const phases = ['ios_approve', 'ios_deny', 'ios_expire', 'android_approve', 'android_deny', 'android_expire'];
const conversations = Object.fromEntries(phases.map(phase => [phase, randomUUID()]));
const requestedExecutions: string[] = [];
async function count(phase: string) {
  try { return (await readFile(join(root, `${phase}.executed`), 'utf8')).split('\n').filter(Boolean).length; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0; throw error; }
}
function waitFor(phase: string) {
  const db = new DatabaseSync(join(root, 'xopc.db'), { readOnly: true });
  try {
    const rows = db.prepare('SELECT data_json FROM session_clarification_waits WHERE conversation_id = ?').all(conversations[phase]);
    return rows.map(row => JSON.parse(row.data_json as string)).at(-1);
  } finally { db.close(); }
}
const lab = createServer(async (req, res) => {
  try {
    const url = new URL(req.url!, 'http://localhost');
    if (url.pathname.startsWith('/lab/')) {
      assert.equal(req.headers.authorization, `Bearer ${token}`);
      if (url.pathname === '/lab/pair') {
        const response = await fetch(`http://127.0.0.1:${port}/api/device-pairing/setups`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ targetKind: 'mobile' }) });
        const body = await response.json() as { setup: { id: string } }; assert(response.ok); setupId = body.setup.id;
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(body)); return;
      }
      const phase = url.searchParams.get('phase'); assert(phase && phases.includes(phase));
      if (url.pathname === '/lab/reset') {
        assert.equal(req.method, 'POST');
        const response = await fetch(`http://127.0.0.1:${port}/api/sessions/${conversations[phase]}/reset`,
          { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: '{}' });
        assert(response.ok);
        const db = new DatabaseSync(join(root, 'xopc.db'));
        db.prepare('DELETE FROM session_clarification_waits WHERE conversation_id = ?').run(conversations[phase]);
        db.prepare("DELETE FROM durable_state WHERE namespace = 'command-receipts' AND scope = ?").run(conversations[phase]); db.close();
        await rm(join(root, `${phase}.executed`), { force: true });
        openXopcDatabase(); appendTranscriptEntry(conversations[phase], { role: 'user', content: `Approval ${phase} fixture ready.`, timestamp: Date.now() }); closeXopcDatabase();
      }
      if (url.pathname === '/lab/expire') {
        assert.equal(req.method, 'POST');
        const wait = waitFor(phase); assert(wait && wait.status === 'open');
        wait.expiresAt = Date.now() + 12000;
        const db = new DatabaseSync(join(root, 'xopc.db'));
        db.prepare('UPDATE session_clarification_waits SET data_json = ? WHERE id = ?').run(JSON.stringify(wait), wait.id); db.close();
      }
      const wait = waitFor(phase);
      const db = new DatabaseSync(join(root, 'xopc.db'), { readOnly: true });
      const receipts = db.prepare("SELECT payload FROM durable_state WHERE namespace = 'command-receipts' AND scope = ?")
        .all(conversations[phase]).map(row => JSON.parse(row.payload as string)); db.close();
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ count: await count(phase), wait, receipts,
        requestedExecutions: requestedExecutions.filter(value => value === phase).length }));
      return;
    }
    let source = ''; for await (const chunk of req) source += chunk;
    const body = JSON.parse(source), text = JSON.stringify(body.messages ?? []);
    const phase = /APPROVAL_MOBILE_(ios|android)_(approve|deny|expire)/.exec(text)?.[0].replace('APPROVAL_MOBILE_', '');
    let calls: unknown[] | undefined, content = 'Approval fixture response';
    if (phase && body.tools?.length) {
      if (await count(phase)) content = `APPROVAL_COMPLETE_${phase}`;
      else {
        assert(body.tools.some((tool: { function?: { name: string }; name?: string }) => (tool.function?.name ?? tool.name) === 'exec_command'));
        const cmd = `node -e "require('node:fs').appendFileSync('${phase}.executed','EXECUTED\\n')"`;
        calls = [{ index: 0, id: 'call_' + randomUUID().replaceAll('-', ''), type: 'function', function: { name: 'exec_command', arguments: JSON.stringify({ cmd }) } }];
        requestedExecutions.push(phase);
      }
    }
    const envelope = { id: randomUUID(), object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: 'approval-lab',
      choices: [{ index: 0, delta: calls ? { role: 'assistant', tool_calls: calls } : { role: 'assistant', content }, finish_reason: null }] };
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' });
    res.write(`data: ${JSON.stringify(envelope)}\n\n`);
    res.write(`data: ${JSON.stringify({ ...envelope, choices: [{ index: 0, delta: {}, finish_reason: calls ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 30, completion_tokens: 20, total_tokens: 50 } })}\n\n`);
    res.end('data: [DONE]\n\n');
  } catch (error) { res.writeHead(500).end(String(error)); }
});
lab.listen(0, '127.0.0.1'); await once(lab, 'listening');
const labAddress = lab.address(); assert(labAddress && typeof labAddress !== 'string');
const listener = createServer(); listener.listen(0, '127.0.0.1'); await once(listener, 'listening');
const address = listener.address(); assert(address && typeof address !== 'string');
port = address.port; await new Promise<void>(resolve => listener.close(() => resolve()));
Object.assign(process.env, { XOPC_STATE_DIR: root, XOPC_CONFIG_PATH: join(root, 'xopc.json'), XOPC_WORKSPACE: root,
  PI_CODING_AGENT_DIR: join(root, 'pi'), XOPC_LOG_DIR: join(root, 'logs'), XOPC_LOG_LEVEL: 'warn', XOPC_LOG_CONSOLE: 'false' });
await writeFile(join(root, 'xopc.json'), JSON.stringify(ConfigSchema.parse({ userContext: { enabled: false }, gateway: { port, publicUrl: secureGateway, auth: { mode: 'token', token } } })));
await writeFile(join(root, 'models.json'), JSON.stringify({ providers: { 'approval-lab': { baseUrl: `http://127.0.0.1:${labAddress.port}/v1`,
  api: 'openai-completions', apiKey: 'synthetic-test-key', models: [{ id: 'lab', name: 'Controlled approval model', input: ['text'], reasoning: false, contextWindow: 128000, maxTokens: 2048 }] } } }));
const route = { primary: 'approval-lab/lab', fallbacks: [] };
openXopcDatabase();
seedTestAgentCatalog({ defaults: AgentDefaultsSchema.parse({ tools: { exec_command: { mode: 'ask' } },
  models: { chat: route, background: route, intents: Object.fromEntries(['fast', 'reasoning', 'coding', 'review', 'vision', 'understanding'].map(key => [key, route])) },
  runtime: { maxTurns: 6, timeoutMs: 90000 } }), agents: [{ id: 'main', enabled: true, workspace: root, toolAllowlist: ['exec_command'], profile: { name: 'Main' } }], surfaceDefaults: { chat: 'main' } });
for (const phase of phases) {
  ensureSessionRecord(conversations[phase], root, { agentId: 'main', sourceChannel: 'webchat', name: `Approval ${phase}` });
  appendTranscriptEntry(conversations[phase], { role: 'user', content: `Approval ${phase} fixture ready.`, timestamp: Date.now() });
}
closeXopcDatabase();
const child = spawn(process.execPath, ['--import', 'tsx/esm', 'src/cli/bin.ts', 'gateway', '--port', String(port), '--no-hot-reload'],
  { cwd: resolve('.'), env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
let logs = '';
const pairing = setInterval(async () => {
  if (!setupId || !port) return;
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  try {
    const result = await (await fetch(`http://127.0.0.1:${port}/api/device-pairing/setups/${setupId}`, { headers })).json() as { request?: { requestId: string; revision: number; status: string } };
    if (result.request?.status === 'pending') await fetch(`http://127.0.0.1:${port}/api/device-pairing/requests/${result.request.requestId}/decision`,
      { method: 'POST', headers, body: JSON.stringify({ decision: 'approve', expectedRevision: result.request.revision }) });
  } catch {}
}, 300);
child.stdout.on('data', chunk => { logs += chunk; }); child.stderr.on('data', chunk => { logs += chunk; });
try {
  let ready = false;
  for (let attempt = 0; attempt < 300; attempt++) {
    assert.equal(child.exitCode, null, logs.slice(-2000));
    try { if ((await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1000) })).ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  assert(ready, 'Gateway did not become ready');
  await writeFile(join(evidence, 'config.json'), JSON.stringify({ gateway: `http://127.0.0.1:${port}`, secureGateway, lab: `http://127.0.0.1:${labAddress.port}`, token, conversations }, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ ready: true, evidence }));
  await new Promise<void>(resolve => { process.once('SIGTERM', resolve); process.once('SIGINT', resolve); });
} finally {
  clearInterval(pairing);
  const results = Object.fromEntries(await Promise.all(phases.map(async phase => [phase, { executions: await count(phase), wait: waitFor(phase) }])));
  await writeFile(join(evidence, 'result.json'), JSON.stringify({ results, requestedExecutions }, null, 2));
  await writeFile(join(evidence, 'gateway.log'), logs.replaceAll(token, '[test-token]'));
  child.kill('SIGTERM'); await Promise.race([once(child, 'exit'), new Promise(resolve => setTimeout(resolve, 5000))]);
  if (child.exitCode === null) child.kill('SIGKILL');
  lab.closeAllConnections(); await new Promise<void>(resolve => lab.close(() => resolve()));
  tls.closeAllConnections(); tls.close();
  await rm(join(evidence, 'config.json'), { force: true }); await rm(root, { recursive: true, force: true });
}
