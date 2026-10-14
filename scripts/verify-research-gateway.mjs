// Real authenticated Gateway/SQLite/realtime acceptance with controlled HTTP upstreams.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { RealtimeClient } from '../packages/realtime-client/src/index.ts';
import { REALTIME_PROTOCOL_VERSION } from '../packages/realtime-protocol/src/index.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const state = mkdtempSync(join(tmpdir(), 'xopc-research-gateway-'));
const workspace = join(state, 'workspace'); mkdirSync(workspace);
const startedAt = Date.now();
const searchOnly = process.env.XOPC_RESEARCH_GATEWAY_SEARCH_ONLY === '1';
const reportPath = resolve(process.env.XOPC_RESEARCH_GATEWAY_REPORT ?? join(tmpdir(), `xopc-research-gateway-report-${Date.now()}.json`));
const token = randomUUID();
const events = [], searchCalls = [], modelCalls = [], checks = [];
let child, realtime, connected = false, logs = '', fixtureFailure, timeoutAbortedAt, timeoutHeldAt, resumeId, revokeResumeId;
let timeoutFirstDone = false;
const goals = { timeout: 'E2E_TIMEOUT_VENDOR', revoke: 'E2E_CACHE_REVOKE', isolate: 'E2E_CACHE_ISOLATION' };
const source = query => [{ title: `Synthetic official source ${query}`, url: `https://fixture.invalid/${encodeURIComponent(query)}`,
  description: query === 'timeout-proof' ? 'E2E_VERIFIED_BEFORE_TIMEOUT' : 'Synthetic source evidence; not actual vendor facts' }];
const sourceCounts = query => searchCalls.filter(call => call.path === '/search' && call.query === query).length;
const batchOperations = prefix => [{ id: 'a', kind: 'web_search', query: `${prefix}:a`, count: 5 },
  { id: 'b', kind: 'web_search', query: `${prefix}:b`, count: 5 }, { id: 'copy', kind: 'web_search', query: `${prefix}:a`, count: 5 }];
const finding = (id, conclusion) => ({ id, subject: 'Synthetic vendor', field: 'public evidence', status: 'confirmed', conclusion,
  sources: [{ url: 'https://fixture.invalid/evidence', title: 'Controlled source' }] });
