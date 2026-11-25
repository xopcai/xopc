import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, request as httpRequest } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { createRequire } from 'node:module';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  A2UI_VERSION,
  A2UI_V1_VERSION,
  PROJECT_COMPARISON_ACTION_PATH,
  appendProductDeliveryText,
  parseProductDeliveryEnvelope,
  projectComparisonActionResultSchema,
} from '@xopcai/gateway-contract';

import { seedTestAgentCatalog } from '../src/agent-catalog/test-support.js';
import { AgentDefaultsSchema } from '../src/agent-config/schema.js';
import { ConfigSchema } from '../src/config/schema.js';
import { buildProjectComparison } from '../src/projects/project-comparison.js';
import { ProjectStore } from '../src/projects/project-store.js';
import { closeXopcDatabase, openXopcDatabase } from '../src/storage/sqlite/connection.js';
import { createConversation } from '../src/storage/sqlite/conversation-repository.js';
import { appendTranscriptEntry } from '../src/storage/sqlite/transcript-repository.js';

const { chromium } = createRequire(import.meta.url)('playwright-core') as typeof import('playwright-core');

const evidence = resolve(process.env.XOPC_COMPARISON_EVIDENCE ?? '/tmp/xopc-project-comparison');
await mkdir(evidence, { recursive: true });
const root = await mkdtemp(join(tmpdir(), 'xopc-comparison-'));
const token = randomUUID();
const comparisonPrompt = 'Compare Atlas and Orbit.';
const projectIds: string[] = [];
const observed = { toolCalls: 0, modelErrors: [] as string[] };
const model = createServer(async (request, response) => {
  try {
    let source = '';
    for await (const chunk of request) source += chunk;
    const body = JSON.parse(source);
    const messages = body.messages ?? [];
    const tools: string[] = (body.tools ?? []).map((tool: { function?: { name: string }; name?: string }) => tool.function?.name ?? tool.name);
    const askedForComparison = messages.some((message: { role: string; content: unknown }) =>
      message.role === 'user' && JSON.stringify(message.content).includes(comparisonPrompt));
    const alreadyCompared = messages.some((message: { role: string; content: unknown }) =>
      message.role === 'tool' && JSON.stringify(message.content).includes('xopc-product-delivery:'));
    let toolCall: { name: string; arguments: string } | undefined;
    if (askedForComparison && !alreadyCompared && tools.length) {
      const compare = { mode: 'project', command: 'compare', args: { projectIds } };
      if (tools.includes('xopc_use')) {
        toolCall = { name: 'xopc_use', arguments: JSON.stringify(compare) };
        observed.toolCalls++;
      } else if (tools.includes('tool_search')) {
        toolCall = { name: 'tool_search', arguments: JSON.stringify({ query: 'xopc_use project compare', limit: 1 }) };
      } else throw new Error(`Agent did not expose xopc_use: ${tools.join(', ')}`);
    }
    const envelope = { id: randomUUID(), object: 'chat.completion.chunk', model: 'lab',
      created: Math.floor(Date.now() / 1000) };
    const delta = toolCall
      ? { role: 'assistant', tool_calls: [{ index: 0, id: 'call_' + randomUUID().replaceAll('-', ''), type: 'function', function: toolCall }] }
      : { role: 'assistant', content: 'I compared Atlas and Orbit.' };
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    response.write(`data: ${JSON.stringify({ ...envelope, choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`);
    response.write(`data: ${JSON.stringify({ ...envelope, choices: [{ index: 0, delta: {}, finish_reason: toolCall ? 'tool_calls' : 'stop' }],
      usage: { prompt_tokens: 35, completion_tokens: 15, total_tokens: 50 } })}\n\n`);
    response.end('data: [DONE]\n\n');
  } catch (error) {
    observed.modelErrors.push(String(error));
    response.writeHead(500).end();
  }
});
model.listen(0, '127.0.0.1');
await once(model, 'listening');
const modelAddress = model.address();
assert(modelAddress && typeof modelAddress !== 'string');
const reserved = createServer().listen(Number(process.env.XOPC_COMPARISON_PORT ?? 0), '127.0.0.1');
await once(reserved, 'listening');
const gatewayAddress = reserved.address();
assert(gatewayAddress && typeof gatewayAddress !== 'string');
const port = gatewayAddress.port;
await new Promise<void>(done => reserved.close(() => done()));
const base = `http://127.0.0.1:${port}`;
const ca = join(evidence, 'simulator-ca.pem');
const tlsRoot = process.env.XOPC_COMPARISON_TLS_DIR ?? root;
const key = join(tlsRoot, 'tls.key');
const cert = join(tlsRoot, 'tls.crt');
if (tlsRoot === root) {
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2', '-keyout', join(root, 'ca.key'),
    '-out', ca, '-subj', '/CN=xopc comparison test only', '-addext', 'basicConstraints=critical,CA:TRUE',
    '-addext', 'keyUsage=critical,keyCertSign,cRLSign'], { stdio: 'ignore' });
  execFileSync('openssl', ['req', '-new', '-newkey', 'rsa:2048', '-nodes', '-keyout', key,
    '-out', join(root, 'tls.csr'), '-subj', '/CN=localhost'], { stdio: 'ignore' });
  await writeFile(join(root, 'tls.ext'), 'basicConstraints=critical,CA:FALSE\nkeyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=IP:127.0.0.1,DNS:localhost\n');
  execFileSync('openssl', ['x509', '-req', '-in', join(root, 'tls.csr'), '-CA', ca, '-CAkey', join(root, 'ca.key'),
    '-CAserial', join(root, 'ca.srl'), '-CAcreateserial', '-out', cert, '-days', '2', '-extfile', join(root, 'tls.ext')], { stdio: 'ignore' });
} else {
  await copyFile(join(tlsRoot, 'ca.pem'), ca);
}
const tlsActions: unknown[] = [];
const tls = createHttpsServer({ key: await readFile(key), cert: await readFile(cert) }, (request, response) => {
  const action = request.url === PROJECT_COMPARISON_ACTION_PATH && request.method === 'POST';
  const upstream = httpRequest({ host: '127.0.0.1', port, path: request.url, method: request.method, headers: request.headers }, result => {
    if (action) {
      tlsActions.push({ userAgent: request.headers['user-agent'], status: result.statusCode });
      void writeFile(join(evidence, 'mobile-actions.json'), JSON.stringify(tlsActions, null, 2));
    }
    response.writeHead(result.statusCode!, result.headers);
    result.pipe(response);
  });
  upstream.on('error', () => response.destroy());
  request.pipe(upstream);
});
tls.on('upgrade', (request, socket, head) => {
  const upstream = connect(port, '127.0.0.1', () => {
    const headers = request.rawHeaders.map((field, index) => field + (index % 2 ? '\r\n' : ': ')).join('');
    upstream.write(`${request.method} ${request.url} HTTP/1.1\r\n${headers}\r\n`);
    if (head.length) upstream.write(head);
    socket.pipe(upstream).pipe(socket);
  });
  upstream.on('error', () => socket.destroy());
  socket.on('error', () => upstream.destroy());
  socket.on('close', () => upstream.destroy());
});
tls.listen(Number(process.env.XOPC_COMPARISON_TLS_PORT ?? 0), '127.0.0.1');
await once(tls, 'listening');
const tlsAddress = tls.address();
assert(tlsAddress && typeof tlsAddress !== 'string');
const secureGateway = `https://127.0.0.1:${tlsAddress.port}`;
Object.assign(process.env, {
  XOPC_STATE_DIR: root, XOPC_CONFIG_PATH: join(root, 'xopc.json'), XOPC_WORKSPACE: root,
  PI_CODING_AGENT_DIR: join(root, 'pi'), XOPC_LOG_DIR: join(root, 'logs'), XOPC_LOG_LEVEL: 'warn', XOPC_LOG_CONSOLE: 'false',
});
await writeFile(join(root, 'xopc.json'), JSON.stringify(ConfigSchema.parse({
  userContext: { enabled: false }, gateway: { port, publicUrl: secureGateway, auth: { mode: 'token', token } },
})));
await writeFile(join(root, 'models.json'), JSON.stringify({
  providers: { 'comparison-lab': { baseUrl: `http://127.0.0.1:${modelAddress.port}/v1`, api: 'openai-completions',
    apiKey: 'synthetic-test-key', models: [{ id: 'lab', name: 'Comparison lab', input: ['text'], reasoning: false, contextWindow: 128000, maxTokens: 2048 }] } },
}));
const route = { primary: 'comparison-lab/lab', fallbacks: [] };
openXopcDatabase();
seedTestAgentCatalog({
  defaults: AgentDefaultsSchema.parse({
    models: { chat: route, background: route,
      intents: Object.fromEntries(['fast', 'reasoning', 'coding', 'review', 'vision', 'understanding'].map(key => [key, route])) },
    runtime: { maxTurns: 8, timeoutMs: 90000 },
  }),
  agents: [{ id: 'main', enabled: true, workspace: root, toolAllowlist: ['xopc_use'], profile: { name: 'Main' } }],
  surfaceDefaults: { chat: 'main' },
});
const projectStore = new ProjectStore();
const projects = [
  projectStore.create({ name: 'Atlas', health: 'at_risk', description: 'Infrastructure migration' }),
  projectStore.create({ name: 'Orbit', health: 'on_track', description: 'Design rollout' }),
];
projectIds.push(...projects.map(project => project.id));
const legacyDelivery = buildProjectComparison(projects);
assert(legacyDelivery.projectComparison);
delete legacyDelivery.projectComparison.messagesV1;
const legacyConversationId = createConversation({
  agentId: 'main',
  name: 'Legacy project comparison',
  sourceChannel: 'webchat',
}, root).key;
const legacyTimestamp = Date.now() - 60_000;
const toolCall = { type: 'toolCall' as const, id: 'legacy-compare', name: 'xopc_use',
  arguments: { mode: 'project', command: 'compare', args: { projectIds } } };
