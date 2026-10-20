/** Isolated browser acceptance against the built Gateway and a deterministic streaming model. */
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import type { Browser } from 'playwright-core';
import { parseProductDeliveryText } from '@xopcai/gateway-contract';

const { chromium } = createRequire(import.meta.url)('playwright-core') as typeof import('playwright-core');

import { AgentDefaultsSchema } from '../src/agent-config/schema.js';
import { seedTestAgentCatalog } from '../src/agent-catalog/test-support.js';
import { ConfigSchema } from '../src/config/schema.js';
import { openXopcDatabase, closeXopcDatabase } from '../src/storage/sqlite/connection.js';

const root = await mkdtemp(join(tmpdir(), 'xopc-conversation-launch-'));
const evidence = resolve(process.env.XOPC_CONVERSATION_E2E_EVIDENCE ?? '/tmp/xopc-conversation-launch-e2e');
await mkdir(evidence, { recursive: true });
const modelRef = 'conversation-e2e/local';
const token = randomUUID();
const workspace = join(root, 'workspace');
await mkdir(workspace);
Object.assign(process.env, {
  XOPC_STATE_DIR: root, XOPC_CONFIG_PATH: join(root, 'xopc.json'), XOPC_CONFIG: join(root, 'xopc.json'),
  XOPC_WORKSPACE: workspace, PI_CODING_AGENT_DIR: join(root, 'pi'), XOPC_LOG_LEVEL: 'warn',
  XOPC_LOG_CONSOLE: 'false', XOPC_LOG_FILE: 'false', XOPC_SKIP_CHANNELS: '1', XOPC_NO_RESPAWN: '1',
});

interface Scenario {
  id: string;
  instruction: string;
  sourceProject?: string;
  expectedProject?: string;
  args: Record<string, unknown>;
}
const scenarios: Scenario[] = [];
const release = new Map<string, () => void>();
const observed = { toolNames: [] as string[], calls: [] as Array<{ scenario: string; name: string }>, failures: [] as string[] };
const model = createServer(async (req, res) => {
  try {
    if (req.url !== '/v1/chat/completions') { res.writeHead(404).end(); return; }
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    const messages = body.messages ?? [];
    const tools = (body.tools ?? []).map((tool: any) => tool.function ?? tool);
    observed.toolNames = [...new Set([...observed.toolNames, ...tools.map((tool: any) => String(tool.name))])];
    const lastUserIndex = messages.findLastIndex((message: any) => message.role === 'user');
    const user = messages[lastUserIndex]?.content;
    const text = typeof user === 'string' ? user : (user ?? []).filter((block: any) => block.type === 'text').map((block: any) => block.text).join('\n');
    const scenario = scenarios.find(item => text.includes(`LAUNCH_PARENT_${item.id}`));
    let content = 'SOURCE_READY';
    let calls: unknown[] | undefined;
    if (scenario && tools.length) {
      const results = messages.slice(lastUserIndex + 1).filter((message: any) => message.role === 'tool');
      const output = results.map((message: any) => String(message.content)).join('\n');
      if (output.includes('xopc-product-delivery:')) content = `CREATED_${scenario.id}`;
      else {
        assert(!observed.calls.some(call => call.scenario === scenario.id), `Launch did not return a session card: ${output.slice(-3000)}`);
        const direct = tools.find((tool: any) => tool.name === 'xopc_use');
        const code = tools.find((tool: any) => tool.parameters?.properties?.code);
        const search = tools.find((tool: any) => tool.name === 'tool_search');
        assert(direct || code || search, `No tool discovery entry point: ${tools.map((tool: any) => tool.name)}`);
        const input = { mode: 'conversation', command: 'create', args: scenario.args };
        const name = direct?.name ?? code?.name ?? search.name;
        const parameters = direct ? input : code ? { code: `text(await tools.xopc_use(${JSON.stringify(input)}));` } : { query: 'create independent conversation xopc_use', limit: 5 };
        if (direct || code) observed.calls.push({ scenario: scenario.id, name });
        calls = [{ index: 0, id: `call_${randomUUID().replaceAll('-', '')}`, type: 'function', function: { name, arguments: JSON.stringify(parameters) } }];
      }
    }
    const child = !scenario && tools.length ? scenarios.find(item => text.includes(`hello CHILD_${item.id}`)) : undefined;
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' });
    const send = (delta: unknown, finish_reason: string | null = null) => res.write(`data: ${JSON.stringify({
      id: randomUUID(), object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: 'local',
      choices: [{ index: 0, delta, finish_reason }],
    })}\n\n`);
    if (child) {
      res.write(': waiting for the browser to inspect the running card\n\n');
      await new Promise<void>(resolve => { release.set(child.id, resolve); res.once('close', resolve); });
      release.delete(child.id);
      content = `REPLY_${child.id}`;
    }
    if (res.destroyed) return;
    send(calls ? { role: 'assistant', tool_calls: calls } : { role: 'assistant', content });
    send({}, calls ? 'tool_calls' : 'stop');
    res.end('data: [DONE]\n\n');
  } catch (error) {
    observed.failures.push(String(error));
    if (!res.headersSent) res.writeHead(500);
    res.end();
  }
});
model.listen(0, '127.0.0.1'); await once(model, 'listening');
const modelAddress = model.address(); assert(modelAddress && typeof modelAddress !== 'string');
const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
const address = probe.address(); assert(address && typeof address !== 'string');
const port = address.port; await new Promise<void>(resolve => probe.close(() => resolve()));
const base = `http://127.0.0.1:${port}`;
await writeFile(join(root, 'xopc.json'), JSON.stringify(ConfigSchema.parse({ gateway: { port, auth: { mode: 'token', token } }, browser: { enabled: false } })));
await writeFile(join(root, 'models.json'), JSON.stringify({ providers: { 'conversation-e2e': {
  baseUrl: `http://127.0.0.1:${modelAddress.port}/v1`, api: 'openai-completions', apiKey: 'local-fixture',
  models: [{ id: 'local', name: 'Conversation E2E', input: ['text'], reasoning: false, contextWindow: 128000, maxTokens: 2048 }],
} } }));
const route = { primary: modelRef, fallbacks: [] };
openXopcDatabase();
seedTestAgentCatalog({ defaults: AgentDefaultsSchema.parse({ models: { chat: route, background: route,
  intents: Object.fromEntries(['fast', 'reasoning', 'coding', 'review', 'vision', 'understanding'].map(key => [key, route])) },
  tools: { xopc_use: { mode: 'allow' }, exec: { mode: 'allow' } }, runtime: { maxTurns: 8, timeoutMs: 90000 },
}), agents: [{ id: 'main', enabled: true, workspace, profile: { name: 'Main' } }] });
closeXopcDatabase();

