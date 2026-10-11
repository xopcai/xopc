import { createServer, type Server } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Type } from '@sinclair/typebox';
import {
  createAgentSession, createMcpExtension, createToolSearchExtension, DefaultResourceLoader,
  ModelRuntime, SessionManager, SettingsManager, type AgentSession, type ExtensionFactory,
  type McpServerConfig,
} from '@earendil-works/pi-coding-agent';
import {
  createAssistantMessageEventStream, getCurrentTools, getCurrentSystemPrompt, InMemoryCredentialStore, InMemoryModelsStore,
  type AssistantMessage, type Model, type Api,
} from '@earendil-works/pi-ai';
import { afterEach, expect, it, vi } from 'vitest';

vi.mock('../model-runtime.js', async () => {
  const { ModelRuntime } = await import('@earendil-works/pi-coding-agent');
  const { InMemoryModelsStore, InMemoryCredentialStore } = await import('@earendil-works/pi-ai');
  return { resolveEmbeddedProviderApiKeySync: () => 'fixture', createEmbeddedModelRuntime: async () => {
    const runtime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsStore: new InMemoryModelsStore(), modelsPath: null, refreshOnCreate: false });
    await runtime.setRuntimeApiKey('openai', 'fixture'); return runtime;
  } };
});

const model: Model<Api> = {
  id: 'fixture', name: 'Fixture', provider: 'openai', api: 'openai-completions',
  baseUrl: 'https://example.invalid', reasoning: false, input: ['text'], contextWindow: 128000,
  maxTokens: 4096, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};
const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const dispose of cleanup.splice(0).reverse()) await dispose();
  vi.unstubAllEnvs();
});

// The same small protocol server runs over real stdio and Streamable HTTP transports.
const protocol = `
let changed = false;
function respond(q) {
  if (q.method === 'initialize') return { protocolVersion: '2025-03-26',
    serverInfo: {name: 'sdk-fixture', version: '1'},
    capabilities: {tools: {listChanged: true}, resources: {}} };
  if (q.method === 'tools/list') return {tools: (changed ? ['fresh'] : ['lookup','invalid','refresh','slow','a-b','a_b']).map(name => ({
    name, description: 'SDK fixture documentation ' + name,
    inputSchema: {type: 'object', properties: {}},
    outputSchema: {type: 'object', properties: {records: {type: 'number'}}, required: ['records']}
  }))};
  if (q.method === 'tools/call') {
    if (q.params.name === 'refresh') changed = true;
    return {content: [{type: 'text', text: 'fixture evidence'}],
      structuredContent: {records: q.params.name === 'invalid' ? 'invalid-number' : 7}};
  }
  if (q.method === 'resources/list') return {resources: [{uri: 'fixture://note', name: 'Note'}]};
  if (q.method === 'resources/templates/list') return {resourceTemplates: [{uriTemplate: 'fixture://{id}', name: 'Notes'}]};
  if (q.method === 'resources/read') return {contents: [{uri: q.params.uri, text: 'resource evidence'}]};
  throw new Error('Unsupported fixture method: ' + q.method);
}`;

