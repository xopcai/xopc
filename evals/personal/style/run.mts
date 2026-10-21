import { randomUUID, createHash } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { parseArgs } from 'node:util';

import { serve } from '@hono/node-server';
import { EvalStore, ArtifactStore } from '../../coder/packages/storage/src/index.js';
import { TraceEmitter, redactSensitive, type EvalCase } from '../../coder/packages/protocol/src/index.js';
import { runRealtimeInput } from '../../coder/packages/adapters/xopc/src/realtime-run.js';

const { values } = parseArgs({ options: {
  out: { type: 'string', default: `.xopc-evals/personal-style/${new Date().toISOString().replace(/[:.]/g, '-')}` },
  upstream: { type: 'string', default: '.xopc-evals/style-upstream' },
  model: { type: 'string' }, judge: { type: 'string' },
  persona: { type: 'string' },
  'eq-cases': { type: 'string', default: '12' }, 'follow-cases': { type: 'string', default: '150' },
  concurrency: { type: 'string', default: '2' }, 'dry-run': { type: 'boolean' },
  'dialogue-fixtures': { type: 'string' },
  'fresh-profile': { type: 'boolean' },
  'eq-case-id': { type: 'string' },
} });
for (const key of ['eq-cases', 'follow-cases', 'concurrency'] as const) {
  if (!/^\d+$/.test(values[key]!) || Number(values[key]) < 1) throw new Error(`Invalid --${key}`);
}
if (Number(values.concurrency) > 4) throw new Error('Concurrency must be at most 4');
const out = resolve(values.out!);
if (existsSync(out)) throw new Error(`Refusing to overwrite ${out}`);
mkdirSync(out, { recursive: true });
const upstream = resolve(values.upstream!);
const pins = JSON.parse(readFileSync(new URL('./upstreams.json', import.meta.url), 'utf8'));
const hash = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
const fingerprint = () => {
  const paths = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', 'src', 'packages', 'evals/personal/style', 'pnpm-lock.yaml'], { encoding: 'utf8' }).trim().split('\n');
  paths.push('evals/personal/style/request_pools.py', 'evals/personal/style/request-pools.mts', 'evals/personal/style/run.mts', 'evals/personal/style/driver.py', 'evals/personal/style/protocol.py', 'evals/personal/style/upstreams.json');
  return hash(JSON.stringify([...new Set(paths)].sort().map(path => [path, hash(readFileSync(path))])));
};
for (const [name, pin] of Object.entries(pins) as Array<[string, { commit: string }]>) {
  const path = join(upstream, name);
  if (execFileSync('git', ['-C', path, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() !== pin.commit
    || execFileSync('git', ['-C', path, 'status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8' }).trim()) {
    throw new Error(`${name}: run eval:personal:style:prepare to obtain clean pinned upstreams`);
  }
}
const sourceRoot = process.env.XOPC_STATE_DIR ?? join(homedir(), '.xopc');
const credentials = process.env.XOPC_CREDENTIALS_DIR ?? join(sourceRoot, 'credentials');
const configSource = process.env.XOPC_CONFIG_PATH ?? join(sourceRoot, 'xopc.json');
const sourceDb = new DatabaseSync(join(sourceRoot, 'xopc.db'), { readOnly: true });
sourceDb.exec('PRAGMA busy_timeout=5000');
const defaults = JSON.parse(String(sourceDb.prepare('SELECT defaults_json FROM agent_catalog_settings LIMIT 1').get()!.defaults_json));
const personalSource = values['fresh-profile'] ? undefined : sourceDb.prepare("SELECT a.profile_json,a.overrides_json,s.conversation_id FROM agents a JOIN sessions s ON a.id=s.agent_id WHERE json_extract(s.custom_data_json,'$.personalAgent')=1 AND a.deleted_at IS NULL LIMIT 1").get();
const selection = personalSource ? sourceDb.prepare('SELECT model_override FROM session_config WHERE conversation_id=?').get(String(personalSource.conversation_id)) : undefined;
sourceDb.close();
const model = values.model ?? (selection?.model_override as string | undefined) ?? defaults.models.intents.fast?.primary ?? defaults.models.chat.primary;
const judge = values.judge ?? defaults.models.intents.review?.primary ?? defaults.models.chat.primary;
const personaModel = values.persona ?? defaults.models.intents.reasoning?.primary ?? defaults.models.chat.primary;
const dialogueFixtures = values['dialogue-fixtures'] ? resolve(values['dialogue-fixtures']) : undefined;
const dialogueFixtureHash = dialogueFixtures ? hash(readFileSync(dialogueFixtures)) : undefined;
const manifest = {
  sourceOrigin: existsSync('.xopc-source-origin.json') ? JSON.parse(readFileSync('.xopc-source-origin.json', 'utf8')) : null,
  schemaVersion: 1, suite: 'personal-dialogue-style', version: '1.0.0', createdAt: new Date().toISOString(),
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  workingTreeDirty: Boolean(execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim()),
  sourceHash: fingerprint(), upstreams: pins, model, judge, persona: personaModel,
  eqCases: Number(values['eq-cases']), followCases: Number(values['follow-cases']), concurrency: Number(values.concurrency),
  eqTurns: 8, repetitions: 1, reasoning: 'off', evaluatorReasoning: 'low',
  ...(process.env.XOPC_STYLE_POOL_URL ? { requestPools: { generation: 4, judge: 4, scenes: 3, sharedAcrossProcesses: true, adaptiveDownshift: true } } : {}),
  personalProfile: personalSource ? 'existing-profile-isolated-state' : 'fresh-production-default',
  protocol: 'production Personal prompt; EQ evaluator system context delivered as labeled user-message context on each turn; no persona cards or judge data exposed',
  limitations: ['EQ sampled pointwise trait profile, not official pairwise leaderboard rating', 'One judge and one simulated-user model; results depend on both', 'FollowBench style adherence is not conversational naturalness', 'No production history, user memory, connectors or external side effects', 'Model-catalog cost estimates are not billing receipts'],
  ...(dialogueFixtures ? { mode: 'scripted-dialogue', dialogueFixtureHash, eqCases: 0, followCases: 0,
    protocol: 'production Personal prompt; fixed scripted user turns; expectations remain evaluator-side; separately judged after capture' } : {}),
  ...(values['eq-case-id'] ? { mode: 'single-eq-capture', eqCaseId: values['eq-case-id'], eqCases: 1, followCases: 0 } : {}),
};
writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2));
if (values['dry-run']) { console.log(JSON.stringify(manifest, null, 2)); process.exit(0); }
const state = mkdtempSync(join(tmpdir(), 'xopc-personal-style-'));
process.once('exit', () => rmSync(state, { recursive: true, force: true }));
const workspace = join(state, 'workspace'); mkdirSync(workspace);
const token = randomUUID();
const config = JSON.parse(readFileSync(configSource, 'utf8'));
config.gateway = { ...config.gateway, auth: { mode: 'token', token }, tailscale: { mode: 'off' } };
if (config.tunnel) config.tunnel.enabled = false;
for (const channel of Object.values(config.channels ?? {}) as Array<Record<string, unknown>>) channel.enabled = false;
if (config.heartbeat) config.heartbeat.enabled = false;
config.userContext = { ...config.userContext, enabled: false };
const configPath = join(state, 'xopc.json');
writeFileSync(configPath, JSON.stringify(config), { mode: 0o600 });
if (existsSync(join(sourceRoot, 'cache/model-catalog'))) cpSync(join(sourceRoot, 'cache/model-catalog'), join(state, 'cache/model-catalog'), { recursive: true });
Object.assign(process.env, { XOPC_STATE_DIR: state, XOPC_CONFIG_PATH: configPath, XOPC_CONFIG: configPath,
  XOPC_CREDENTIALS_DIR: credentials, XOPC_WORKSPACE: workspace, XOPC_LOG_DIR: join(state, 'logs'),
  XOPC_LOG_LEVEL: 'fatal', XOPC_LOG_CONSOLE: 'false' });
