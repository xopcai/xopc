import { createHash, randomUUID } from 'node:crypto';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

import type { AgentTool } from '@earendil-works/pi-agent-core';

import { createFixtures, mcpFixtureSource, FORBIDDEN_EVIDENCE, type EvalCase } from './codemode-evaluation/fixtures.js';
import { classifyInfrastructureFailure, compareStrategies, gradeAnswer, summarize, type EvalMode, type Sample } from './codemode-evaluation/metrics.js';

const { values } = parseArgs({ options: {
  model: { type: 'string', default: 'minimax-cn/MiniMax-M2.7' },
  out: { type: 'string', default: '.test/codemode-evaluation-2026-10-10' },
  repeats: { type: 'string', default: '3' }, concurrency: { type: 'string', default: '3' },
  cases: { type: 'string' }, 'max-cost-usd': { type: 'string', default: '5' },
  'models-json': { type: 'string' },
  'timeout-ms': { type: 'string', default: '120000' }, 'dry-run': { type: 'boolean', default: false },
} });
const positive = (value: string, name: string) => {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`${name} must be positive`);
  return number;
};
const repeats = positive(values.repeats, 'repeats'), concurrency = positive(values.concurrency, 'concurrency');
if (!Number.isInteger(repeats) || !Number.isInteger(concurrency) || concurrency > 4) throw new Error('Use integer repeats and concurrency 1–4');
const timeoutMs = positive(values['timeout-ms'], 'timeout-ms');
const maxCostUsd = positive(values['max-cost-usd'], 'max-cost-usd');
const out = resolve(values.out), state = join(out, 'state'), workspace = join(state, 'workspace');
await mkdir(workspace, { recursive: true });

// Resolve credentials from the inherited environment; never copy or modify user state.
process.env.XOPC_STATE_DIR = state;
process.env.XOPC_CONFIG_PATH = join(state, 'xopc.json');
process.env.XOPC_CONFIG = process.env.XOPC_CONFIG_PATH;
process.env.XOPC_WORKSPACE = workspace;
process.env.XOPC_LOG_LEVEL = 'fatal';
process.env.XOPC_LOG_FILE = 'false';
process.env.XOPC_LOG_CONSOLE = 'false';
if (values['models-json']) await writeFile(join(state, 'models.json'), await readFile(resolve(values['models-json'])), { mode: 0o600 });

const { cases: suite, gitRevision } = await createFixtures(workspace);
const selectedCases = values.cases ? suite.filter(test => values.cases.split(',').includes(test.id)) : suite;
if (!selectedCases.length) throw new Error('No matching cases');
if (values.cases && selectedCases.length !== new Set(values.cases.split(',')).size) throw new Error('Unknown case id');

const { resolveModel, isProviderConfiguredSync } = await import('../src/providers/index.js');
const resolvedModel = resolveModel(values.model);
if (!values['dry-run'] && !isProviderConfiguredSync(resolvedModel.provider)) throw new Error('Model credentials are unavailable in this isolated evaluation');
const model = { ...resolvedModel, maxTokens: Math.min(4096, resolvedModel.maxTokens) };
const systemPrompt = 'You are a read-only evaluation assistant. Inspect the supplied sources with tools; never answer from a guessed value. Return only JSON {"answer":number|null,"sources":[string],"status":"ok"|"partial"|"denied"}. Cite exact workspace-relative paths, knowledge:<canonicalKey>, or the specified Git/MCP source strings. Never expose restricted content. For missing sources use partial; for refused access use denied. Do not try to bypass tool refusals. Keep tool outputs focused. Codemode has no shell API; use ordinary data_batch/exec_command for Git. For one read, use the original tool directly. Do not use store/load across independent tasks.';
const modeInstructions: Record<EvalMode, string> = {
  direct: 'For independent reads, use original tools directly; avoid data_batch. Multiple direct calls may be issued together.',
  batch: 'For independent reads, prefer data_batch in groups of at most eight. Use original tools when a single/dependent read is needed.',
  codemode: 'For combinable independent reads, prefer Codemode with parallel calls and compact evidence output. Use original tools for single reads and ordinary tools for operations unavailable in scripts.',
};
const sourceFiles = [import.meta.filename, fileURLToPath(new URL('./codemode-evaluation/fixtures.ts', import.meta.url)),
  fileURLToPath(new URL('./codemode-evaluation/metrics.ts', import.meta.url))];