async function fixture(transport: 'stdio' | 'http', host = false, exposure: 'deferred' | 'codemode' | 'direct' | 'hidden' = 'deferred') {
  const root = await mkdtemp(join(tmpdir(), 'xopc-pi-mcp-sdk-'));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  vi.stubEnv('PI_CODING_AGENT_DIR', root);
  vi.stubEnv('XOPC_STATE_DIR', root);
  vi.stubEnv('OPENAI_API_KEY', 'fixture');
  const started = join(root, 'request-started');
  const cancelled = join(root, 'request-cancelled');
  let config: McpServerConfig;
  if (transport === 'stdio') {
    const entry = join(root, 'server.mjs');
    await writeFile(entry, `import {createInterface} from 'node:readline'; import {writeFileSync} from 'node:fs'; ${protocol}
createInterface({input: process.stdin}).on('line', line => {
  const q = JSON.parse(line);
  if (q.method === 'notifications/cancelled') writeFileSync(${JSON.stringify(cancelled)}, 'cancelled');
  if (q.id === undefined) return;
  if (q.method === 'tools/call' && q.params.name === 'slow') { writeFileSync(${JSON.stringify(started)}, 'started'); return; }
  process.stdout.write(JSON.stringify({jsonrpc:'2.0', id:q.id, result:respond(q)})+'\\n');
  if (q.method === 'tools/call' && q.params.name === 'refresh')
    process.stdout.write(JSON.stringify({jsonrpc:'2.0', method:'notifications/tools/list_changed'})+'\\n');
});`);
    config = { command: process.execPath, args: [entry], exposure };
  } else {
    const respond = new Function(`${protocol}; return respond;`)() as (q: Record<string, unknown>) => unknown;
    const pendingResponses = new Map<number | string, import('node:http').ServerResponse>();
    const server: Server = createServer(async (req, res) => {
      if (req.method !== 'POST') { res.writeHead(req.method === 'DELETE' ? 200 : 405).end(); return; }
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk);
      const q = JSON.parse(Buffer.concat(chunks).toString());
      if (q.method === 'notifications/cancelled') {
        await writeFile(cancelled, 'cancelled');
        pendingResponses.get(q.params.requestId)?.writeHead(200, { 'Content-Type': 'application/json' })
          .end(JSON.stringify({ jsonrpc: '2.0', id: q.params.requestId, error: { code: -32800, message: 'Cancelled' } }));
        pendingResponses.delete(q.params.requestId);
      }
      if (q.id === undefined) { res.writeHead(202).end(); return; }
      if (q.method === 'tools/call' && q.params.name === 'slow') {
        await writeFile(started, 'started');
        pendingResponses.set(q.id, res);
        res.once('close', () => { void writeFile(cancelled, 'cancelled'); });
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: q.id, result: respond(q) }));
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    cleanup.push(() => new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve()); server.closeAllConnections();
    }));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing fixture address');
    config = { url: `http://127.0.0.1:${address.port}/mcp`, exposure };
  }
  if (host) {
    const { EmbeddedSessionRunnerPool } = await import('../session-runner.js');
    const { InMemoryTranscriptRuntime } = await import('../transcript-runtime.js');
    const { prepareNativeMcpConfig } = await import('../../mcp/native-mcp.js');
    const transcriptRuntime = new InMemoryTranscriptRuntime({ runtimeId: crypto.randomUUID(), cwd: root });
    const pool = new EmbeddedSessionRunnerPool({ isEnabled: () => true });
    const mcp = await prepareNativeMcpConfig({ mcp: { servers: { fixture: config } } } as never, root);
    const acquired = await pool.acquire({ runtimeId: transcriptRuntime.runtimeId, transcriptId: transcriptRuntime.transcriptId,
      workspaceDir: root, model, modelRef: 'openai/fixture', tools: [], systemPrompt: 'Native MCP fixture',
      thinkingLevel: 'off', transcriptRuntime, mcp,
      codemode: { enabled: exposure === 'deferred', timeoutMs: 5000, maxConcurrentCalls: 4, maxCalls: 8, maxOutputTokens: 4000 },
    });
    cleanup.push(async () => { pool.evictAll(); await pool.drainShutdowns(); });
    return { session: acquired.session, pool, acquired, started, cancelled };
  }
  const before = vi.fn(() => undefined as { block: true; reason: string } | undefined);
  const results: string[] = [];
  const probe: ExtensionFactory = pi => {
    pi.on('tool_call', event => { if (event.toolName.startsWith('mcp__')) return before(); });
    pi.on('tool_result', event => { if (event.toolName.startsWith('mcp__')) results.push(event.toolName); });
    pi.registerTool({ name: 'probe', label: 'Probe', description: 'Fixture nested calls', exposure: 'model-only',
      parameters: Type.Object({ name: Type.String(), arguments: Type.Record(Type.String(), Type.Unknown()) }),
      async execute(_id, args, signal, _update, ctx) {
        const outcome = await ctx.executeTool(args.name, args.arguments, { signal });
        return { content: [{ type: 'text', text: JSON.stringify(outcome) }], details: {} };
      },
    });
  };
  const settingsManager = SettingsManager.inMemory({ retry: { enabled: false }, compaction: { enabled: false },
    defaultTools: ['probe', 'tool_search', 'list_mcp_resources', 'list_mcp_resource_templates', 'read_mcp_resource'] });
  const resourceLoader = new DefaultResourceLoader({ cwd: root, agentDir: root, settingsManager,
    noExtensions: true, noContextFiles: true, extensionFactories: [
      createToolSearchExtension(), createMcpExtension({
        loadConfig: () => ({ servers: [{ name: 'fixture', config, source: 'xopc-fixture' }], errors: [], autoEnableCodemode: false }),
        logPath: join(root, 'mcp.log'), openUrl: () => { throw new Error('Unexpected OAuth flow'); },
      }), probe,
    ],
  });
  await resourceLoader.reload();
  const modelRuntime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(),
    modelsStore: new InMemoryModelsStore(), modelsPath: null, refreshOnCreate: false });
  await modelRuntime.setRuntimeApiKey('openai', 'fixture');
  const { session } = await createAgentSession({ cwd: root, model, resourceLoader, modelRuntime,
    settingsManager, sessionManager: SessionManager.inMemory(), noTools: 'builtin' });
  cleanup.push(async () => { await session.abort(); await session.extensionRunner.emit({ type: 'session_shutdown', reason: 'quit' }); session.dispose(); });
  await session.bindExtensions({});
  return { session, before, results, started, cancelled };
}

