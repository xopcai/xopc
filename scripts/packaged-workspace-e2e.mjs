// Launch an installed production app with isolated state; all UI input uses CUA.
// Usage: node scripts/packaged-workspace-e2e.mjs /absolute/path/to/xopc.app
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, createWriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const application = resolve(process.argv[2] ?? 'dist/release/mac-arm64/xopc.app');
const state = mkdtempSync(join(tmpdir(), 'xopc-packaged-acceptance-'));
const shellData = join(state, 'electron');
mkdirSync(shellData);
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
const probe = createServer();
await new Promise(r => probe.listen(0, '127.0.0.1', r));
const port = probe.address().port;
await new Promise(r => probe.close(r));
const token = randomUUID();
const configPath = join(state, 'xopc.json');
writeFileSync(configPath, JSON.stringify({ gateway: { mode: 'local', bind: 'loopback', port, auth: { mode: 'token', token } }, browser: { enabled: false } }), { mode: 0o600 });
writeFileSync(join(state, 'models.json'), JSON.stringify({ providers: { 'workspace-e2e': { baseUrl: `http://127.0.0.1:${model.address().port}/v1`, apiKey: 'local-fixture', api: 'openai-completions', models: [{ id: 'workspace', name: 'Workspace E2E', reasoning: false, input: ['text'], contextWindow: 128000, maxTokens: 2000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] } } }));
const output = createWriteStream(join(state, 'app-output.log'));
const trace = join(state, 'packaged-startup-and-motion.json');
const executable = join(application, 'Contents/MacOS/xopc');
const env = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !/(API_KEY|ACCESS_TOKEN|AUTH_TOKEN|OAUTH_TOKEN|SECRET)$/i.test(key) && !['ELECTRON_RUN_AS_NODE', 'ELECTRON_RENDERER_URL', 'NODE_OPTIONS'].includes(key))), XOPC_STATE_DIR: state, XOPC_CONFIG_PATH: configPath, XOPC_CONFIG: configPath, PI_CODING_AGENT_DIR: join(state, 'pi'), XOPC_HOME: state, XOPC_LOG_DIR: join(state, 'logs'), XOPC_ELECTRON_DEBUG_LIFECYCLE: '1', XOPC_SKIP_CHANNELS: '1', XOPC_NO_RESPAWN: '1' };
const startedAt = Date.now();
const launchServices = process.env.XOPC_E2E_LAUNCH_SERVICES === '1';
const appArgs = [`--user-data-dir=${shellData}`, '--force-renderer-accessibility', '--trace-startup=devtools.timeline,blink.user_timing,toplevel', '--trace-startup-duration=900', '--trace-startup-format=json', `--trace-startup-file=${trace}`];
const launchEnvArgs = Object.entries(env).filter(([key]) => key.startsWith('XOPC_') || key === 'PI_CODING_AGENT_DIR').flatMap(([key, value]) => ['--env', `${key}=${value}`]);
const child = launchServices
  ? spawn('/usr/bin/open', ['-n', '-W', '-a', application, ...launchEnvArgs, '--args', ...appArgs], { env, stdio: ['ignore', 'pipe', 'pipe'] })
  : spawn(executable, appArgs, { env, stdio: ['ignore', 'pipe', 'pipe'] });
child.stdout.pipe(output); child.stderr.pipe(output);
const base = `http://127.0.0.1:${port}`;
async function request(path, data, method = 'POST') {
  const response = await fetch(base + path, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
  const body = await response.json(); if (!response.ok) throw new Error(`${path}: ${response.status} ${JSON.stringify(body)}`); return body.payload ?? body;
}
const metadata = { application, pid: child.pid, state, shellData, base, token, trace };
writeFileSync('/tmp/xopc-packaged-e2e.json', JSON.stringify(metadata, null, 2), { mode: 0o600 });
async function stop() { child.kill('SIGTERM'); model.closeAllConnections(); model.close(); }
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { void stop(); });
// Keep the local model alive after app quit so the same installed profile can be relaunched.
console.log('Model fixture remains available until Ctrl+C.');
try {
  while (true) {
    if (child.exitCode !== null) throw new Error(`Packaged app exited: ${child.exitCode}; inspect ${state}/app-output.log`);
    try { const health = await fetch(base + '/api/health'); if ((await health.json()).ready) break; } catch { /* Production startup. */ }
    if (Date.now() - startedAt > 90000) throw new Error(`Packaged startup timeout; inspect ${state}/app-output.log`);
    await new Promise(r => setTimeout(r, 250));
  }
  const startupMs = Date.now() - startedAt;
  if (launchServices) {
    const row = execFileSync('/bin/ps', ['-axo', 'pid=,args='], { encoding: 'utf8' }).split('\n').find(line => line.includes('/Contents/MacOS/xopc --user-data-dir=' + shellData));
    if (!row) throw new Error('LaunchServices app process could not be identified');
    metadata.launcherPid = child.pid;
    metadata.pid = Number(row.trim().split(/\s+/)[0]);
    metadata.launchServices = true;
  }
  const response = await fetch(base + '/');
  const html = await response.text();
  if (!response.ok || !html.includes('/assets/')) throw new Error('Packaged Gateway did not serve production assets');
  const global = await request('/api/global-defaults', undefined, 'GET');
  await request('/api/global-defaults', { scope: 'models', defaults: { ...global.defaults, models: { ...global.defaults.models, chat: { primary: 'workspace-e2e/workspace', fallbacks: [] } } } }, 'PATCH');
  const agents = await request('/api/agents', undefined, 'GET');
  const agent = (agents.agents ?? agents.items ?? agents)[0];
  await request(`/api/agents/${encodeURIComponent(agent.id)}`, { models: { chat: { primary: 'workspace-e2e/workspace', fallbacks: [] } } }, 'PATCH');
  mkdirSync(agent.workspace, { recursive: true });
  for (const [name, content] of [['report.md', '# Workspace E2E\n\nOriginal report content.\n'], ['example.json', '{"value":42}\n'], ['diagram.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="120"><rect width="240" height="120" fill="#2563eb"/></svg>']]) writeFileSync(join(agent.workspace, name), content);
  const conversationId = randomUUID();
  await request(`/api/sessions/${conversationId}/inputs`, { kind: 'start', clientMessageId: randomUUID(), creation: { agentId: agent.id, projectId: null, execution: null, temporary: false, model: 'workspace-e2e/workspace', thinkingLevel: 'off' }, input: { content: 'Initialize Workspace E2E' }, origin: { type: 'system', source: 'cli' } });
  await request(`/api/sessions/${conversationId}/rename`, { name: 'Initialize Workspace E2E' });
  Object.assign(metadata, { startupMs, workspace: agent.workspace, conversationId, url: `${base}/#/chat/${conversationId}` });
  for (const name of ['xopc-packaged-e2e.json', 'xopc-workspace-e2e.json']) writeFileSync(join('/tmp', name), JSON.stringify(metadata, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ application, state, pid: metadata.pid, launchServices: metadata.launchServices, startupMs, url: metadata.url, trace }, null, 2));
  console.log('Production app ready. Open seeded conversation through native UI.');
} catch (error) { console.error(error); await stop(); process.exitCode = 1; }