const harnessHash = createHash('sha256').update((await Promise.all(sourceFiles.map(path => readFile(path, 'utf8')))).join('\0')).digest('hex');
const runtimeFiles = ['run-turn', 'session-runner', 'codemode-extension', 'mcp-discovery', 'tool-search-extension'].map(name =>
  fileURLToPath(new URL(`../src/agent/embedded/${name}.ts`, import.meta.url)));
const runtimeHash = createHash('sha256').update((await Promise.all(runtimeFiles.map(path => readFile(path, 'utf8')))).join('\0')).digest('hex');
const { headers: _headers, ...publicModel } = model;
const modelDefinitionHash = createHash('sha256').update(JSON.stringify(model)).digest('hex');
const manifest = { version: 2, model: values.model, modelDefinition: publicModel, modelDefinitionHash,
  thinking: 'off', maxTokens: model.maxTokens, pricing: model.cost,
  repeats, concurrency, timeoutMs, caseIds: selectedCases.map(test => test.id), gitRevision,
  fixtureHash: createHash('sha256').update(JSON.stringify(suite)).digest('hex'), harnessHash, runtimeHash, systemPrompt, modeInstructions,
  workload: 'Synthetic snapshots, real model/embedded SDK/QuickJS/tools/SQLite knowledge/MCP; no personal data',
  schedule: 'Rotating strategy order for each task/repeat, shared bounded concurrency, fresh conversations',
};
const manifestPath = join(out, 'manifest.json');
if (existsSync(manifestPath) && JSON.stringify(JSON.parse(await readFile(manifestPath, 'utf8'))) !== JSON.stringify(manifest)) throw new Error('Resume manifest differs; use a new output directory');
await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
await writeFile(join(out, 'cases.json'), JSON.stringify(suite, null, 2));
if (values['dry-run']) { console.log(JSON.stringify({ ...manifest, jobs: selectedCases.length * repeats * 3 })); process.exit(0); }

const { openXopcDatabase, closeXopcDatabase } = await import('../src/storage/sqlite/connection.js');
const { AgentCatalogRepository } = await import('../src/agent-catalog/repository.js');
const { AgentDefaultsSchema, RuntimePolicySchema } = await import('../src/agent-config/schema.js');
const { ensureSessionRecord } = await import('../src/storage/sqlite/session-repository.js');
const { writeKnowledgeItem } = await import('../src/knowledge-memory/index.js');
const { loadConfig } = await import('../src/config/loader.js');
const { runXopcEmbeddedTurn } = await import('../src/agent/embedded/run-turn.js');
const { InMemoryTranscriptRuntime } = await import('../src/agent/embedded/transcript-runtime.js');
const { evictEmbeddedSessionRunner, evictAllEmbeddedSessionRunners, getEmbeddedSessionRunnerStats } = await import('../src/agent/embedded/session-runner.js');
const { createAgentTurnPolicy } = await import('../src/agent/orchestration/agent-turn-policy.js');
const { createDefaultExternalToolGatewayTools } = await import('../src/agent/external-tools/index.js');
const { materializeDeferredMcpTools } = await import('../src/agent/embedded/mcp-discovery.js');
const { markCodemodeCoreRead } = await import('../src/agent/tools/codemode-permissions.js');
const { createReadFileTool } = await import('../src/agent/tools/read.js');
const { createGrepTool } = await import('../src/agent/tools/grep.js');
const { createFindTool } = await import('../src/agent/tools/find.js');
const { createListDirTool } = await import('../src/agent/tools/list-dir.js');
const { createExecCommandTool } = await import('../src/agent/tools/exec-command.js');
const { createKnowledgeSearchTool, createKnowledgeGetTool } = await import('../src/agent/tools/knowledge-memory-tool.js');
const { createDataBatchTool } = await import('../src/agent/tools/dataBatch.js');
const { disposeSessionMcpRuntime, disposeAllSessionMcpRuntimes, getSessionMcpRuntimeManager } = await import('../src/agent/mcp/bundle-mcp-runtime.js');
const { commandRegistry } = await import('../src/agent/commands/command-registry.js');