async function call(session: AgentSession, name: string, args: Record<string, unknown>) {
  let round = 0;
  const declarations: unknown[] = [];
  const prompts: string[] = [];
  session.agent.streamFunction = (_model, context) => {
    declarations.push(getCurrentTools(context.messages));
    prompts.push(getCurrentSystemPrompt(context.messages));
    const first = round++ === 0;
    const message: AssistantMessage = {
      role: 'assistant', api: model.api, provider: model.provider, model: model.id,
      content: first ? [{ type: 'toolCall', id: crypto.randomUUID(), name, arguments: args }] : [{ type: 'text', text: 'Done' }],
      stopReason: first ? 'toolUse' : 'stop', timestamp: Date.now(),
      usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { ...model.cost, total: 0 } },
    };
    const stream = createAssistantMessageEventStream();
    stream.push({ type: 'done', reason: message.stopReason as 'stop' | 'toolUse', message });
    return stream;
  };
  await session.prompt('SDK fixture');
  return { result: session.messages.findLast(message => message.role === 'toolResult'), declarations, prompts };
}

it.each(['stdio', 'http'] as const)('uses the public MCP extension over %s with deferred tools, resources and permission hooks', async transport => {
  const { session, before, results } = await fixture(transport);
  const found = await call(session, 'tool_search', { query: 'lookup', limit: 1 });
  expect(JSON.stringify(found.declarations[0])).not.toContain('mcp__fixture__lookup');
  expect(session.getActiveToolNames()).toContain('mcp__fixture__lookup');
  expect(session.getActiveToolNames()).not.toContain('codemode');
  expect(session.getAllTools().filter(tool => tool.name.startsWith('mcp__fixture__a'))).toHaveLength(2);
  const invoked = await call(session, 'mcp__fixture__lookup', {});
  expect(JSON.stringify(invoked.result)).toContain('fixture evidence');
  const structured = await call(session, 'probe', { name: 'mcp__fixture__lookup', arguments: {} });
  expect(JSON.stringify(structured.result)).toContain('records');
  expect(JSON.stringify(structured.result)).toContain('7');
  expect(before).toHaveBeenCalled();
  expect(results).toContain('mcp__fixture__lookup');
  before.mockReturnValue({ block: true, reason: 'Fixture policy denied' });
  const denied = await call(session, 'probe', { name: 'mcp__fixture__lookup', arguments: {} });
  expect(JSON.stringify(denied.result)).toContain('Fixture policy denied');
  before.mockReturnValue(undefined);
  await call(session, 'tool_search', { query: 'list_mcp_resource_templates', limit: 1 });
  const templates = await call(session, 'list_mcp_resource_templates', { server: 'fixture' });
  expect(JSON.stringify(templates.result)).toContain('fixture://{id}');
  await call(session, 'tool_search', { query: 'read_mcp_resource', limit: 1 });
  const resource = await call(session, 'read_mcp_resource', { server: 'fixture', uri: 'fixture://note' });
  expect(JSON.stringify(resource.result)).toContain('resource evidence');
}, 20_000);

it.each(['stdio', 'http'] as const)('cancels an actual %s nested MCP request when its pi session is aborted', async transport => {
  const { session, started, cancelled } = await fixture(transport);
  await call(session, 'tool_search', { query: 'slow', limit: 1 });
  const pending = call(session, 'probe', { name: 'mcp__fixture__slow', arguments: {} });
  await vi.waitFor(async () => expect(await readFile(started, 'utf8')).toBe('started'));
  await session.abort();
  await pending;
  await vi.waitFor(async () => expect(await readFile(cancelled, 'utf8')).toBe('cancelled'));
}, 20_000);

