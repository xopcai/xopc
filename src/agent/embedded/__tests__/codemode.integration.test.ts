import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Type } from '@sinclair/typebox';
import type { AgentTool, BeforeToolCallContext, AfterToolCallContext } from '@earendil-works/pi-agent-core';
import { createAssistantMessageEventStream, getCurrentTools, type AssistantMessage } from '@earendil-works/pi-ai';
import { afterEach, expect, it, vi } from 'vitest';

const scripted = vi.hoisted(() => ({ stream: vi.fn() }));
vi.mock('../xopc-stream-bridge.js', () => ({ wrapStreamFnForXopcExtensions: () => scripted.stream }));
vi.mock('../model-runtime.js', async () => {
  const { ModelRuntime } = await import('@earendil-works/pi-coding-agent');
  const { InMemoryModelsStore, InMemoryCredentialStore } = await import('@earendil-works/pi-ai');
  return {
    resolveEmbeddedProviderApiKeySync: () => 'test',
    createEmbeddedModelRuntime: async () => {
      const runtime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsStore: new InMemoryModelsStore(), modelsPath: null, refreshOnCreate: false });
      await runtime.setRuntimeApiKey('openai', 'test');
      return runtime;
    },
  };
});

import { runXopcEmbeddedTurn } from '../run-turn.js';
import { InMemoryTranscriptRuntime } from '../transcript-runtime.js';
import { evictAllEmbeddedSessionRunners, evictEmbeddedSessionRunner } from '../session-runner.js';
import { RuntimePolicySchema } from '../../../agent-config/schema.js';
import { markCodemodeCoreRead } from '../../tools/codemode-permissions.js';
import { createReadFileTool } from '../../tools/read.js';
import { createDataBatchTool } from '../../tools/dataBatch.js';
import { createAgentTurnPolicy } from '../../orchestration/agent-turn-policy.js';
import type { EmbeddedStreamEvent, RunXopcEmbeddedTurnParams } from '../types.js';
import { setXopcToolMetadata } from '../tool-metadata.js';