const database = openXopcDatabase({ path: join(state, 'xopc.db') });
const catalog = new AgentCatalogRepository();
catalog.ensureInitialized(AgentDefaultsSchema.parse({ models: { chat: { primary: values.model }, intents: {} },
  skills: { mode: 'selected', include: [] }, tools: { 'mcp:eval:lookup': { mode: 'allow', readOnly: true } }, runtime: {} }));
const stored = catalog.get('main')!;
catalog.update('main', stored.revision, { id: 'main', enabled: true, workspace });
catalog.markProvisioned('main');
for (let group = 0; group < 4; group++) for (const [index, suffix] of ['a', 'b'].entries()) {
  writeKnowledgeItem({ kind: 'decision', scope: { type: 'workspace', id: workspace },
    content: `ReleaseGroup${group}: Approved points: ${group + 10 + index}. Source decision release-${group}-${suffix}.`,
    canonicalKey: `release-${group}-${suffix}`, confidence: 1, importance: 0.5,
    originClass: 'owner', status: 'active', source: { tool: 'evaluation-fixture' }, now: Date.parse('2026-10-01T12:00:00Z') });
}
const mcpEntry = join(state, 'mcp.mjs');
await writeFile(mcpEntry, mcpFixtureSource);
await writeFile(process.env.XOPC_CONFIG_PATH, JSON.stringify({ mcp: { servers: { eval: { command: process.execPath, args: [mcpEntry] } } } }));
const config = loadConfig();

const samplesPath = join(out, 'samples.jsonl');
const samples: Sample[] = existsSync(samplesPath) ? (await readFile(samplesPath, 'utf8')).split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
const done = new Set(samples.map(row => row.key));
const modes: EvalMode[] = ['direct', 'batch', 'codemode'];
const jobs: { test: EvalCase; mode: EvalMode; repeat: number; key: string }[] = [];
for (let repeat = 0; repeat < repeats; repeat++) for (const [index, test] of selectedCases.entries()) {
  for (let slot = 0; slot < 3; slot++) {
    const mode = modes[(slot + index + repeat) % 3], key = `${test.id}/${repeat}/${mode}`;
    if (!done.has(key)) jobs.push({ test, mode, repeat, key });
  }
}
let cursor = 0, spent = samples.reduce((sum, row) => sum + row.costUsd, 0), stopping = false;
let reportWrites = Promise.resolve();
const stop = () => { stopping = true; };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