it('refreshes the native registry on stdio list_changed and documents the missing strict output validation', async () => {
  const { session } = await fixture('stdio');
  await call(session, 'tool_search', { query: 'invalid', limit: 1 });
  const invalid = await call(session, 'probe', { name: 'mcp__fixture__invalid', arguments: {} });
  // Match native pi output semantics; strict host validation is limited to Device adapters.
  expect(JSON.stringify(invalid.result)).toContain('invalid-number');
  expect(invalid.result?.role === 'toolResult' && invalid.result.isError).toBe(false);
  await call(session, 'probe', { name: 'mcp__fixture__refresh', arguments: {} });
  await vi.waitFor(() => expect(session.getAllTools().some(tool => tool.name === 'mcp__fixture__fresh')).toBe(true));
  // Removed definitions stay registered as hidden; they must cease to be callable.
  expect(session.getCallableToolNames()).not.toContain('mcp__fixture__lookup');
}, 20_000);

it.each(['stdio', 'http'] as const)('uses native %s MCP inside the actual xopc pooled runner and QuickJS', async transport => {
  const { session, pool } = await fixture(transport, true);
  const found = await call(session, 'tool_search', { query: 'lookup', limit: 1 });
  expect(JSON.stringify(found.declarations[0])).not.toContain('mcp__fixture__lookup');
  expect(found.prompts[0]).toContain('<mcp_servers>');
  expect(found.prompts[0]).toContain('mcp__fixture');
  expect(found.prompts[0]).toContain('Native MCP fixture');
  expect(session.getActiveToolNames()).toContain('mcp__fixture__lookup');
  const direct = await call(session, 'mcp__fixture__lookup', {});
  expect(JSON.stringify(direct.result)).toContain('fixture evidence');
  const script = await call(session, 'codemode', { code: 'text((await tools.mcp__fixture__lookup({})).structuredContent.records);' });
  expect(script.result?.role === 'toolResult' && script.result.isError).toBe(false);
  expect(JSON.stringify(script.result)).toContain('7');
  pool!.evictAll(); await pool!.drainShutdowns();
  expect(pool!.getStats().pooled).toBe(0);
}, 20_000);

it('aborts native MCP when the actual xopc runner is evicted', async () => {
  const { session, pool, started, cancelled } = await fixture('stdio', true);
  await call(session, 'tool_search', { query: 'slow', limit: 1 });
  const pending = call(session, 'mcp__fixture__slow', {});
  await vi.waitFor(async () => expect(await readFile(started, 'utf8')).toBe('started'));
  pool!.evictAll(); await pending; await pool!.drainShutdowns();
  expect(await readFile(cancelled, 'utf8')).toBe('cancelled');
}, 20_000);


it.each(['codemode', 'direct', 'hidden'] as const)('matches native %s exposure without the host Codemode flag', async exposure => {
  const { session } = await fixture('stdio', true, exposure);
  if (exposure === 'codemode') {
    const invoked = await call(session, 'codemode', { code: 'text((await tools.mcp__fixture__lookup({})).structuredContent.records);' });
    expect(invoked.result?.role === 'toolResult' && invoked.result.isError).toBe(false);
    expect(JSON.stringify(invoked.result)).toContain('7');
    expect(JSON.stringify(invoked.declarations[0])).not.toContain('mcp__fixture__lookup');
  } else if (exposure === 'direct') {
    const invoked = await call(session, 'mcp__fixture__lookup', {});
    expect(JSON.stringify(invoked.result)).toContain('fixture evidence');
    expect(JSON.stringify(invoked.declarations[0])).toContain('mcp__fixture__lookup');
    expect(session.getActiveToolNames()).not.toContain('codemode');
  } else {
    const found = await call(session, 'tool_search', { query: 'lookup', limit: 1 });
    expect(JSON.stringify(found.result)).not.toContain('mcp__fixture__lookup');
    expect(session.getCallableToolNames()).not.toContain('mcp__fixture__lookup');
    expect(session.getActiveToolNames()).not.toContain('codemode');
  }
}, 20_000);