await import('../../../src/infra/http-proxy-env.js');
const { openXopcDatabase, closeXopcDatabase, getSqliteDatabase, setSessionConfig } = await import('../../../src/storage/sqlite/index.js');
const { AgentCatalogRepository } = await import('../../../src/agent-catalog/repository.js');
const { createConversation } = await import('../../../src/storage/sqlite/conversation-repository.js');
const { GatewayService } = await import('../../../src/gateway/service.js');
const { createHonoApp } = await import('../../../src/gateway/hono/app.js');
const { resolveModel } = await import('../../../src/providers/index.js');
const { completeWithResolvedCredentials } = await import('../../../src/providers/model-call.js');
openXopcDatabase({ path: join(state, 'xopc.db') });
const catalog = new AgentCatalogRepository(); catalog.ensureInitialized(defaults);
const service = new GatewayService({ configPath, enableHotReload: false, listenPort: 0 });
const store = new EvalStore(join(out, 'evals.db'));
const artifacts = new ArtifactStore(join(out, 'artifacts'));
const experiments = new Map<string, string>();
const runs = new Map<string, { runId: string; conversationId: string; trace: TraceEmitter; usage: Record<string, number>; runtimeIdentity: Record<string, unknown>; done: boolean; startedAt: number; calls: number }>();
let gateway: ReturnType<typeof serve> | undefined;
let bridge: ReturnType<typeof createServer> | undefined;
let success = false;
const write = (name: string, value: unknown) => writeFileSync(join(out, name), JSON.stringify(redactSensitive(value), null, 2));
try {
  await service.start();
  gateway = serve({ fetch: createHonoApp({ service }).fetch, hostname: '127.0.0.1', port: 0 });
  if (!gateway.listening) await once(gateway, 'listening');
  gateway.on('upgrade', (req, socket, head) => {
    if (!service.realtime.handleUpgrade(req, socket, head)) socket.destroy();
  });
  const baseUrl = `http://127.0.0.1:${(gateway.address() as { port: number }).port}`;
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const api = async (path: string, body?: unknown) => {
    const response = await fetch(baseUrl + path, { headers, ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }), signal: AbortSignal.timeout(60_000) });
    const data = await response.json() as Record<string, any>;
    if (!response.ok) throw new Error(`Gateway ${response.status}: ${JSON.stringify(data)}`);
    return data.payload;
  };
  const personal = await api('/api/personal-agent', { model });
  if (!personal?.agentId) throw new Error('Personal provisioning did not return an agentId');
  if (personalSource?.profile_json) {
    const current = catalog.get(personal.agentId)!;
    catalog.update(personal.agentId, current.revision, { id: personal.agentId, enabled: current.enabled, profile: JSON.parse(String(personalSource.profile_json)) });
    service.refreshAgentCatalog();
  }
  write('runtime.json', { personalAgentId: personal.agentId, profile: catalog.get(personal.agentId)?.profile, model });
  const ensureRun = async (caseId: string, suite: string) => {
    if (runs.has(caseId)) return runs.get(caseId)!;
    let experimentId = experiments.get(suite);
    if (!experimentId) {
      experimentId = randomUUID(); experiments.set(suite, experimentId);
      store.createExperiment({ id: experimentId, name: `Personal style ${suite}`, suiteId: suite, suiteVersion: '1.0.0', suiteHash: hash(JSON.stringify(manifest)),
        spec: { name: 'Personal style baseline', variants: [{ id: 'personal', adapter: 'personal-dialogue', agentId: personal.agentId, model, reasoning: 'off', config: { judge, persona: personaModel } }], repetitions: 1 } });
    }
    const runId = randomUUID(), conversationId = randomUUID();
    const caseWorkspace = join(workspace, runId); mkdirSync(caseWorkspace);
    createConversation({ agentId: personal.agentId, sourceChannel: 'webchat', name: caseId, hiddenFromSessionList: true,
      customData: { personalAgent: true, keepHiddenFromSessionList: true } }, caseWorkspace, conversationId);
    setSessionConfig(conversationId, { modelOverride: model, fixedModel: true, thinkingLevel: 'off', workingDirectoryOverride: caseWorkspace }, caseWorkspace);
    const evalCase: EvalCase = { id: caseId, task: 'Dialogue style evaluation; private fixtures remain evaluator-side', repo: { source: 'local', path: caseWorkspace, commit: manifest.commit }, budget: { timeoutMs: 1_800_000 }, graders: [], tags: ['dialogue', suite] };
    store.createRun({ id: runId, experimentId, evalCase, variantId: 'personal', adapter: 'personal-dialogue', sourceCommit: manifest.commit, fixtureCommit: dialogueFixtureHash ?? pins[suite === 'followbench-zh-style' ? 'followbench' : 'eqbench4'].commit });
    const trace = new TraceEmitter(runId, event => store.appendEvent(event));
    const runtimeIdentity = await api(`/api/eval/runtime-identity?agentId=${encodeURIComponent(personal.agentId)}`);
    const run = { runId, conversationId, trace, usage: {} as Record<string, number>, runtimeIdentity, done: false, startedAt: Date.now(), calls: 0 };
    runs.set(caseId, run); await trace.emit('run.started', { caseId, suite }); return run;
  };
  const evaluator = async (body: Record<string, any>) => {
    const modelRef = body.role === 'persona' ? personaModel : judge;
    const resolvedModel = resolveModel(modelRef);
    const messages = body.messages.filter((m: any) => m.role !== 'system').map((m: any) => m.role === 'assistant'
      ? { role: 'assistant', content: [{ type: 'text', text: m.content }], api: resolvedModel.api, provider: resolvedModel.provider, model: resolvedModel.id,
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: 'stop', timestamp: Date.now() }
      : { role: 'user', content: m.content, timestamp: Date.now() });
    const result = await completeWithResolvedCredentials(resolvedModel, { systemPrompt: body.messages.filter((m: any) => m.role === 'system').map((m: any) => m.content).join('\n'), messages },
      { maxTokens: Math.min(body.max_tokens ?? 10000, 16000), reasoning: 'low', temperature: body.temperature ?? 0.7, signal: AbortSignal.timeout(240_000) }, undefined,
      { operation: 'personal_style_evaluator', trigger: 'user' });
    if (result.errorMessage || result.stopReason === 'error' || result.stopReason === 'aborted') throw new Error(result.errorMessage ?? result.stopReason);
    const content = result.content.filter(c => c.type === 'text').map(c => c.text).join('\n');
    if (!content.trim()) throw new Error('Empty evaluator response');
    return { content, model: modelRef, backend: 'custom', usage: result.usage, cost_usd: resolvedModel.provider === 'xopc-cloud' ? null : result.usage.cost.total, cost_source: resolvedModel.provider === 'xopc-cloud' ? 'unavailable' : 'model_catalog' };
  };
  bridge = createServer(async (req, res) => {
    if (req.headers.authorization !== `Bearer ${token}`) { res.writeHead(401).end(); return; }
    try {
      let raw = ''; for await (const chunk of req) { raw += chunk; if (raw.length > 4_000_000) throw new Error('Request too large'); }
      const body = JSON.parse(raw) as Record<string, any>;
      if (req.url === '/finish') {
        const run = await ensureRun(body.caseId, body.suite);
        if (run.done) throw new Error('Duplicate case completion');
        const artifact = artifacts.putText(run.runId, 'style-result', JSON.stringify(body.result), 'application/json'); store.recordArtifact(artifact);
        const error = body.result.error as string | undefined;
        // EQ traits are neutral tendencies: scored profiles never become quality passes.
        const follow = body.suite === 'followbench-zh-style';
        const grade = { graderIndex: 0, graderType: 'external_model_judge' as const, category: 'quality' as const, required: follow, weight: 1,
          passed: !error && (follow ? Boolean(body.result.hardSatisfied) : false), score: error ? 0 : follow ? body.result.softScore : 0,
          summary: error ?? (follow ? JSON.stringify(body.result.verdicts) : dialogueFixtures ? 'Scripted dialogue capture; judging is separate' : 'EQ neutral trait profile; no quality threshold or official rank'), artifactRefs: [artifact.id], durationMs: body.result.durationMs ?? 0 };
        if (follow) store.recordGrade(run.runId, grade);
        await run.trace.emit(error ? 'run.failed' : 'run.completed', { error: error ?? null, profileOnly: !follow });
        store.completeRun(run.runId, { status: error ? 'error' : follow ? grade.passed ? 'passed' : 'failed' : 'completed', finalText: body.result.answer ?? JSON.stringify(body.result.transcript ?? body.result.traits ?? {}),
          conversationId: run.conversationId, usage: run.usage, runtimeIdentity: run.runtimeIdentity, ...(error ? { error } : {}), score: grade.score });
        run.done = true; console.log(`${body.caseId}: ${error ? 'ERROR' : follow ? grade.passed ? 'PASS' : 'FAIL' : 'PROFILE'}`);
        res.writeHead(200, { 'Content-Type': 'application/json' }).end('{}'); return;
      }
      const run = await ensureRun(body.caseId, body.suite);
      if (++run.calls > 48 || Date.now() - run.startedAt > 1_800_000) throw new Error('Case request/time budget exceeded');
      await run.trace.emit('model.request', { role: body.role, messages: body.messages, model: body.role === 'evaluated' ? model : body.role === 'persona' ? personaModel : judge });
      let result: Record<string, any>;
      if (body.role === 'evaluated') {
        const meta = getSqliteDatabase().prepare('SELECT active_transcript_id FROM sessions WHERE conversation_id=?').get(run.conversationId)!;
        const selected = await api(`/api/sessions/${run.conversationId}/agent-config`);
        const userMessage = body.messages.at(-1);
        if (userMessage?.role !== 'user') throw new Error('Candidate request must end with user message');
        let text = userMessage.content as string;
        if (body.systemContext) text = `[Benchmark interaction context]\n${body.systemContext}\n[/Benchmark interaction context]\n\n${text}`;
        let answer = '', failed = '', usage: Record<string, number> = {};
        await runRealtimeInput({ baseUrl, headers, conversationId: run.conversationId, transcriptId: String(meta.active_transcript_id), configVersion: selected.configVersion,
          message: text, thinking: 'off', signal: AbortSignal.timeout(240_000), onRunId: () => {}, onEvent: async (event, data) => {
            await run.trace.emit('agent.event', { event, data });
            const type = typeof data.type === 'string' ? data.type : event;
            const payload = (data.payload ?? {}) as Record<string, any>;
            if (type === 'assistant_delta' && typeof payload.delta === 'string') answer += payload.delta;
            if (type === 'error') failed = String(payload.message ?? JSON.stringify(payload));
            if (type === 'run_end' && payload.status !== 'success') failed = String(payload.summary ?? payload.status);
            if (type === 'assistant_message_end' && payload.usage) {
              for (const [key, value] of Object.entries(payload.usage)) if (typeof value === 'number') usage[key] = (usage[key] ?? 0) + value;
            }
          } });
        if (failed || !answer.trim()) throw new Error(failed || 'Personal returned no text');
        result = { content: answer, model, backend: 'custom', usage, cost_usd: null, cost_source: 'unavailable' };
      } else result = await evaluator(body);
      for (const [key, value] of Object.entries(result.usage ?? {})) if (typeof value === 'number') run.usage[`${body.role}.${key}`] = (run.usage[`${body.role}.${key}`] ?? 0) + value;
      await run.trace.emit('model.response', { role: body.role, ...result });
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(result));
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    }
  });
  bridge.listen(0, '127.0.0.1'); await once(bridge, 'listening');
  const bridgeUrl = `http://127.0.0.1:${(bridge.address() as { port: number }).port}`;
  const child = spawn(join(upstream, 'eqbench4/.venv/bin/python'), [resolve('evals/personal/style/driver.py'), '--out', out, '--upstream', upstream,
    '--eq-cases', values['eq-cases']!, '--follow-cases', values['follow-cases']!, '--concurrency', values.concurrency!,
    ...(dialogueFixtures ? ['--dialogue-fixtures', dialogueFixtures] : []),
    ...(values['eq-case-id'] ? ['--eq-case-id', values['eq-case-id']] : [])],
    { stdio: 'inherit', env: { ...process.env, XOPC_STYLE_BRIDGE: bridgeUrl, XOPC_STYLE_TOKEN: token, PYTHONPATH: join(upstream, 'eqbench4/src') } });
  const [code] = await once(child, 'exit');
  const sourceHashEnd = fingerprint();
  write('completion.json', { exitCode: code, sourceHashEnd, sourceChanged: sourceHashEnd !== manifest.sourceHash, experiments: Object.fromEntries(experiments), costUsd: null });
  success = code === 0 && sourceHashEnd === manifest.sourceHash;
  if (!success) process.exitCode = 1;
} finally {
  for (const run of runs.values()) if (!run.done) store.completeRun(run.runId, { status: 'error', finalText: '', error: 'Harness ended before grading', score: 0 });
  for (const id of experiments.values()) store.completeExperiment(id, success ? 'completed' : 'failed');
  if (bridge) { bridge.closeAllConnections(); await new Promise<void>(resolve => bridge!.close(() => resolve())); }
  if (gateway) { if ('closeAllConnections' in gateway) gateway.closeAllConnections(); await new Promise<void>(resolve => gateway!.close(() => resolve())); }
  await service.stop(); closeXopcDatabase(); store.close();
  // Retain only synthetic receipts, never the copied config containing provider settings.
  rmSync(state, { recursive: true, force: true });
}
console.log(`Personal style results: ${out}`);
process.exit(process.exitCode ?? 0);
