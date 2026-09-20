/** Exercises the built Gateway and a local model endpoint with entirely temporary state. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const directory = mkdtempSync(join(tmpdir(), 'xopc-scene-production-'));
const workspace = join(directory, 'workspace');
mkdirSync(workspace);
const token = 'isolated-scene-production-smoke';
const model = createServer(async (request, response) => {
  let body = '';
  for await (const chunk of request) body += chunk;
  const parsed = JSON.parse(body);
  const user = parsed.messages.findLast((message: { role: string }) => message.role === 'user');
  const content = typeof user.content === 'string' ? user.content : user.content.map((part: { text?: string }) => part.text ?? '').join('');
  const evidence = JSON.parse(content).evidence;
  const text = JSON.stringify({ kind: 'artifact', summary: 'Keep Sunday free.', evidenceIds: evidence.map((item: { id: string }) => item.id) });
  response.writeHead(200, { 'Content-Type': 'text/event-stream' });
  response.write(`data: ${JSON.stringify({ id: 'local', object: 'chat.completion.chunk', created: 1, model: 'scene-test', choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: null }] })}\n\n`);
  response.write(`data: ${JSON.stringify({ id: 'local', object: 'chat.completion.chunk', created: 1, model: 'scene-test', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 12, completion_tokens: 10, total_tokens: 22 } })}\n\n`);
  response.end('data: [DONE]\n\n');
});
await new Promise<void>(resolve => model.listen(0, '127.0.0.1', resolve));
const modelPort = (model.address() as { port: number }).port;
writeFileSync(join(directory, 'models.json'), JSON.stringify({ providers: { 'scene-local': { baseUrl: `http://127.0.0.1:${modelPort}/v1`, apiKey: 'isolated', api: 'openai-completions', models: [{ id: 'scene-test', name: 'Scene smoke model', reasoning: false, input: ['text'], contextWindow: 32000, maxTokens: 4096 }] } } }));
let child: ReturnType<typeof spawn> | undefined;
let origin = '';
let output = '';
async function stop() {
  if (!child || child.exitCode !== null) return;
  const exited = new Promise<void>(resolve => child!.once('exit', () => resolve()));
  child.kill('SIGTERM');
  const timeout = setTimeout(() => child?.kill('SIGKILL'), 10000);
  await exited; clearTimeout(timeout);
}
async function start() {
  const listener = createServer();
  await new Promise<void>(resolve => listener.listen(0, '127.0.0.1', resolve));
  const port = (listener.address() as { port: number }).port;
  await new Promise<void>(resolve => listener.close(() => resolve()));
  origin = `http://127.0.0.1:${port}`;
  const config = join(directory, 'xopc.json');
  writeFileSync(config, JSON.stringify({ agents: { defaults: { models: { chat: { primary: 'scene-local/scene-test' } } } },
    gateway: { bind: 'loopback', port, auth: { mode: 'token', token }, heartbeat: { enabled: true, intervalMs: 'obsolete', targetChatId: 'obsolete' } }, browser: { enabled: false } }));
  output = '';
  child = spawn(process.execPath, ['dist/src/cli/bin.js', 'gateway', '--port', String(port), '--bind', 'loopback', '--no-hot-reload'], {
    env: { ...process.env, XOPC_STATE_DIR: directory, XOPC_WORKSPACE: workspace, XOPC_CONFIG_PATH: config, XOPC_CONFIG: config,
      XOPC_HOME: directory, XOPC_MODELS_JSON: join(directory, 'models.json'), XOPC_SKIP_CHANNELS: '1', XOPC_NO_RESPAWN: '1', XOPC_LOG_LEVEL: 'fatal' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout!.on('data', data => { output += data; }); child.stderr!.on('data', data => { output += data; });
  for (let attempt = 0; attempt < 300; attempt++) {
    try { if ((await (await fetch(`${origin}/api/health`)).json()).ready) return; } catch {}
    if (child.exitCode !== null) break;
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error(`Gateway not ready: ${output.slice(-4000)}`);
}
async function api(path: string, method = 'GET', body?: unknown, key = 'smoke') {
  const response = await fetch(`${origin}/api/scenes${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Idempotency-Key': key }, body: body === undefined ? undefined : JSON.stringify(body) });
  const result = await response.json();
  assert.ok(response.ok, `${method} ${path}: ${response.status} ${JSON.stringify(result)}`);
  return result;
}
try {
  await start();
  assert.equal((await fetch(`${origin}/api/scenes/templates`)).status, 401);
  assert.equal((await api('/templates')).templates.length, 2);
  const { activation } = await api('/activations', 'POST', { templateKey: 'weekly-family-plan', templateVersion: '1.0.0', goal: 'Keep Sunday free', scope: { kind: 'personal' }, permissions: { accountIds: [], contextProviders: ['user_notes'], effectHandlers: [] } });
  await api(`/activations/${activation.id}/notes`, 'PATCH', { expectedRevision: 0, content: 'Sunday is for rest.' });
  await api(`/activations/${activation.id}/checks`, 'POST');
  for (let attempt = 0; attempt < 100; attempt++) {
    const { outcomes } = await api('/outcomes');
    if (outcomes.length) break;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  assert.equal((await api('/outcomes')).outcomes[0]?.content.summary, 'Keep Sunday free.');
  assert.equal((await api('/diagnostics')).lastSevenDays.modelCalls, 1);
  await stop(); await start();
  assert.equal((await api('/activations')).activations[0].id, activation.id);
  await api(`/activations/${activation.id}/checks`, 'POST');
  assert.equal((await api(`/activations/${activation.id}/runs`)).runs.length, 1);
  const due = new Date(Date.now() + 60_000);
  await api(`/activations/${activation.id}/schedules/weekly-review`, 'PATCH', { expectedRevision: 0,
    schedule: { weekdays: [0, 1, 2, 3, 4, 5, 6], hour: due.getUTCHours(), minute: due.getUTCMinutes(), timeZone: 'UTC' } });
  for (let attempt = 0; attempt < 400; attempt++) {
    const { runs } = await api(`/activations/${activation.id}/runs`);
    if (runs.filter((run: { status: string }) => run.status === 'succeeded').length === 2) break;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  assert.equal((await api(`/activations/${activation.id}/runs`)).runs.filter((run: { status: string }) => run.status === 'succeeded').length, 2);
  const paused = await api(`/activations/${activation.id}`, 'PATCH', { expectedRevision: activation.revision, status: 'paused' });
  assert.equal(paused.activation.status, 'paused');
  for (const path of ['/api/proactive/delegations', '/api/heartbeat/trigger']) {
    assert.equal((await fetch(`${origin}${path}`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } })).status, 404);
  }
  await stop();
  const db = new DatabaseSync(join(directory, 'xopc.db'));
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  assert.deepEqual(db.prepare("SELECT name FROM sqlite_master WHERE name GLOB 'proactive_*'").all(), []);
  db.close();
  console.log('Built Gateway: authenticated scene start → real executor/local model → result → restart/idempotency → pause, old routes absent, database intact.');
} finally {
  await stop(); await new Promise<void>(resolve => model.close(() => resolve())); rmSync(directory, { recursive: true, force: true });
}
