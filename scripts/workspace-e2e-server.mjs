// Isolated real Gateway + current Vite UI. UI assertions run through Codex CUA.
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer as createViteServer } from 'vite';

const root = resolve(import.meta.dirname, '..');
const state = mkdtempSync(join(tmpdir(), 'xopc-workspace-e2e-'));
const workspace = join(state, 'workspace');
mkdirSync(workspace);
writeFileSync(join(workspace, 'report.md'), '# Workspace E2E\n\nOriginal report content.\n');
writeFileSync(join(workspace, 'example.json'), '{"value":42}\n');
writeFileSync(join(workspace, 'diagram.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="120"><rect width="240" height="120" fill="#2563eb"/><text x="25" y="65" fill="white">Workspace E2E</text></svg>');
let requests = 0;
const model = createServer(async (req, res) => {
  if (req.url !== '/v1/chat/completions') { res.writeHead(404).end(); return; }
  const chunks = []; for await (const chunk of req) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString());
  const prompt = JSON.stringify(body.messages?.findLast(m => m.role === 'user')?.content ?? '');
  requests++;
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  if (prompt.includes('E2E_HOLD')) { res.write(': pending\n\n'); return; }
  const send = (delta, finish_reason = null) => res.write(`data: ${JSON.stringify({ id: 'e2e', object: 'chat.completion.chunk', created: Math.floor(Date.now()/1000), model: 'workspace', choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
  send({ role: 'assistant' });
  for (const content of ['E2E_REPLY ', 'local model ', 'completed.']) {
    if (res.destroyed) return;
    send({ content });
    await new Promise(r => setTimeout(r, 120));
  }
  send({}, 'stop'); res.end('data: [DONE]\n\n');
});
await new Promise(r => model.listen(0, '127.0.0.1', r));
const probe = createServer(); await new Promise(r => probe.listen(0, '127.0.0.1', r));
const port = probe.address().port; await new Promise(r => probe.close(r));
const token = 'workspace-e2e-local-only';
const configPath = join(state, 'xopc.json');
writeFileSync(configPath, JSON.stringify({ gateway: { mode: 'local', bind: 'loopback', port, auth: { mode: 'token', token } }, browser: { enabled: false } }));
writeFileSync(join(state, 'models.json'), JSON.stringify({ providers: { 'workspace-e2e': { baseUrl: `http://127.0.0.1:${model.address().port}/v1`, apiKey: 'local-fixture', api: 'openai-completions', models: [{ id: 'workspace', name: 'Workspace E2E', reasoning: false, input: ['text'], contextWindow: 128000, maxTokens: 2000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] } } }));
const child = spawn(process.execPath, [join(root, 'dist/src/cli/bin.js'), 'gateway', '--port', String(port), '--bind', 'loopback', '--no-hot-reload'], { cwd: root, env: { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !/(API_KEY|ACCESS_TOKEN|AUTH_TOKEN|OAUTH_TOKEN|SECRET)$/i.test(key))), XOPC_CONFIG_PATH: configPath, XOPC_CONFIG: configPath, XOPC_STATE_DIR: state, PI_CODING_AGENT_DIR: join(state, 'pi'), XOPC_HOME: state, XOPC_WORKSPACE: workspace, XOPC_SKIP_CHANNELS: '1', XOPC_NO_RESPAWN: '1', XOPC_LOG_FILE: 'false', XOPC_LOG_CONSOLE: 'false' }, stdio: ['ignore', 'pipe', 'pipe'] });
let logs = ''; child.stdout.on('data', b => { logs += b; }); child.stderr.on('data', b => { logs += b; });
const base = `http://127.0.0.1:${port}`;
async function request(path, data, method = 'POST') {
  const response = await fetch(base + path, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
  const body = await response.json(); if (!response.ok) throw new Error(`${path}: ${response.status} ${JSON.stringify(body)}`); return body.payload ?? body;
}
let vite;
async function stop() { await vite?.close(); child.kill('SIGTERM'); model.closeAllConnections(); model.close(); }
process.on('SIGINT', () => { void stop(); }); process.on('SIGTERM', () => { void stop(); });
try {
  const start = Date.now();
  while (true) {
    if (child.exitCode !== null) throw new Error(logs);
    try { const health = await fetch(base + '/api/health'); if ((await health.json()).ready) break; } catch { /* Startup. */ }
    if (Date.now() - start > 60000) throw new Error(logs);
    await new Promise(r => setTimeout(r, 200));
  }
  const agents = await request('/api/agents', undefined, 'GET');
  const agent = (agents.agents ?? agents.items ?? agents)[0];
  if (!process.env.XOPC_E2E_UNCONFIGURED_DEFAULT) await request(`/api/agents/${encodeURIComponent(agent.id)}`, { models: { chat: { primary: 'workspace-e2e/workspace', fallbacks: [] } } }, 'PATCH');
  mkdirSync(agent.workspace, { recursive: true });
  for (const [name, content] of [['report.md', '# Workspace E2E\n\nOriginal report content.\n'], ['example.json', '{"value":42}\n'], ['diagram.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="120"><rect width="240" height="120" fill="#2563eb"/></svg>']]) writeFileSync(join(agent.workspace, name), content);
  const conversationId = randomUUID();
  await request(`/api/sessions/${conversationId}/inputs`, { kind: 'start', clientMessageId: randomUUID(), creation: { agentId: agent.id, projectId: null, execution: null, temporary: false, model: 'workspace-e2e/workspace', thinkingLevel: 'off' }, input: { content: 'Initialize Workspace E2E' }, origin: { type: 'system', source: 'cli' } });
  process.chdir(join(root, 'web'));
  vite = await createViteServer({ root: join(root, 'web'), configFile: join(root, 'web/vite.config.ts'), server: { host: '127.0.0.1', port: 0, proxy: { '/api': { target: base, changeOrigin: false, ws: true }, '/health': { target: base } } } });
  await vite.listen();
  const metadata = { state, workspace: agent.workspace, base, token, url: `${vite.resolvedUrls.local[0]}#/chat/${conversationId}`, conversationId };
  writeFileSync('/tmp/xopc-workspace-e2e.json', JSON.stringify(metadata, null, 2));
  console.log(JSON.stringify(metadata, null, 2));
  console.log('Ready. Ctrl+C stops only fixture services. State is retained for inspection.');
} catch (error) { console.error(error); await stop(); process.exitCode = 1; }