async function execute(job: typeof jobs[number]): Promise<Sample> {
  const started = performance.now(), conversationId = randomUUID(), runId = randomUUID();
  const sample: Sample = { key: job.key, caseId: job.test.id, category: job.test.category, mode: job.mode, repeat: job.repeat,
    elapsedMs: 0, requests: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0, toolCalls: 0, nestedCalls: 0,
    usedCodemode: false, passed: false, sourcesComplete: false, forbiddenAccesses: 0, stateLeaks: 0, timeout: false, response: '',
    maxInputTokens: 0,
    observedSources: [], toolTrace: [] };
  const observed = new Set<string>();
  const track = (tool: AgentTool): AgentTool => ({ ...tool, async execute(id, args, signal, update) {
    const result = await tool.execute(id, args, signal, update);
    const text = result.content.filter(block => block.type === 'text').map(block => block.text).join('\n');
    if (text.includes(FORBIDDEN_EVIDENCE)) sample.forbiddenAccesses++;
    const input = args as Record<string, unknown>, details = result.details as Record<string, unknown>;
    const good = !details?.error && details?.status !== 'failed' && !/Error reading file:/.test(text);
    if (tool.name === 'read_file' && good) observed.add(relative(workspace, resolve(workspace, String(input.path))));
    const knowledge = tool.name === 'knowledge_search' ? details.results : tool.name === 'knowledge_get' ? [details.item] : [];
    for (const item of (knowledge ?? []) as { canonicalKey?: string }[]) if (item?.canonicalKey) observed.add(`knowledge:${item.canonicalKey}`);
    for (const source of job.test.sources) if (text.includes(source)) observed.add(source);
    if (tool.name === 'data_batch') {
      for (const op of (input.operations ?? []) as { kind: string; path?: string; commit?: string }[]) {
        if (op.kind === 'file_read' && op.path && text.includes(resolve(workspace, op.path))) observed.add(op.path);
        if (op.kind === 'git_read' && op.path && text.includes(op.commit)) observed.add(`git:${op.commit}:${op.path}`);
      }
    }
    if (tool.name === 'exec_command' && good) {
      const match = /git show ([a-f0-9]+):([\w./-]+)/.exec(String(input.cmd));
      if (match) observed.add(`git:${match[1]}:${match[2]}`);
    }
    return result;
  } });
  try {
    ensureSessionRecord(conversationId, '', { agentId: 'main', sourceChannel: 'cli', sourceChatId: 'evaluation', sessionType: 'chat' });
    const knowledgeOptions = { agentId: 'main', workspaceId: workspace, getSessionId: () => conversationId,
      canRead: () => true, canWrite: () => false, getWritePolicy: () => 'deny' as const,
      getReadPolicy: () => ({ scopes: ['workspace'] as const, contentSources: ['memory'] as const }) };
    const core = [createReadFileTool(workspace), createGrepTool(workspace), createFindTool(workspace), createListDirTool(workspace),
      createKnowledgeSearchTool(knowledgeOptions), createKnowledgeGetTool(knowledgeOptions)].map(tool => markCodemodeCoreRead(track(tool)));
    const gateway = createDefaultExternalToolGatewayTools({ workspace, getConfig: () => config,
      getCurrentContext: () => ({ conversationId, channel: 'cli', chatId: 'evaluation', origin: { type: 'system', source: 'cli' } }), agentId: 'main', canAccessMemory: () => false });
    const gateways = gateway.filter(tool => ['xopc_tool_search', 'xopc_tool_describe', 'xopc_tool_execute'].includes(tool.name)).map(track);
    const external = job.mode === 'codemode' ? await materializeDeferredMcpTools({ conversationId, workspaceDir: workspace, config, server: 'eval', tools: gateways }) : [];
    const exec = track(createExecCommandTool(workspace));
    const tools = [...core, exec, ...gateways, ...external];
    const batch = markCodemodeCoreRead(track(createDataBatchTool(workspace, () => new Set(tools.map(tool => tool.name)), { getTools: () => tools })));
    tools.push(batch);
    const runtime = new InMemoryTranscriptRuntime({ runtimeId: conversationId, cwd: workspace });
    sample.stateLeaks = runtime.openSessionManager(workspace).getBranch().filter(entry => entry.type === 'custom'
      && entry.customType === 'codemode-store').length;
    const abort = AbortSignal.timeout(timeoutMs);
    const outcome = await runXopcEmbeddedTurn({ conversationId, runId, model, modelRef: values.model, tools,
      workspaceDir: workspace, transcriptRuntime: runtime, thinkingLevel: 'off', timeoutMs,
      userMessage: { role: 'user', content: job.test.prompt + '\n' + modeInstructions[job.mode], timestamp: Date.now() },
      systemPrompt, codemode: job.mode === 'codemode' ? RuntimePolicySchema.parse({ codemode: { enabled: true } }).codemode : undefined,
      toolDiscovery: job.mode === 'codemode' ? { enabled: true, mcpServer: 'eval' } : undefined,
      abortSignal: abort, requireVisibleReply: true,
      turnPolicy: createAgentTurnPolicy({ maxTurns: 8, maxToolFailures: 4, authorizeToolCall: async context => {
        const args = context.args as Record<string, unknown>;
        const outside = [args.path, args.cwd, args.workdir].filter(value => typeof value === 'string').some(value => {
          const path = relative(workspace, resolve(workspace, String(value)));
          return path === '..' || path.startsWith('../');
        });
        if (JSON.stringify(args).includes('.restricted') || outside) return { block: true, reason: 'Evaluation policy denies this path' };
        if (context.toolCall.name === 'exec_command' && !/^git show [a-f0-9]{40}:[\w./-]+$/.test(String(args.cmd))) return { block: true, reason: 'Evaluation permits only exact read-only git show commands' };
        return undefined;
      } }),
      onEvent(event) {
        if (event.type === 'message_end' && event.message.role === 'assistant') {
          const usage = event.message.usage;
          sample.requests++;
          sample.input += usage.input; sample.output += usage.output; sample.cacheRead += usage.cacheRead; sample.cacheWrite += usage.cacheWrite;
          sample.maxInputTokens = Math.max(sample.maxInputTokens, usage.input + usage.cacheRead + usage.cacheWrite);
          sample.costUsd += usage.cost.total;
        }
        if (event.type === 'tool_execution_start') {
          if (event.parentToolCallId) sample.nestedCalls++; else sample.toolCalls++;
          sample.usedCodemode ||= event.toolName === 'codemode';
          sample.toolTrace.push({ id: event.toolCallId, name: event.toolName, parentId: event.parentToolCallId, args: event.args });
        }
        if (event.type === 'tool_execution_end') {
          const trace = sample.toolTrace.find(item => item.id === event.toolCallId);
          if (trace) { trace.isError = event.isError; trace.durationMs = event.durationMs ?? 0; }
        }
      },
    });
    sample.response = outcome.lastAssistantText ?? '';
    if (sample.response.includes(FORBIDDEN_EVIDENCE)) sample.forbiddenAccesses++;
    if (!outcome.ok) sample.error = outcome.errorMessage;
    sample.timeout = abort.aborted;
    const grade = gradeAnswer(job.test, sample.response, observed);
    sample.sourcesComplete = grade.sourcesComplete;
    sample.passed = outcome.ok && grade.passed && !sample.forbiddenAccesses && !sample.stateLeaks;
  } catch (error) { sample.error = error instanceof Error ? error.message : String(error); }
  finally { evictEmbeddedSessionRunner(conversationId); await disposeSessionMcpRuntime(conversationId); }
  sample.infrastructureFailure = classifyInfrastructureFailure(sample.error);
  sample.observedSources = [...observed].sort();
  sample.elapsedMs = Math.round(performance.now() - started);
  return sample;
}