const assistant = {
  role: 'assistant' as const, api: 'openai-completions' as const, provider: 'comparison-lab', model: 'lab',
  usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
};
appendTranscriptEntry(legacyConversationId, { role: 'user', content: comparisonPrompt, timestamp: legacyTimestamp });
appendTranscriptEntry(legacyConversationId, { ...assistant, content: [toolCall], stopReason: 'toolUse', timestamp: legacyTimestamp + 1 });
appendTranscriptEntry(legacyConversationId, {
  role: 'toolResult', toolCallId: toolCall.id, toolName: toolCall.name, isError: false, timestamp: legacyTimestamp + 2,
  content: [{ type: 'text', text: appendProductDeliveryText('Compared two projects.', legacyDelivery) }],
});
appendTranscriptEntry(legacyConversationId, {
  ...assistant, content: [{ type: 'text', text: 'Here is the previous project comparison.' }],
  stopReason: 'stop', timestamp: legacyTimestamp + 3,
});
closeXopcDatabase();

const child = spawn(process.execPath, ['dist/src/cli/bin.js', 'gateway', '--port', String(port), '--no-hot-reload'],
  { cwd: resolve('.'), env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
let logs = '';
child.stdout.on('data', chunk => { logs += chunk; });
child.stderr.on('data', chunk => { logs += chunk; });
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const result = await fetch(base + path, { headers, method, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!result.ok) throw new Error(`${method} ${path}: ${result.status} ${await result.text()}`);
  return result.json() as Promise<T>;
}

try {
  let ready = false;
  for (let attempt = 0; attempt < 200; attempt++) {
    assert.equal(child.exitCode, null, logs.slice(-3000));
    try {
      if ((await fetch(base + '/health', { signal: AbortSignal.timeout(1000) })).ok) { ready = true; break; }
    } catch {}
    await new Promise(done => setTimeout(done, 200));
  }
  assert(ready, 'Gateway did not start');
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  let conversationId: string;
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'en-US' });
    await context.addInitScript(() => localStorage.setItem('xopc.language', 'en'));
    const auth = await context.request.post(base + '/api/browser-session', {
      headers: { ...headers, Origin: base, 'Sec-Fetch-Site': 'same-origin' },
    });
    assert(auth.ok(), `Browser auth: ${auth.status()}`);
    const dismissal = await context.request.patch(base + '/api/onboarding/work-discovery', {
      headers: { Origin: base, 'Sec-Fetch-Site': 'same-origin' },
      data: { status: 'dismissed' },
    });
    assert(dismissal.ok(), `Work discovery dismissal: ${dismissal.status()}`);
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    try {
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(base + '/#/chat/new');
      const composer = page.locator('[contenteditable="true"]').first();
      let focused = false;
      for (let attempt = 0; attempt < 25; attempt++) {
        for (const name of ['Maybe later, keep using my current model', 'Skip for now']) {
          const dialog = page.getByRole('button', { name, exact: true });
          if (await dialog.isVisible()) await dialog.click({ timeout: 1000 }).catch(() => {});
        }
        try {
          await composer.click({ timeout: 750 });
          focused = true;
          break;
        } catch { /* An onboarding dialog can cover the composer after it becomes visible. */ }
      }
      assert(focused, 'Chat composer was not actionable');
      await page.keyboard.insertText(comparisonPrompt);
      const input = page.waitForRequest(req => req.method() === 'POST' && /\/api\/sessions\/[^/]+\/inputs$/.test(new URL(req.url()).pathname));
      await composer.press('Enter');
      conversationId = new URL((await input).url()).pathname.split('/')[3]!;
      assert.notEqual(conversationId, legacyConversationId);
      const panel = page.locator('[data-project-comparison]');
      const atlas = panel.getByRole('button', { name: 'Inspect Atlas', exact: true });
      await atlas.waitFor({ timeout: 45000 });
      await panel.getByText('active · at risk', { exact: true }).waitFor();
      await panel.getByText('active · on track', { exact: true }).waitFor();
      await page.screenshot({ path: join(evidence, 'web-initial.png') });
      await page.getByText('I compared Atlas and Orbit.', { exact: true }).last().waitFor();
      const history = await request<{ session: { messages: Array<{ deliveries?: unknown[] }> } }>(`/api/sessions/${conversationId}/history?view=compact`);
      const panels = history.session.messages.flatMap(message => message.deliveries ?? []).map(parseProductDeliveryEnvelope)
        .flatMap(delivery => delivery?.projectComparison ? [delivery.projectComparison] : []);
      const surfaceId = await panel.getAttribute('data-project-comparison');
      const persisted = panels.find(comparison => comparison.surfaceId === surfaceId);
      assert(persisted, 'Persisted comparison is missing from session history');
      assert(persisted.messages.every(message => message.version === A2UI_VERSION));
      assert.equal(persisted.messagesV1?.[0].version, A2UI_V1_VERSION);
      const fixture = JSON.stringify(persisted);
      const sha256 = createHash('sha256').update(fixture).digest('hex');
      await writeFile(join(evidence, 'gateway-fixture.json'), fixture);

      const { project } = await request<{ project: { version: number } }>(`/api/projects/${projectIds[0]}`);
      await request(`/api/projects/${projectIds[0]}`, 'PATCH', { expectedVersion: project.version, health: 'on_track' });
      const actionResponse = page.waitForResponse(result => new URL(result.url()).pathname === PROJECT_COMPARISON_ACTION_PATH);
      await atlas.click();
      const returned = await actionResponse;
      assert.equal(returned.status(), 200, () => returned.statusText());
      const outbound = returned.request().postDataJSON();
      assert.equal(outbound.version, A2UI_V1_VERSION);
      assert.equal(outbound.action.context.projectId, projectIds[0]);
      assert.equal(outbound.action.context.status, 'active · at risk');
      const action = projectComparisonActionResultSchema.parse(await returned.json());
      assert(action.messages.every(message => message.version === A2UI_V1_VERSION));
      await panel.getByText('Selected Atlas · active · on track · Infrastructure migration', { exact: true }).waitFor();
      await page.mouse.move(0, 0);
      await page.screenshot({ path: join(evidence, 'web-action.png') });

      const chatURL = page.url();
      await page.goto(base + '/#/settings');
      await panel.waitFor({ state: 'detached' });
      await page.goBack();
      assert.equal(page.url(), chatURL);
      await panel.getByText('Selected Atlas · active · on track · Infrastructure migration', { exact: true }).waitFor();
      await page.screenshot({ path: join(evidence, 'web-restored.png') });
      const collapseSidebar = page.getByRole('button', { name: 'Collapse sidebar', exact: true });
      if (await collapseSidebar.isVisible()) await collapseSidebar.click();
      await page.setViewportSize({ width: 390, height: 844 });
      await panel.scrollIntoViewIfNeeded();
      const bounds = await panel.boundingBox();
      assert(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 390, 'Comparison extends past the viewport');
      assert(await panel.evaluate(element => element.scrollWidth <= element.clientWidth), 'Comparison content overflows');
      await page.screenshot({ path: join(evidence, 'web-narrow.png'), animations: 'disabled' });

      const legacyHistory = await request<typeof history>(`/api/sessions/${legacyConversationId}/history?view=compact`);
      const legacy = legacyHistory.session.messages.flatMap(message => message.deliveries ?? []).map(parseProductDeliveryEnvelope)
        .find(delivery => delivery?.projectComparison?.surfaceId === legacyDelivery.projectComparison?.surfaceId)?.projectComparison;
      assert(legacy, 'Legacy comparison is missing from session history');
      assert.equal(legacy.messagesV1, undefined);
      await page.goto(base + `/#/chat/${legacyConversationId}`);
      const legacyPanel = page.locator(`[data-project-comparison="${legacy.surfaceId}"]`);
      await legacyPanel.getByText('active · at risk', { exact: true }).waitFor();
      const legacyResponse = page.waitForResponse(result => new URL(result.url()).pathname === PROJECT_COMPARISON_ACTION_PATH);
      await legacyPanel.getByRole('button', { name: 'Inspect Atlas', exact: true }).click();
      const legacyReturned = await legacyResponse;
      assert.equal(legacyReturned.status(), 200, () => legacyReturned.statusText());
      assert.equal(legacyReturned.request().postDataJSON().version, A2UI_VERSION);
      const legacyAction = projectComparisonActionResultSchema.parse(await legacyReturned.json());
      assert(legacyAction.messages.every(message => message.version === A2UI_VERSION));
      await legacyPanel.getByText('Selected Atlas · active · on track · Infrastructure migration', { exact: true }).waitFor();
      await page.screenshot({ path: join(evidence, 'web-legacy.png'), animations: 'disabled' });

      assert.deepEqual(errors, []);
      assert.equal(observed.toolCalls, 1);
      assert.deepEqual(observed.modelErrors, []);
      await writeFile(join(evidence, 'web-result.json'), JSON.stringify({
        conversationId, legacyConversationId, sha256, outbound, action, legacyAction, observed, ok: true,
      }, null, 2));
      if (process.argv.includes('--keep-gateway')) {
        await request(`/api/sessions/${conversationId}`, 'PATCH', { name: 'A2UI comparison acceptance' });
        await writeFile(join(evidence, 'config.json'), JSON.stringify({
          base, secureGateway, token, conversationId, legacyConversationId, projectIds,
        }), { mode: 0o600 });
      }
    } catch (error) {
      await page.screenshot({ path: join(evidence, 'web-failure.png') }).catch(() => {});
      await writeFile(join(evidence, 'web-failure.html'), await page.content()).catch(() => {});
      throw error;
    }
  } finally {
    await browser.close();
  }
  console.log(JSON.stringify({ ok: true, evidence, conversationId }));
  if (process.argv.includes('--keep-gateway')) {
    await new Promise<void>(done => { process.once('SIGTERM', done); process.once('SIGINT', done); });
  }
} finally {
  await writeFile(join(evidence, 'gateway.log'), logs.replaceAll(token, '[test-token]'));
  child.kill('SIGTERM');
  await Promise.race([once(child, 'exit'), new Promise(done => setTimeout(done, 5000))]);
  if (child.exitCode === null) child.kill('SIGKILL');
  model.closeAllConnections();
  model.close();
  tls.closeAllConnections();
  tls.close();
  await rm(join(evidence, 'config.json'), { force: true });
  await rm(root, { recursive: true, force: true });
}