const model = { id: 'gpt-6-sol', name: 'Test', provider: 'openai', api: 'openai-completions' as const,
  baseUrl: 'https://example.invalid', reasoning: false, input: ['text' as const], contextWindow: 128000,
  maxTokens: 4096, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
const roots: string[] = [];
afterEach(async () => {
  evictAllEmbeddedSessionRunners();
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const cwd = await mkdtemp(join(tmpdir(), 'xopc-codemode-'));
  roots.push(cwd);
  await writeFile(join(cwd, 'note.txt'), 'bounded read evidence');
  const conversationId = crypto.randomUUID();
  const runtime = new InMemoryTranscriptRuntime({ runtimeId: conversationId, cwd });
  const read = markCodemodeCoreRead(createReadFileTool(cwd));
  const batch = markCodemodeCoreRead(createDataBatchTool(cwd, () => new Set(['read_file', 'exec_command'])));
  const params: RunXopcEmbeddedTurnParams = {
    conversationId, workspaceDir: cwd, transcriptRuntime: runtime, runId: crypto.randomUUID(),
    userMessage: { role: 'user', content: 'Read the notes', timestamp: Date.now() },
    model, modelRef: 'openai/gpt-6-sol', systemPrompt: 'xopc bounded reads', timeoutMs: 10_000,
    tools: [read, batch], codemode: RuntimePolicySchema.parse({ codemode: { enabled: true } }).codemode,
  };
  return { params, runtime, cwd };
}

async function runScript(params: RunXopcEmbeddedTurnParams, code: string, name = 'codemode', args: Record<string, unknown> = { code }) {
  let round = 0;
  let result: AssistantMessage | undefined;
  const calls: unknown[] = [];
  scripted.stream.mockImplementation((_model, context) => {
    calls.push(getCurrentTools(context.messages));
    if (round++ > 0) {
      result = context.messages.findLast((message: { role: string }) => message.role === 'toolResult');
    }
    const message = { role: 'assistant', api: model.api, provider: model.provider, model: model.id,
      content: round === 1 ? [{ type: 'toolCall', id: `script-${params.runId}`, name, arguments: args }]
        : [{ type: 'text', text: 'Finished' }],
      stopReason: round === 1 ? 'toolUse' : 'stop', timestamp: Date.now(),
      usage: { input: 10, output: 10, cacheRead: 0, cacheWrite: 0, totalTokens: 20, cost: { ...model.cost, total: 0 } },
    } as AssistantMessage;
    const stream = createAssistantMessageEventStream();
    stream.push({ type: 'done', reason: message.stopReason as 'stop' | 'toolUse', message });
    return stream;
  });
  const events: EmbeddedStreamEvent[] = [];
  const turn = await runXopcEmbeddedTurn({ ...params, onEvent: event => events.push(event) });
  expect(turn).toMatchObject({ ok: true });
  return { result: result as unknown as Record<string, unknown>, events, calls };
}

it('runs real QuickJS reads through xopc hooks, retains nested records and restores store on rebuild', async () => {
  const { params, runtime } = await fixture();
  const executeRead = params.tools[0].execute.bind(params.tools[0]);
  params.tools[0].execute = async (...args) => ({ ...await executeRead(...args),
    usage: { input: 2, output: 3, cacheRead: 0, cacheWrite: 0, totalTokens: 5,
      cost: { input: 0.01, output: 0.02, cacheRead: 0, cacheWrite: 0, total: 0.03 } },
  });
  const before = vi.fn(async (_context: BeforeToolCallContext) => undefined);
  const after = vi.fn(async (_context: AfterToolCallContext) => undefined);
  params.turnPolicy = createAgentTurnPolicy({ authorizeToolCall: before });
  const policyAfter = params.turnPolicy.afterToolCall;
  params.turnPolicy.afterToolCall = async context => { after(context); return policyAfter(context); };
  const { result, events } = await runScript(params,
    'const note = await tools.read_file({path:"note.txt"}); store("note", note); text(note);');
  expect(JSON.stringify(result)).toContain('bounded read evidence');
  expect(result.nestedCalls).toMatchObject({ calls: [expect.objectContaining({ name: 'read_file', status: 'ok' })], complete: true });
  expect(result.usage).toMatchObject({ totalTokens: 5, cost: { total: 0.03 } });
  expect(before.mock.calls.some(args => (args[0] as unknown as { toolCall: { name: string } }).toolCall.name === 'read_file')).toBe(true);
  expect(after).toHaveBeenCalled();
  expect(events.some(event => 'parentToolCallId' in event)).toBe(true);
  const rows = runtime.openSessionManager('').getBranch();
  expect(rows.some(entry => entry.type === 'custom' && entry.customType === 'codemode-store')).toBe(true);
  expect(rows.filter(entry => entry.type === 'message' && entry.message.role === 'toolResult')).toHaveLength(1);
  evictEmbeddedSessionRunner(params.conversationId);
  const second = await runScript({ ...params, runId: crypto.randomUUID() }, 'text(load("note"));');
  expect(JSON.stringify(second.result)).toContain('bounded read evidence');
  const other = await fixture();
  expect(JSON.stringify((await runScript(other.params, 'text(load("note") ?? "isolated");')).result)).toContain('isolated');
}, 20_000);

it('hides unsafe tools, blocks guesses and prevents data_batch expanding its permissions', async () => {
  const { params } = await fixture();
  const execute = vi.fn(async () => ({ content: [{ type: 'text' as const, text: 'unsafe' }], details: {} }));
  params.tools.push({ name: 'exec_command', label: 'shell', description: 'shell', parameters: Type.Object({}), execute });
  const { result } = await runScript(params, `text(ALL_TOOLS.map(t=>t.name)); text(await searchTools("shell")); text(await describeTool("exec_command"));
try { await tools.exec_command({}); } catch(e) { text("guess blocked"); }
text(await tools.data_batch({operations:[{id:"git",kind:"git_recent"}]})); text(typeof models);`);
  expect(JSON.stringify(result)).toContain('guess blocked');
  expect(JSON.stringify(result)).toContain('denied');
  expect(JSON.stringify(result)).toContain('undefined');
  expect(execute).not.toHaveBeenCalled();
}, 15_000);

it('loads deferred MCP declarations on search, restores authorized tools and drops removed tools', async () => {
  const { params } = await fixture();
  const execute = vi.fn(async () => ({ content: [{ type: 'text' as const, text: 'MCP search evidence' }], details: {} }));
  const deferred = setXopcToolMetadata({ name: 'mcp__docs__search', label: 'Docs search', description: 'Search documentation records',
    parameters: Type.Object({ query: Type.String() }), execute }, {
    exposure: 'deferred', namespace: { name: 'mcp__docs', description: 'Documentation service' },
    annotations: { readOnlyHint: true }, external: { toolRef: 'mcp:docs:search', revision: 'v1', readOnly: false },
  });
  params.tools.push(deferred);
  const secondRead = setXopcToolMetadata({ ...deferred, name: 'mcp__docs__lookup', description: 'Lookup archived records' }, {
    exposure: 'deferred', namespace: { name: 'mcp__docs' },
    external: { toolRef: 'mcp:docs:lookup', revision: 'v1', readOnly: true },
  });
  params.tools.push(secondRead);
  params.toolDiscovery = { enabled: true, mcpServer: 'docs' };
  const loaded = await runScript(params, '', 'tool_search', { query: 'documentation', limit: 1 });
  expect(JSON.stringify(loaded.calls[0])).not.toContain('mcp__docs__search');
  expect(JSON.stringify(loaded.calls[1])).toContain('mcp__docs__search');
  expect(JSON.stringify(loaded.result)).toContain('Loaded 1 tool');
  expect(execute).not.toHaveBeenCalled();
  const guessed = await runScript({ ...params, runId: crypto.randomUUID() }, 'text(ALL_TOOLS); await tools.mcp__docs__search({query:"notes"});');
  expect(JSON.stringify(guessed.result)).not.toContain('Documentation service');
  expect(execute).not.toHaveBeenCalled();
  evictEmbeddedSessionRunner(params.conversationId);
  const authorize = vi.fn(async (_context: BeforeToolCallContext) => undefined);
  params.turnPolicy = createAgentTurnPolicy({ authorizeToolCall: authorize });
  const restored = await runScript({ ...params, runId: crypto.randomUUID() }, '', deferred.name, { query: 'notes' });
  expect(JSON.stringify(restored.calls[0])).toContain(deferred.name);
  expect(execute).toHaveBeenCalledTimes(1);
  expect(authorize.mock.calls[0][0]).toMatchObject({ toolCall: { name: 'xopc_tool_execute' },
    args: { toolRef: 'mcp:docs:search', revision: 'v1', arguments: { query: 'notes' } } });
  const stillDeferred = await runScript({ ...params, runId: crypto.randomUUID() }, 'text(await tools.mcp__docs__lookup({query:"notes"}));');
  expect(JSON.stringify(stillDeferred.calls[0])).not.toContain(secondRead.name);
  expect(JSON.stringify(stillDeferred.result)).toContain('MCP search evidence');
  expect(execute).toHaveBeenCalledTimes(2);
  params.tools = params.tools.filter(tool => tool !== deferred);
  const removed = await runScript({ ...params, runId: crypto.randomUUID() }, '', 'tool_search', { query: 'documentation' });
  expect(JSON.stringify(removed.calls)).not.toContain(deferred.name);
  expect(JSON.stringify(removed.result)).toContain('No matching tools');
}, 20_000);

it('allows host-approved MCP reads in scripts with structured output and gateway policy checks', async () => {
  const { params } = await fixture();
  const execute = vi.fn(async () => ({ content: [{ type: 'text' as const, text: 'plain content' }], details: {}, structuredContent: { records: 7 } }));
  params.tools.push(setXopcToolMetadata({ name: 'mcp__docs__search', label: 'Docs search', description: 'Search documentation',
    parameters: Type.Object({}), execute }, { exposure: 'deferred', namespace: { name: 'mcp__docs' },
    outputSchema: Type.Object({ records: Type.Number() }),
    external: { toolRef: 'mcp:docs:search', revision: 'v1', readOnly: true } }));
  params.toolDiscovery = { enabled: true, mcpServer: 'docs' };
  const authorize = vi.fn(async (_context: BeforeToolCallContext) => undefined);
  params.turnPolicy = createAgentTurnPolicy({ authorizeToolCall: authorize });
  const result = await runScript(params, 'text(await searchTools("documentation")); text(await tools.mcp__docs__search({}));');
  expect(JSON.stringify(result.result.content)).toContain('records');
  expect(JSON.stringify(result.result.content)).toContain('7');
  expect(JSON.stringify(result.result.content)).not.toContain('plain content');
  expect(result.result.nestedCalls).toMatchObject({ calls: [expect.objectContaining({ name: 'mcp__docs__search', status: 'ok' })] });
  expect(authorize.mock.calls.some(([context]) => context.toolCall.name === 'xopc_tool_execute'
    && (context.args as { readOnly?: boolean }).readOnly === true)).toBe(true);
  params.turnPolicy = createAgentTurnPolicy({ authorizeToolCall: async context => context.toolCall.name === 'xopc_tool_execute'
    ? { block: true, reason: 'MCP policy revoked' } : undefined });
  const denied = await runScript({ ...params, runId: crypto.randomUUID() }, 'await tools.mcp__docs__search({});');
  expect(JSON.stringify(denied.result)).toContain('MCP policy revoked');
  expect(execute).toHaveBeenCalledTimes(1);
}, 20_000);

it('blocks policy refusals and enforces concurrency and source-resistant call/output budgets', async () => {
  const { params } = await fixture();
  let running = 0;
  let peak = 0;
  const execute = vi.fn(async () => {
    peak = Math.max(peak, ++running);
    await new Promise(resolve => setTimeout(resolve, 30));
    running--;
    return { content: [{ type: 'text' as const, text: 'result' }], details: {} };
  });
  params.tools = [markCodemodeCoreRead({ name: 'read_file', label: 'read', description: 'read', parameters: Type.Object({}), execute } as AgentTool)];
  params.codemode = RuntimePolicySchema.parse({ codemode: { enabled: true, maxConcurrentCalls: 2, maxCalls: 3, maxOutputTokens: 100 } }).codemode;
  const { result } = await runScript(params,
    '// @options: {"timeout_ms":999999,"max_output_tokens":999999}\ntext(await Promise.allSettled(Array.from({length:3},()=>tools.read_file({})))); text("x".repeat(10000));');
  expect(peak).toBe(2);
  expect(execute).toHaveBeenCalledTimes(3);
  expect(JSON.stringify(result.content).length).toBeLessThan(550);
  execute.mockClear();
  const over = await runScript({ ...params, runId: crypto.randomUUID() },
    'for(let i=0;i<1000;i++){try { await tools.read_file({}); } catch(e) {}}');
  expect(execute).toHaveBeenCalledTimes(3);
  expect(JSON.stringify(over.result)).toContain('exceeds 3 calls');
  params.turnPolicy = createAgentTurnPolicy({ authorizeToolCall: async context => context.toolCall.name === 'read_file' ? { block: true, reason: 'account refused' } : undefined });
  execute.mockClear();
  expect(JSON.stringify((await runScript({ ...params, runId: crypto.randomUUID() }, 'text(await tools.read_file({}));')).result)).toContain('account refused');
  expect(execute).not.toHaveBeenCalled();
}, 15_000);

it('terminates CPU loops and aborts nested reads without leaving running work', async () => {
  const { params } = await fixture();
  params.codemode = RuntimePolicySchema.parse({ codemode: { enabled: true, timeoutMs: 100 } }).codemode;
  const started = Date.now();
  expect(JSON.stringify((await runScript(params, '// @options: {"timeout_ms":999999}\nwhile(true) {}')).result)).toMatch(/abort|timeout|timed out/i);
  expect(Date.now() - started).toBeLessThan(4000);
  let stopped = false;
  params.tools = [markCodemodeCoreRead({ name: 'read_file', label: 'read', description: 'read', parameters: Type.Object({}),
    async execute(_id, _args, signal) {
      await new Promise<void>((_resolve, reject) => signal?.addEventListener('abort', () => { stopped = true; reject(new Error('aborted read')); }, { once: true }));
      throw new Error('unreachable');
    },
  } as AgentTool)];
  const second = await runScript({ ...params, runId: crypto.randomUUID() }, 'await tools.read_file({});');
  expect(stopped).toBe(true);
  expect(JSON.stringify(second.result)).toMatch(/abort|timeout|cancel/i);
}, 15_000);

it('rejects oversized store writes and stays disabled without an explicit opt-in', async () => {
  const { params, runtime } = await fixture();
  expect(JSON.stringify((await runScript(params, 'store("large", "x".repeat(70000));')).result)).toContain('64 KiB');
  expect(runtime.openSessionManager('').getBranch().some(entry => entry.type === 'custom' && entry.customType === 'codemode-store')).toBe(false);
  const disabled = await runScript({ ...params, runId: crypto.randomUUID(), codemode: undefined }, 'text("unreachable");');
  expect(JSON.stringify(disabled.result)).toContain('not found');
  expect(RuntimePolicySchema.parse({})).toEqual({});
  expect(() => RuntimePolicySchema.parse({ codemode: { timeoutMs: 60001 } })).toThrow();
}, 15_000);