function sendModel(res, tool, args, text) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  const send = (delta, finish_reason = null) => res.write(`data: ${JSON.stringify({ id: 'chatcmpl-research-e2e', object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000), model: 'smoke', choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
  send({ role: 'assistant' });
  if (tool) { send({ tool_calls: [{ index: 0, id: `call_${randomUUID()}`, type: 'function', function: { name: tool, arguments: JSON.stringify(args) } }] }); send({}, 'tool_calls'); }
  else { send({ content: text ?? 'E2E_RESULT' }); send({}, 'stop'); }
  res.end('data: [DONE]\n\n');
}
async function serve(req, res) {
  const url = new URL(req.url, 'http://fixture');
  if (url.pathname === '/search') {
    const query = url.searchParams.get('q'); searchCalls.push({ path: '/search', query, at: Date.now() });
    if (query === 'rate-once' && sourceCounts(query) === 1) { res.writeHead(429, { 'Retry-After': '1' }).end(); return; }
    if (query.startsWith('permission-denied')) { res.writeHead(403).end(); return; }
    if (query === 'caller-deadline') { res.writeHead(200, { 'content-type': 'application/json' }); res.write('{'); return; }
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ results: source(query).map(item => ({ ...item, content: item.description })) })); return;
  }
  const chunks = []; for await (const chunk of req) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString());
  if (url.pathname === '/batch') {
    const prefix = body[0].query.split(':')[0]; searchCalls.push({ path: '/batch', prefix, at: Date.now(), queries: body.map(item => item.query) });
    if (prefix === 'batch-only') { res.writeHead(403, { 'content-type': 'application/json' }).end(JSON.stringify({ code: 'batch_only' })); return; }
    if (prefix === 'batch-rate') { res.writeHead(429, { 'Retry-After': '1' }).end(); return; }
    if (prefix === 'batch-denied') { res.writeHead(403).end(); return; }
    if (prefix === 'batch-timeout') { res.writeHead(200, { 'content-type': 'application/json' }); res.write('{'); return; }
    const items = body.map((item, index) => prefix === 'batch-partial' && index === 1
      ? { id: item.id, error: { kind: 'timeout', scope: 'request', message: 'Controlled item timeout' } }
      : { id: item.id, results: source(item.query) });
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(items)); return;
  }
  if (url.pathname !== '/v1/chat/completions') { res.writeHead(404).end(); return; }
  const messages = body.messages ?? [];
  const system = messages.filter(message => message.role === 'system').map(message => JSON.stringify(message.content)).join('\n');
  const lastUser = messages.findLastIndex(message => message.role === 'user');
  const prompt = JSON.stringify(messages[lastUser]?.content);
  const tools = messages.slice(lastUser + 1).filter(message => message.role === 'tool');
  const declarations = (body.tools ?? []).map(tool => tool.function.name);
  const isChild = system.includes('# Subagent Context');
  modelCalls.push({ at: Date.now(), isChild, prompt: prompt.slice(0, 180), toolResults: tools.length, declarations,
    results: tools.map(tool => { try { return JSON.parse(tool.content); } catch { return { text: tool.content }; } }) });
  if (!isChild) {
    if (tools.length) { sendModel(res, null, null, 'E2E_PARENT_RECEIVED_RESULT'); return; }
    assert(declarations.includes('delegate_task'), 'Gateway parent did not expose delegate_task');
    let goal, context, id;
    if (prompt.includes('TIMEOUT_FIRST') || prompt.includes('TIMEOUT_RESUME')) { goal = goals.timeout; id = prompt.includes('TIMEOUT_RESUME') ? resumeId : undefined; }
    else if (prompt.includes('REVOKE_RESUME') || prompt.includes('REVOKE_FIRST')) { goal = goals.revoke; id = prompt.includes('REVOKE_RESUME') ? revokeResumeId : undefined; }
    else if (prompt.includes('ISOLATION')) goal = goals.isolate;
    else if (prompt.includes('QUOTA_DENIED')) goal = 'E2E_QUOTA_DENIED';
    else if (prompt.includes('INDIVIDUAL_RATE')) goal = 'E2E_INDIVIDUAL_RATE';
    else if (prompt.includes('INDIVIDUAL_DENIED')) goal = 'E2E_INDIVIDUAL_DENIED';
    else if (prompt.includes('DEADLINE')) goal = 'E2E_CALLER_DEADLINE';
    else { const prefix = /E2E_(batch-[a-z]+)/.exec(prompt)?.[1]; assert(prefix, `Unknown test command ${prompt}`); goal = `E2E_${prefix}`; }
    sendModel(res, 'delegate_task', { goal, context, ...(id ? { resumeId: id } : {}), mode: 'research', budgetTier: 'light',
      maxAttempts: 1, toolset: goal.includes('batch-') || goal.includes('QUOTA_DENIED') ? ['web_search', 'data_batch'] : ['web_search'] }); return;
  }
  if (prompt.includes('Research time expired') || prompt.includes('Delegation budget is approaching')) {
    sendModel(res, null, null, 'E2E_HANDOFF: saved evidence remains; resume the unfinished item.'); return;
  }
  const goal = messages.find(message => message.role === 'user')?.content;
  const name = typeof goal === 'string' ? goal : JSON.stringify(goal);
  if (name.includes(goals.timeout)) {
    const resumed = timeoutFirstDone && system.includes('E2E_VERIFIED_BEFORE_TIMEOUT');
    if (!tools.length) { sendModel(res, 'web_search', { query: 'timeout-proof', count: 5 }); return; }
    if (tools.length === 1) { assert(declarations.includes('research_checkpoint')); sendModel(res, 'research_checkpoint', {
      findings: resumed ? [] : [finding('before-timeout', 'E2E_VERIFIED_BEFORE_TIMEOUT')], nextSteps: resumed ? [] : ['Finish the remaining item after timeout'] }); return; }
    if (resumed) { sendModel(res, null, null, 'E2E_RESUMED_COMPLETE'); return; }
    timeoutHeldAt ??= Date.now(); res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write(': waiting for the real research deadline\n\n');
    res.on('close', () => { timeoutAbortedAt ??= Date.now(); }); return;
  }
  if (name.includes('QUOTA_DENIED')) {
    assert(declarations.includes('data_batch'));
    sendModel(res, 'data_batch', { operations: ['a', 'b', 'c', 'd'].map(id => ({ id, kind: 'web_search', query: `quota-denied:${id}` })) }); return;
  }
  if (name.includes('batch-')) {
    const prefix = /E2E_(batch-[a-z]+)/.exec(name)[1];
    if (!tools.length) { assert(declarations.includes('data_batch'), 'Research child cannot use data_batch: delegated batch path is unreachable'); sendModel(res, 'data_batch', { operations: batchOperations(prefix) }); return; }
    if (tools.length === 1 && prefix !== 'batch-denied') { sendModel(res, 'research_checkpoint', { findings: [finding(prefix, 'Synthetic batch evidence')], nextSteps: [] }); return; }
    sendModel(res, null, null, 'E2E_BATCH_RESULT'); return;
  }
  const query = name.includes(goals.revoke) ? 'cache-revocation-proof' : name.includes(goals.isolate) ? 'timeout-proof'
    : name.includes('INDIVIDUAL_RATE') ? 'rate-once' : name.includes('CALLER_DEADLINE') ? 'caller-deadline' : 'permission-denied-single';
  if (!tools.length) { sendModel(res, 'web_search', { query, count: 5 }); return; }
  if (tools.length === 1 && !query.startsWith('permission-denied') && query !== 'caller-deadline') {
    sendModel(res, 'research_checkpoint', { findings: [finding(query, 'Synthetic verified evidence')], nextSteps: name.includes(goals.revoke) ? ['Finish later'] : [] }); return;
  }
  sendModel(res, null, null, 'E2E_SEARCH_RESULT');
}
const upstream = createServer((req, res) => { void serve(req, res).catch(error => { fixtureFailure ??= error; if (!res.headersSent) res.writeHead(500); res.end('Controlled upstream failed'); }); });
await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
const upstreamBase = `http://127.0.0.1:${upstream.address().port}`;
const probe = createServer(); await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
const base = `http://127.0.0.1:${port}`;
const configPath = join(state, 'xopc.json');
writeFileSync(configPath, JSON.stringify({ gateway: { mode: 'local', bind: 'loopback', port, auth: { mode: 'token', token } },
  browser: { enabled: false }, userContext: { enabled: false },
  tools: { web: { region: 'global', search: { providers: [{ type: 'searxng', url: upstreamBase }], maxResults: 5 } } } }), { mode: 0o600 });
writeFileSync(join(state, 'models.json'), JSON.stringify({ providers: { 'research-smoke': { baseUrl: `${upstreamBase}/v1`, apiKey: 'synthetic-key', api: 'openai-completions',
  models: [{ id: 'smoke', name: 'Controlled research model', reasoning: false, input: ['text'], contextWindow: 128000, maxTokens: 4000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] } } }));
const networkAudit = join(state, 'network.jsonl');
const preload = join(state, 'fixture-adapter.mjs');
// This optional host adapter is installed only in the acceptance subprocess. Production providers are not monkey-patched.
writeFileSync(preload, `import {appendFileSync} from 'node:fs';
import {SearXNGProvider} from ${JSON.stringify(pathToFileURL(join(root, 'dist/src/agent/tools/search/providers/searxng.js')).href)};
import {SearchError,searchHttpError} from ${JSON.stringify(pathToFileURL(join(root, 'dist/src/agent/tools/search/errors.js')).href)};
const nativeFetch=globalThis.fetch;
globalThis.fetch=async(input,init)=>{const u=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);
 if(u.hostname!=='127.0.0.1'&&u.hostname!=='localhost'){appendFileSync(${JSON.stringify(networkAudit)},JSON.stringify({host:u.hostname,path:u.pathname})+'\\n');throw new Error('Acceptance permits only loopback HTTP');}
 return nativeFetch(input,init);};
SearXNGProvider.prototype.searchBatch=async function(requests,signal){const r=await fetch(${JSON.stringify(upstreamBase + '/batch')},{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(requests),signal});
 const body=await r.json().catch(()=>null); if(r.status===403&&body?.code==='batch_only')throw new SearchError({kind:'permission_denied',scope:'batch',message:'Host fixture confirms only bulk transport is denied'});
 if(!r.ok)throw searchHttpError(r);return body;};\n`);
const entry = join(root, 'dist/src/cli/bin.js');
let agentId, conversationId;
async function api(path, data, method = data === undefined ? 'GET' : 'POST') {
  const response = await fetch(base + path, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }), signal: AbortSignal.timeout(30_000) });
  const body = await response.json(); assert(response.ok, `${path}: ${response.status} ${JSON.stringify(body)}`); return body.payload ?? body;
}
async function until(predicate, label, limit = 60_000) {
  const start = Date.now(); while (Date.now() - start < limit) {
    if (fixtureFailure) throw fixtureFailure;
    if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 200));
  } throw new Error(`Timeout waiting for ${label}`);
}
async function boot() {
  child = spawn(process.execPath, ['--import', preload, entry, 'gateway', '--port', String(port), '--bind', 'loopback', '--no-hot-reload'], { cwd: root,
    env: { ...process.env, XOPC_CONFIG_PATH: configPath, XOPC_CONFIG: configPath, XOPC_STATE_DIR: state, XOPC_HOME: state,
      XOPC_WORKSPACE: workspace, PI_CODING_AGENT_DIR: join(state, 'pi'), XOPC_SKIP_CHANNELS: '1', XOPC_NO_RESPAWN: '1',
      XOPC_LOG_DIR: join(state, 'logs'), XOPC_LOG_CONSOLE: 'false', XOPC_LOG_FILE: 'false' }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', bytes => { logs += bytes; }); child.stderr.on('data', bytes => { logs += bytes; });
  await until(async () => { if (child.exitCode !== null) throw new Error(`Gateway exited ${child.exitCode}: ${logs.slice(-3000)}`);
    try { const response = await fetch(base + '/api/health'); return response.ok && (await response.json()).ready === true; } catch { return false; } }, 'Gateway readiness');
  realtime = new RealtimeClient({ clientId: 'research-acceptance', clientKind: 'tui',
    getWebSocketUrl: () => `ws://127.0.0.1:${port}/api/realtime/v1/ws`,
    issueTicket: () => api('/api/realtime/tickets', { clientId: 'research-acceptance', clientKind: 'tui', protocolVersion: REALTIME_PROTOCOL_VERSION }),
    createWebSocket: url => new WebSocket(url), onStateChange: status => { connected = status === 'connected'; },
    onEvent: event => { events.push(event); if (event.event === 'run.started') realtime.subscribe(`run:${event.data.runId}`, 0); },
  });
  realtime.subscribe('sessions'); realtime.connect(); await until(() => connected, 'realtime authentication');
}
async function stop() {
  realtime?.disconnect(); connected = false;
  if (child && child.exitCode === null) { const exited = new Promise(resolve => child.once('exit', resolve)); child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 10_000); await exited; clearTimeout(timer); }
}
function rows(goal) {
  const db = new DatabaseSync(join(state, 'xopc.db'), { readOnly: true });
  try { return db.prepare('SELECT * FROM research_checkpoints WHERE goal = ? ORDER BY updated_at DESC').all(goal)
    .map(row => ({ ...row, checkpoint: JSON.parse(row.checkpoint_json) })); } finally { db.close(); }
}
function delegateResults() {
  const db = new DatabaseSync(join(state, 'xopc.db'), { readOnly: true });
  try { return db.prepare(`SELECT payload_json FROM transcript_entries WHERE role = 'toolResult' ORDER BY created_at`).all()
    .map(row => JSON.parse(row.payload_json)).filter(message => message.toolName === 'delegate_task'); } finally { db.close(); }
}
async function turn(content, { fresh = false, limit = 60_000 } = {}) {
  const completionCount = events.filter(event => event.event === 'run.completed').length;
  if (fresh || !conversationId) { conversationId = randomUUID(); await api(`/api/sessions/${conversationId}/inputs`, {
    kind: 'start', clientMessageId: randomUUID(), creation: { agentId, projectId: null, execution: null, temporary: false, model: 'research-smoke/smoke', thinkingLevel: 'off' },
    input: { content }, origin: { type: 'system', source: 'cli' },
  }); } else {
    const history = await api(`/api/sessions/${conversationId}`);
    const config = await api(`/api/sessions/${conversationId}/agent-config`);
    await api(`/api/sessions/${conversationId}/inputs`, { kind: 'append', clientMessageId: randomUUID(), expectedTranscriptId: history.session.transcriptId,
      configVersion: config.configVersion ?? config.version ?? 0, delivery: 'next', interrupt: false, input: { content }, origin: { type: 'system', source: 'cli' } });
  }
  await until(() => events.filter(event => event.event === 'run.completed').length > completionCount, content, limit);
  const completed = events.findLast(event => event.event === 'run.completed' && event.data.conversationId === conversationId);
  assert.equal(completed?.data.status, 'success', `Parent did not deliver a result for ${content}`);
  const result = delegateResults().at(-1); assert(result, `No persisted delegate result for ${content}`);
  console.log(JSON.stringify({ stage: content, elapsedMs: Date.now() - startedAt, status: result.details?.status, stopReason: result.details?.stopReason }));
  return result;
}
function check(name, details = {}) { checks.push({ name, ...details }); console.log(JSON.stringify({ passed: name, ...details })); }
let failure;
try {
  await boot();
  assert.equal((await fetch(base + '/api/agents')).status, 401);
  const agents = await api('/api/agents'); agentId = (agents.agents ?? agents.items ?? agents)[0].id;
  await api(`/api/agents/${agentId}`, { models: { chat: { primary: 'research-smoke/smoke' } }, runtime: { codemode: { enabled: false } },
    tools: { delegate_task: { mode: 'allow' }, web_search: { mode: 'allow', maxCallsPerTurn: 3 }, data_batch: { mode: 'allow' } } }, 'PATCH');
  check('real_gateway_authentication');
  for (const prefix of ['batch-only', 'batch-partial', 'batch-rate', 'batch-denied', 'batch-timeout']) {
    const result = await turn(`E2E_${prefix}`, { fresh: true });
    const calls = searchCalls.filter(call => call.prefix === prefix || call.query?.startsWith(prefix + ':'));
    assert.equal(calls.filter(call => call.path === '/batch').length, 1, 'Native batch must run once');
    const expectedSingles = prefix === 'batch-denied' ? 0 : prefix === 'batch-partial' ? 1 : 2;
    assert.equal(calls.filter(call => call.path === '/search').length, expectedSingles, 'Only unfinished unique items may use individual fallback');
    if (prefix === 'batch-rate') assert(calls.find(call => call.path === '/search').at - calls[0].at >= 900, 'Retry-After was ignored');
    if (prefix === 'batch-denied') assert(result.details.checkpoint.evidence.some(item => item.excerpt.includes('permission_denied')), 'Permission failure lost its type');
    check(prefix, { batchRequests: 1, individualRequests: expectedSingles });
  }
  await turn('E2E_INDIVIDUAL_RATE', { fresh: true }); assert.equal(sourceCounts('rate-once'), 2);
  const limited = searchCalls.filter(call => call.query === 'rate-once'); assert(limited[1].at - limited[0].at >= 900); check('individual_rate_limit_backoff');
  await turn('E2E_INDIVIDUAL_DENIED', { fresh: true }); assert.equal(sourceCounts('permission-denied-single'), 1); check('individual_permission_denial');
  if (!searchOnly) {
    await turn('E2E_TIMEOUT_FIRST', { fresh: true, limit: 150_000 }); timeoutFirstDone = true;
    const first = rows(goals.timeout)[0]; assert.equal(first.status, 'partial'); assert.equal(first.stop_reason, 'deadline_exceeded');
    assert.equal(first.checkpoint.findings[0].conclusion, 'E2E_VERIFIED_BEFORE_TIMEOUT');
    assert.equal(first.checkpoint.searches.length, 1); assert(timeoutHeldAt && timeoutAbortedAt && timeoutAbortedAt > timeoutHeldAt);
    resumeId = first.id; const capturedAt = first.checkpoint.searches[0].capturedAt;
    check('research_timeout_checkpoint', { stopReason: first.stop_reason, heldRequestMs: timeoutAbortedAt - timeoutHeldAt });
    await stop(); await boot();
    await turn('E2E_TIMEOUT_RESUME'); const resumed = rows(goals.timeout)[0];
    assert.equal(resumed.status, 'completed'); assert.equal(resumed.attempts, 2); assert.equal(resumed.checkpoint.nextSteps.length, 0);
    assert.equal(resumed.checkpoint.searches[0].capturedAt, capturedAt); assert.equal(sourceCounts('timeout-proof'), 1);
    check('restart_resume_and_cache_reuse', { attempts: 2, backendSearchRequests: 1 });
    await turn('E2E_ISOLATION', { fresh: true }); assert.equal(sourceCounts('timeout-proof'), 2); check('cache_task_isolation');
    await turn('E2E_REVOKE_FIRST', { fresh: true }); revokeResumeId = rows(goals.revoke)[0].id;
    await api(`/api/agents/${agentId}`, { tools: { web_search: { mode: 'deny' } } }, 'PATCH');
    const denied = await turn('E2E_REVOKE_RESUME'); assert.equal(denied.details.stopReason, 'parent_policy');
    assert.equal(sourceCounts('cache-revocation-proof'), 1); assert.equal(rows(goals.revoke)[0].attempts, 1); check('revoked_search_permission_blocks_resume');
  }
  await api(`/api/agents/${agentId}`, { tools: { web_search: { mode: 'allow', maxCallsPerTurn: 3 } } }, 'PATCH');
  const quotaBefore = searchCalls.length;
  const quota = await turn('E2E_QUOTA_DENIED', { fresh: true });
  assert.equal(quota.details.stopReason, 'parent_policy'); assert.equal(searchCalls.length, quotaBefore, 'Denied quota must not start any transport');
  check('batch_query_quota_enforced_without_duplicate_counting', { admittedQueries: 3, deniedQueries: 4, rejectedBatchSourceRequests: 0 });
  const blocked = (() => { try { return readFileSync(networkAudit, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)); } catch { return []; } })();
  assert(!blocked.some(item => item.host.includes('duckduckgo') || item.host.includes('bing.com')), 'A refused search escaped to HTML'); check('no_html_permission_bypass');
  assert(events.some(event => event.event === 'tool_end' && event.data?.payload?.toolName === 'delegate_task'), 'Realtime tool completion missing');
  check('realtime_delivery_and_sqlite_tool_results');
} catch (error) { failure = error instanceof Error ? error.stack : String(error); console.error(failure); console.error(logs.slice(-6000)); process.exitCode = 1; }
finally {
  await stop(); upstream.closeAllConnections(); await new Promise(resolve => upstream.close(resolve));
  const report = { passed: !failure, failure, startedAt: new Date(startedAt).toISOString(), durationMs: Date.now() - startedAt,
    fixture: 'real isolated Gateway, authenticated REST/realtime, real SQLite, controlled model/search HTTP services',
    productionBudgetsUnchanged: true, scope: searchOnly ? 'search-and-quota' : 'full', checks, searchCalls, modelCalls, stateDirectory: state,
    sourceHashes: Object.fromEntries(['src/agent/tools/delegation-policy.ts', 'src/agent/orchestration/agent-turn-policy.ts', 'src/agent/child-agent-factory.ts',
      'src/agent/tools/delegate-tool.ts', 'src/agent/tools/search/registry.ts', 'src/agent/data-acquisition/service.ts'].map(path => [path, createHash('sha256').update(readFileSync(join(root, path))).digest('hex')])) };
  mkdirSync(resolve(reportPath, '..'), { recursive: true }); writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  writeFileSync(join(state, 'gateway.log'), logs, { mode: 0o600 }); console.log(JSON.stringify({ passed: !failure, checks: checks.length, reportPath, stateDirectory: state }));
  if (process.env.XOPC_RESEARCH_GATEWAY_KEEP_STATE !== '1' && !failure) rmSync(state, { recursive: true, force: true });
}