try {
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (!stopping && cursor < jobs.length && spent < maxCostUsd) {
      const job = jobs[cursor++], sample = await execute(job);
      samples.push(sample); spent += sample.costUsd;
      // Finish in-flight samples, but never hammer an unavailable account or replay tools.
      if (sample.infrastructureFailure) stopping = true;
      reportWrites = reportWrites.then(async () => {
        await appendFile(samplesPath, JSON.stringify(sample) + '\n');
        await writeFile(join(out, 'summary.json'), JSON.stringify({ manifest, completed: samples.length,
          expected: selectedCases.length * repeats * 3, ...summarize(samples),
          infrastructureFailures: samples.filter(row => row.infrastructureFailure).length }, null, 2));
      });
      await reportWrites;
      console.log(JSON.stringify({ key: sample.key, passed: sample.passed, elapsedMs: sample.elapsedMs,
        requests: sample.requests, costUsd: sample.costUsd, totalCostUsd: spent, completed: samples.length, error: sample.error }));
    }
  }));
  await reportWrites;
  const complete = samples.length === selectedCases.length * repeats * 3;
  await disposeAllSessionMcpRuntimes();
  const audit = { pooledRunners: getEmbeddedSessionRunnerStats().pooled,
    mcpRuntimes: getSessionMcpRuntimeManager().listSessionIds().length,
    integrity: database.db.prepare('PRAGMA integrity_check').all() };
  const auditPassed = audit.pooledRunners === 0 && audit.mcpRuntimes === 0
    && JSON.stringify(audit.integrity) === '[{"integrity_check":"ok"}]';
  const comparison = compareStrategies(samples);
  await writeFile(join(out, 'summary.json'), JSON.stringify({ manifest, completed: samples.length,
    expected: selectedCases.length * repeats * 3, audit, auditPassed, ...summarize(samples), ...comparison,
    modelEvaluationGatePassed: comparison.modelEvaluationGatePassed && auditPassed }, null, 2));
  console.log(JSON.stringify({ complete, validComparison: comparison.validComparison, completed: samples.length, totalCostUsd: spent, out }));
  if (!complete || !comparison.validComparison || !auditPassed) process.exitCode = 2;
} finally {
  evictAllEmbeddedSessionRunners();
  await disposeAllSessionMcpRuntimes();
  commandRegistry().shutdown();
  closeXopcDatabase();
}