let logs = '';
const child = spawn(process.execPath, ['dist/src/cli/bin.js', 'gateway', '--port', String(port), '--no-hot-reload'], {
  cwd: resolve('.'), env: process.env, stdio: ['ignore', 'pipe', 'pipe'],
});
child.stdout.on('data', chunk => { logs += chunk; }); child.stderr.on('data', chunk => { logs += chunk; });
const request = async (path: string, method = 'GET', data?: unknown): Promise<any> => {
  const response = await fetch(base + path, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }), signal: AbortSignal.timeout(15000) });
  const body = await response.json(); assert(response.ok, `${path}: ${response.status} ${JSON.stringify(body)}`); return body.payload ?? body;
};
async function until<T>(read: () => Promise<T>, ready: (value: T) => boolean, label: string, timeout = 60000): Promise<T> {
  const start = Date.now();
  let value: T;
  do {
    value = await read();
    if (ready(value)) return value;
    assert(Date.now() - start < timeout, `${label}: ${JSON.stringify(value)}`);
    await new Promise(resolve => setTimeout(resolve, 150));
  } while (true);
}
let browser: Browser | undefined;
const report: Record<string, unknown> = { passed: false, realGateway: true, realBrowser: 'Chromium', model: 'local deterministic OpenAI SSE fixture', cases: [] };
try {
  await until(async () => {
    assert(child.exitCode === null, `Gateway exited: ${logs.slice(-4000)}`);
    try { return (await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(1000) })).json(); } catch { return {}; }
  }, value => value.ready === true, 'Gateway startup');
  await request('/api/models/cloud-onboarding', 'PUT', {});
  await request('/api/onboarding/work-discovery', 'PATCH', { status: 'dismissed' });

  const projectPaths = [join(root, 'project-a'), join(root, 'project-b')];
  for (const path of projectPaths) await mkdir(path);
  await writeFile(join(projectPaths[1]!, 'README.md'), '# E2E repository\n');
  execFileSync('git', ['init', '-q', projectPaths[1]!]);
  execFileSync('git', ['-C', projectPaths[1]!, 'add', 'README.md']);
  execFileSync('git', ['-C', projectPaths[1]!, '-c', 'user.name=E2E', '-c', 'user.email=e2e@example.invalid', 'commit', '-qm', 'fixture']);
  const projectA = (await request('/api/projects', 'POST', { name: 'Launch Project A', workspaceRoot: projectPaths[0], defaultAgentId: 'main', executionMode: 'local_checkout' })).project;
  const projectB = (await request('/api/projects', 'POST', { name: 'Launch Project B', workspaceRoot: projectPaths[1], defaultAgentId: 'main', executionMode: 'managed_worktree' })).project;
  scenarios.push(
    { id: 'plain', instruction: '新建一个对话，发送 hello CHILD_plain。', args: { prompt: 'hello CHILD_plain', title: 'Launch plain' } },
    { id: 'inherit', instruction: '在当前项目新建对话，发送 hello CHILD_inherit。', sourceProject: projectA.id, expectedProject: projectA.id, args: { prompt: 'hello CHILD_inherit', title: 'Launch inherit' } },
    { id: 'outside', instruction: '新建一个不属于任何项目的对话，发送 hello CHILD_outside。', sourceProject: projectA.id, args: { prompt: 'hello CHILD_outside', title: 'Launch outside', project: { kind: 'none' } } },
    { id: 'specified', instruction: '在 Launch Project B 项目新建对话，发送 hello CHILD_specified。', expectedProject: projectB.id, args: { prompt: 'hello CHILD_specified', title: 'Launch specified', project: { kind: 'project', projectId: projectB.id } } },
  );
  browser = await chromium.launch({ headless: true, channel: process.env.XOPC_E2E_BROWSER_CHANNEL ?? 'chrome' });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'en-US', reducedMotion: 'reduce' });
  await context.addInitScript(({ token }) => { localStorage.setItem('xopc.token', token); localStorage.setItem('xopc.language', 'en'); }, { token });
  const page = await context.newPage(); page.setDefaultTimeout(45000);
  const errors: string[] = [], frames: string[] = [];
  page.on('pageerror', error => { errors.push(error.message); console.error(JSON.stringify({ pageError: error.message })); });
  page.on('websocket', socket => socket.on('framereceived', event => { if (typeof event.payload === 'string' && event.payload.includes('session.launch.changed')) frames.push(event.payload); }));
  for (const scenario of scenarios) {
    const sourceId = randomUUID();
    await request(`/api/sessions/${sourceId}/inputs`, 'POST', { kind: 'start', clientMessageId: randomUUID(),
      creation: { agentId: 'main', model: modelRef, thinkingLevel: 'off', temporary: false, projectId: scenario.sourceProject ?? null,
        execution: scenario.sourceProject ? { mode: 'local_checkout' } : null }, input: { content: `Bootstrap ${scenario.id}` }, origin: { type: 'system', source: 'cli' } });
    await until(() => request(`/api/sessions/${sourceId}/input-state`), state => state.revision >= 3 && !state.activeRunId && state.inputs?.length === 0, 'Source bootstrap');
    await request('/api/chat/workspace-trust', 'PATCH', { conversationId: sourceId, trusted: true });
    console.log(JSON.stringify({ stage: 'open source', scenario: scenario.id }));
    await page.goto(`${base}/#/chat/${sourceId}`);
    const composer = page.locator('[contenteditable="true"]').first();
    await composer.waitFor();
    await composer.fill(`${scenario.instruction}\nLAUNCH_PARENT_${scenario.id}`);
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    const card = page.locator('[data-product-delivery="session"]').filter({ hasText: `Launch ${scenario.id}` });
    await card.waitFor();
    console.log(JSON.stringify({ stage: 'card visible', scenario: scenario.id }));
    await card.getByText('Running', { exact: false }).waitFor();
    const detail = await request(`/api/sessions/${sourceId}?include=transcriptRows`);
    const serialized = JSON.stringify(detail);
    const match = serialized.match(/xopc-product-delivery:[^\n]*/);
    // Read the tool's persisted structured envelope rather than guessing any target UUID.
    const rows = detail.session.transcriptRows ?? [];
    let targetId: string | undefined;
    const visit = (value: any): void => {
      if (typeof value === 'string') {
        const delivery = parseProductDeliveryText(value);
        if (delivery?.primary?.kind === 'session') targetId = delivery.primary.id;
        return;
      }
      if (!value || typeof value !== 'object') return;
      if (value.delivery?.primary?.kind === 'session') targetId = value.delivery.primary.id;
      for (const child of Object.values(value)) if (child) {
        if (Array.isArray(child)) child.forEach(visit); else visit(child);
      }
    };
    visit(rows);
    assert(targetId, `No persisted session delivery for ${scenario.id}: ${match?.[0] ?? serialized.slice(-4000)}`);
    const launched = await request(`/api/sessions/${sourceId}/launched-conversations?ids=${targetId}`);
    assert.equal(launched.items.length, 1);
    assert.equal(launched.items[0].status, 'running');
    assert.equal(launched.items[0].projectId, scenario.expectedProject);
    const target = (await request(`/api/sessions/${targetId}?include=transcriptRows`)).session;
    assert.equal(target.projectId ?? undefined, scenario.expectedProject);
    await writeFile(join(evidence, `${scenario.id}-history.json`), JSON.stringify(await request(`/api/sessions/${targetId}/history?view=compact`), null, 2));
    assert.equal((await request(`/api/sessions/${sourceId}`)).session.projectId, scenario.sourceProject);
    const targetState = await request(`/api/sessions/${targetId}/input-state`);
    assert.equal(targetState.inputs.length, 1);
    assert.equal(targetState.inputs[0].content, `hello CHILD_${scenario.id}`);
    assert.equal(targetState.inputs[0].origin.type, 'conversation');
    await page.screenshot({ path: join(evidence, `${scenario.id}-running.png`) });
    await card.locator('button').first().click();
    await page.waitForURL(`**/#/chat/${targetId}`);
    const origin = page.locator('[data-conversation-origin] a');
    await origin.waitFor();
    assert.equal(await origin.getAttribute('href'), `#/chat/${sourceId}`);
    await page.reload();
    await page.locator('[data-conversation-origin] a').waitFor();
    await page.screenshot({ path: join(evidence, `${scenario.id}-origin.png`) });
    await page.locator('[data-conversation-origin] a').click();
    await page.waitForURL(`**/#/chat/${sourceId}`);
    assert(release.has(scenario.id), `Child model was not independently running for ${scenario.id}`);
    release.get(scenario.id)!();
    await card.getByText(`REPLY_${scenario.id}`, { exact: false }).waitFor();
    await card.getByText('Replied', { exact: false }).waitFor();
    await until(() => request(`/api/sessions/${sourceId}/launched-conversations?ids=${targetId}`), snapshot => snapshot.items?.[0]?.status === 'completed' && snapshot.items[0].summary === `REPLY_${scenario.id}`, 'First reply snapshot');
    assert(frames.some(frame => frame.includes(targetId!)), `Missing real WebSocket update for ${scenario.id}`);
    await page.screenshot({ path: join(evidence, `${scenario.id}-completed.png`) });
    await page.reload();
    await card.getByText(`REPLY_${scenario.id}`, { exact: false }).waitFor();
    if (scenario.id === 'specified') {
      const config = await request(`/api/sessions/${targetId}/agent-config`);
      assert.notEqual(config.effectiveWorkspacePath, projectPaths[1]);
      assert.equal(config.workspaceSource, 'execution_environment');
    }
    (report.cases as unknown[]).push({ scenario: scenario.id, sourceId, targetId, projectId: scenario.expectedProject ?? null, passed: true });
    console.log(JSON.stringify({ stage: 'scenario passed', scenario: scenario.id }));
  }
  assert.deepEqual(observed.failures, []);
  assert.deepEqual(errors, []);
  assert.equal(observed.calls.length, 4);
  report.passed = true;
  report.checks = ['four project scopes through browser → Agent tool → real Gateway', 'first input executes independently', 'project bindings and real managed worktree', 'persisted provenance and bidirectional navigation', 'live WebSocket completion card', 'reload restores source and result'];
  console.log(JSON.stringify(report));
} catch (error) {
  report.error = String(error);
  if (browser) for (const context of browser.contexts()) for (const page of context.pages()) {
    await page.screenshot({ path: join(evidence, 'failure.png') }).catch(() => {});
    await writeFile(join(evidence, 'failure.html'), await page.content()).catch(() => {});
  }
  throw error;
} finally {
  await writeFile(join(evidence, 'result.json'), JSON.stringify({ ...report, observed }, null, 2));
  await writeFile(join(evidence, 'gateway.log'), logs.replaceAll(token, '[test-token]'));
  for (const resume of release.values()) resume();
  await browser?.close();
  child.kill('SIGTERM');
  await Promise.race([once(child, 'exit'), new Promise(resolve => setTimeout(resolve, 5000))]);
  if (child.exitCode === null) child.kill('SIGKILL');
  model.closeAllConnections(); await new Promise<void>(resolve => model.close(() => resolve()));
  await rm(root, { recursive: true, force: true });
}
