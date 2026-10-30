import { createServer } from 'node:http';
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
import { withCoreToolExposure } from '../../tools/toolExposure.js';
import { markCodemodeCoreRead } from '../../tools/codemode-permissions.js';
import { createReadFileTool } from '../../tools/read.js';
import { createDataBatchTool } from '../../tools/dataBatch.js';
import { createAgentTurnPolicy } from '../../orchestration/agent-turn-policy.js';
import type { EmbeddedStreamEvent, RunXopcEmbeddedTurnParams } from '../types.js';
import { setXopcToolMetadata } from '../tool-metadata.js';
import { getXopcToolMetadata } from '../tool-metadata.js';
import { materializeNativeExternalTools } from '../external-tool-discovery.js';
import { createExternalToolGatewayTools } from '../../external-tools/gateway-tools.js';
import { createDefaultExternalToolGatewayTools } from '../../external-tools/index.js';
import { EndpointRegistry } from '../../../endpoint-tools/registry.js';
import { EndpointBindingService } from '../../../endpoint-tools/binding-service.js';
import { EndpointInvocationService } from '../../../endpoint-tools/invocation-service.js';
import type { EndpointToolRuntime } from '../../../endpoint-tools/runtime.js';
import { ENDPOINT_PROTOCOL_VERSION, ENDPOINT_TEXT_OUTPUT_SCHEMA, type EndpointHelloPayload, type ServerEndpointMessage } from '@xopcai/endpoint-tools-protocol';
import { requireXopcDatabase } from '../../../storage/sqlite/connection.js';
import { getEmbeddedSessionRunnerStats } from '../session-runner.js';
import { createConversation } from '../../../storage/sqlite/conversation-repository.js';
import { personalAgentId } from '../../../personal-agent/repository.js';

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

it.each([true, false])('bounds automatic correction of an unverified MCP capability denial (recovers=%s)', async recovers => {
  const { params } = await fixture();
  const execute = vi.fn(async () => ({ content: [{ type: 'text' as const, text: 'Current connection status' }], details: {} }));
  params.tools = [{ name: 'mcp_setup', label: 'MCP', description: 'Inspect connections', parameters: Type.Object({ command: Type.String() }), execute }];
  params.codemode = undefined;
  params.userMessage = { role: 'user', content: 'Connect http://127.0.0.1/mcp', timestamp: Date.now() };
  let round = 0;
  scripted.stream.mockImplementation(() => {
    const index = round++;
    const calling = recovers && index === 1;
    const message = { role: 'assistant', api: model.api, provider: model.provider, model: model.id,
      content: calling ? [{ type: 'toolCall', id: 'inspect', name: 'mcp_setup', arguments: { command: 'inspect' } }]
        : [{ type: 'text', text: recovers && index > 1 ? 'The actual tool is available.' : 'The MCP setup tool is not available.' }],
      stopReason: calling ? 'toolUse' : 'stop', timestamp: Date.now(),
      usage: { input: 10, output: 10, cacheRead: 0, cacheWrite: 0, totalTokens: 20, cost: { ...model.cost, total: 0 } },
    } as AssistantMessage;
    const stream = createAssistantMessageEventStream();
    stream.push({ type: 'done', reason: message.stopReason as 'stop' | 'toolUse', message });
    return stream;
  });
  expect(await runXopcEmbeddedTurn(params)).toMatchObject({ ok: true });
  expect(round).toBe(recovers ? 3 : 2);
  expect(execute).toHaveBeenCalledTimes(recovers ? 1 : 0);
});

it.each(['connection', 'authorization', 'connection_then_authorization'] as const)('handles %s invalidation during an assistant response', async reason => {
  const { params } = await fixture();
  let invalidate!: (reason?: 'connection' | 'authorization') => void;
  const releaseInvalidation = vi.fn();
  params.tools.push(setXopcToolMetadata({ name: 'device__info', label: 'Device', description: 'Read device',
    parameters: Type.Object({}), execute: async () => ({ content: [], details: {} }) }, {
    exposure: 'deferred', namespace: { name: 'device' },
    subscribeInvalidation: listener => { invalidate = listener; return releaseInvalidation; },
  }));
  let complete!: () => void;
  const message = { role: 'assistant', api: model.api, provider: model.provider, model: model.id,
    content: [{ type: 'text', text: 'Complete response' }], stopReason: 'stop', timestamp: Date.now(),
    usage: { input: 10, output: 10, cacheRead: 0, cacheWrite: 0, totalTokens: 20, cost: { ...model.cost, total: 0 } },
  } as AssistantMessage;
  scripted.stream.mockImplementation(() => {
    const stream = createAssistantMessageEventStream();
    stream.push({ type: 'start', partial: { ...message, content: [] } });
    complete = () => stream.push({ type: 'done', reason: 'stop', message });
    return stream;
  });
  const before = getEmbeddedSessionRunnerStats().evictions;
  const running = runXopcEmbeddedTurn(params);
  await vi.waitFor(() => expect(complete).toBeTypeOf('function'));
  invalidate(reason === 'connection_then_authorization' ? 'connection' : reason);
  if (reason === 'connection_then_authorization') invalidate('authorization');
  const midTurnEvictions = getEmbeddedSessionRunnerStats().evictions;
  complete();
  const result = await running;
  if (reason === 'connection') expect(midTurnEvictions).toBe(before);
  expect(result.ok).toBe(reason === 'connection');
  expect(getEmbeddedSessionRunnerStats().evictions).toBe(before + 1);
  expect(releaseInvalidation).toHaveBeenCalledOnce();
}, 15_000);

it.each(['android', 'ios', 'harmonyos'])('preserves a %s turn across device disconnect and reconnect', async platform => {
  requireXopcDatabase();
  const { params, cwd } = await fixture();
  const registry = new EndpointRegistry();
  const bindings = new EndpointBindingService(registry);
  const invocations = new EndpointInvocationService(registry);
  const endpointId = `${platform}:device`;
  const hello: EndpointHelloPayload = {
    principalId: 'owner', endpointId, connectionInstanceId: crypto.randomUUID(), displayName: platform,
    kind: 'mobile', platform, appVersion: '1', availability: 'foreground', nonce: 'fixture',
    signedAt: Date.now(), signature: 'fixture-signature', tools: [{
      name: 'mobile.device.get_info', title: 'Device information', description: 'Read device information',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false }, outputSchema: ENDPOINT_TEXT_OUTPUT_SCHEMA,
      policyId: 'public.background-read', sensitivity: 'public', effect: 'read', confirmation: 'never',
      requiresForeground: false, requiredPermissions: [], timeoutMs: 1000, maxConcurrency: 1,
      supportsCancellation: true, idempotent: true, resultKinds: ['text'],
    }],
  };
  const transport = { readyState: 1, close: vi.fn(), send: vi.fn() };
  registry.register(hello, 'first', transport);
  const endpointTools = { registry, bindings, grants: { find: () => undefined, candidates: () => [] }, invocations } as unknown as EndpointToolRuntime;
  const gateway = createDefaultExternalToolGatewayTools({ workspace: cwd, getConfig: () => undefined,
    getCurrentContext: () => ({ conversationId: params.conversationId, channel: 'webchat', chatId: 'chat',
      origin: { type: 'endpoint', endpointId } }), endpointTools, canAccessMemory: () => false });
  const native = await materializeNativeExternalTools({ conversationId: params.conversationId, tools: gateway });
  expect(native).toHaveLength(1);
  params.tools.push(...native);
  let complete!: () => void;
  const message = { role: 'assistant', api: model.api, provider: model.provider, model: model.id,
    content: [{ type: 'text', text: 'Complete response' }], stopReason: 'stop', timestamp: Date.now(),
    usage: { input: 10, output: 10, cacheRead: 0, cacheWrite: 0, totalTokens: 20, cost: { ...model.cost, total: 0 } },
  } as AssistantMessage;
  scripted.stream.mockImplementation(() => {
    const stream = createAssistantMessageEventStream();
    stream.push({ type: 'start', partial: { ...message, content: [] } });
    complete = () => stream.push({ type: 'done', reason: 'stop', message });
    return stream;
  });
  const running = runXopcEmbeddedTurn(params);
  await vi.waitFor(() => expect(complete).toBeTypeOf('function'));
  registry.remove(endpointId, 'first');
  registry.register({ ...hello, connectionInstanceId: crypto.randomUUID() }, 'second', transport);
  complete();
  expect(await running).toMatchObject({ ok: true });
  expect(transport.send).not.toHaveBeenCalled();
}, 15_000);

it('inherits Personal boundaries in an ephemeral run and blocks guessed tools before execution', async () => {
  const { params } = await fixture();
  params.toolPolicyConversationId = createConversation({ agentId: personalAgentId('local-owner'),
    customData: { personalAgent: true } }).key;
  const execute = vi.fn(async () => ({ content: [{ type: 'text' as const, text: 'unsafe' }], details: {} }));
  params.tools.push({ name: 'exec_command', label: 'Shell', description: 'Shell', parameters: Type.Object({}), execute });
  for (const name of ['codemode', 'tool_search', 'exec_command']) {
    const { calls, result } = await runScript({ ...params, runId: crypto.randomUUID() }, '', name, {});
    expect(JSON.stringify(calls)).not.toContain(name);
    expect(result).toMatchObject({ isError: true });
  }
  expect(execute).not.toHaveBeenCalled();
}, 15000);

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
  const deferred = setXopcToolMetadata({ name: 'extension__docs__search', label: 'Docs search', description: 'Search documentation records',
    parameters: Type.Object({ query: Type.String() }), execute }, {
    exposure: 'deferred', namespace: { name: 'extension__docs', description: 'Documentation service' },
    annotations: { readOnlyHint: true }, external: { toolRef: 'extension:docs:search', revision: 'v1', readOnly: false },
  });
  params.tools.push(deferred);
  const secondRead = setXopcToolMetadata({ ...deferred, name: 'extension__docs__lookup', description: 'Lookup archived records' }, {
    exposure: 'deferred', namespace: { name: 'extension__docs' },
    external: { toolRef: 'extension:docs:lookup', revision: 'v1', readOnly: true },
  });
  params.tools.push(secondRead);
  const loaded = await runScript(params, '', 'tool_search', { query: 'documentation', limit: 1 });
  expect(JSON.stringify(loaded.calls[0])).not.toContain('extension__docs__search');
  expect(JSON.stringify(loaded.calls[1])).toContain('extension__docs__search');
  expect(JSON.stringify(loaded.result)).toContain('Loaded 1 tool');
  expect(execute).not.toHaveBeenCalled();
  const guessed = await runScript({ ...params, runId: crypto.randomUUID() }, 'text(ALL_TOOLS); await tools.extension__docs__search({query:"notes"});');
  expect(JSON.stringify(guessed.result)).not.toContain('Documentation service');
  expect(execute).not.toHaveBeenCalled();
  evictEmbeddedSessionRunner(params.conversationId);
  const authorize = vi.fn(async (_context: BeforeToolCallContext) => undefined);
  params.turnPolicy = createAgentTurnPolicy({ authorizeToolCall: authorize });
  const restored = await runScript({ ...params, runId: crypto.randomUUID() }, '', deferred.name, { query: 'notes' });
  expect(JSON.stringify(restored.calls[0])).toContain(deferred.name);
  expect(execute).toHaveBeenCalledTimes(1);
  expect(authorize.mock.calls[0][0]).toMatchObject({ toolCall: { name: 'xopc_tool_execute' },
    args: { toolRef: 'extension:docs:search', revision: 'v1', arguments: { query: 'notes' } } });
  const stillDeferred = await runScript({ ...params, runId: crypto.randomUUID() }, 'text(await tools.extension__docs__lookup({query:"notes"}));');
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
  params.tools.push(setXopcToolMetadata({ name: 'extension__docs__search', label: 'Docs search', description: 'Search documentation',
    parameters: Type.Object({}), execute }, { exposure: 'deferred', namespace: { name: 'extension__docs' },
    outputSchema: Type.Object({ records: Type.Number() }),
    external: { toolRef: 'extension:docs:search', revision: 'v1', readOnly: true } }));
  const authorize = vi.fn(async (_context: BeforeToolCallContext) => undefined);
  params.turnPolicy = createAgentTurnPolicy({ authorizeToolCall: authorize });
  const result = await runScript(params, 'text(await searchTools("documentation")); text(await tools.extension__docs__search({}));');
  expect(JSON.stringify(result.result.content)).toContain('records');
  expect(JSON.stringify(result.result.content)).toContain('7');
  expect(JSON.stringify(result.result.content)).not.toContain('plain content');
  expect(result.result.nestedCalls).toMatchObject({ calls: [expect.objectContaining({ name: 'extension__docs__search', status: 'ok' })] });
  expect(authorize.mock.calls.some(([context]) => context.toolCall.name === 'xopc_tool_execute'
    && (context.args as { readOnly?: boolean }).readOnly === true)).toBe(true);
  params.turnPolicy = createAgentTurnPolicy({ authorizeToolCall: async context => context.toolCall.name === 'xopc_tool_execute'
    ? { block: true, reason: 'MCP policy revoked' } : undefined });
  const denied = await runScript({ ...params, runId: crypto.randomUUID() }, 'await tools.extension__docs__search({});');
  expect(JSON.stringify(denied.result)).toContain('MCP policy revoked');
  expect(execute).toHaveBeenCalledTimes(1);
}, 20_000);

it('discovers and calls real device services through pi, keeps confirmation and invalidates loaded declarations on reconnect', async () => {
  requireXopcDatabase();
  const { params, cwd } = await fixture();
  const registry = new EndpointRegistry();
  const bindings = new EndpointBindingService(registry);
  const audit = { started: vi.fn(), finished: vi.fn() };
  const invocations = new EndpointInvocationService(registry, { audit });
  const sent: ServerEndpointMessage[] = [];
  let invalidOutput = false;
  const descriptor = { name: 'mobile.device.get_info', title: 'Device information', description: 'Read phone device information',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }, outputSchema: ENDPOINT_TEXT_OUTPUT_SCHEMA,
    policyId: 'public.background-read', sensitivity: 'public' as const, effect: 'read' as const, confirmation: 'never' as const,
    requiresForeground: false, requiredPermissions: [], timeoutMs: 1000, maxConcurrency: 1,
    supportsCancellation: true, idempotent: true, resultKinds: ['text' as const] };
  const hello: EndpointHelloPayload = { principalId: 'owner', endpointId: 'phone', connectionInstanceId: crypto.randomUUID(),
    displayName: 'Phone', kind: 'mobile', platform: 'android', appVersion: '1', availability: 'foreground',
    nonce: 'fixture', signedAt: Date.now(), signature: 'fixture-signature', tools: [descriptor,
      { ...descriptor, name: 'mobile.clipboard.write', title: 'Write clipboard', description: 'Write text to the device clipboard',
        inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false },
        policyId: 'user.foreground-write', sensitivity: 'personal', effect: 'write', confirmation: 'always',
        requiresForeground: true, requiredPermissions: ['clipboard-write'] },
    ] };
  const socket = { readyState: 1, close: vi.fn(), send(value: string) {
    const message: ServerEndpointMessage = JSON.parse(value);
    sent.push(message);
    if (message.type !== 'tool.invoke') return;
    queueMicrotask(() => {
      const envelope = { protocolVersion: ENDPOINT_PROTOCOL_VERSION, messageId: crypto.randomUUID(), sentAt: Date.now() };
      invocations.handleMessage('phone', { ...envelope, type: 'tool.received', payload: { invocationId: message.payload.invocationId } });
      if (message.payload.toolName === 'mobile.clipboard.write') {
        invocations.handleMessage('phone', { ...envelope, type: 'tool.error',
          payload: { invocationId: message.payload.invocationId, code: 'USER_DENIED', message: 'Device confirmation denied' } });
      } else {
        invocations.handleMessage('phone', { ...envelope, type: 'tool.result', payload: { invocationId: message.payload.invocationId,
          content: invalidOutput ? [{ type: 'json', value: 'invalid' }] : [{ type: 'text', text: 'Device SDK evidence' }] } });
      }
    });
  } };
  registry.register(hello, 'connection-1', socket);
  const endpointTools = { registry, bindings, grants: { find: () => undefined, candidates: () => [] }, invocations } as unknown as EndpointToolRuntime;
  const gateway = createDefaultExternalToolGatewayTools({ workspace: cwd, getConfig: () => undefined,
    getCurrentContext: () => ({ conversationId: params.conversationId, channel: 'webchat', chatId: 'chat',
      origin: { type: 'endpoint', endpointId: 'phone' } }), endpointTools, canAccessMemory: () => false });
  const native = await materializeNativeExternalTools({ conversationId: params.conversationId, tools: gateway });
  const read = native.find(tool => getXopcToolMetadata(tool)?.external?.readOnly)!;
  const write = native.find(tool => getXopcToolMetadata(tool)?.external?.readOnly === false)!;
  params.tools.push(...native);
  // Native device discovery works without the MCP pilot configuration.
  const found = await runScript(params, '', 'tool_search', { query: 'phone device information', limit: 1 });
  expect(JSON.stringify(found.calls[0])).not.toContain(read.name);
  expect(JSON.stringify(found.calls[1])).toContain(read.name);
  expect(sent).toHaveLength(0);
  const direct = await runScript({ ...params, runId: crypto.randomUUID() }, '', read.name, {});
  expect(JSON.stringify(direct.result)).toContain('Device SDK evidence');
  expect(audit.started).toHaveBeenCalledWith(expect.objectContaining({ toolName: descriptor.name, confirmationRequired: false }));
  const script = await runScript({ ...params, runId: crypto.randomUUID() }, `text(await tools.${read.name}({}));`);
  expect(JSON.stringify(script.result)).toContain('Device SDK evidence');
  const beforeWrites = sent.length;
  const guessed = await runScript({ ...params, runId: crypto.randomUUID() }, `await tools.${write.name}({text:"guess"});`);
  expect(JSON.stringify(guessed.result)).toMatch(/not found|not authorized|not a function|does not exist/i);
  expect(sent).toHaveLength(beforeWrites);
  await runScript({ ...params, runId: crypto.randomUUID() }, '', 'tool_search', { query: 'Write clipboard', limit: 1 });
  const denied = await runScript({ ...params, runId: crypto.randomUUID() }, '', write.name, { text: 'request' });
  expect(JSON.stringify(denied.result)).toContain('no effect was applied');
  expect(audit.finished).toHaveBeenCalledWith(expect.objectContaining({ errorCode: 'USER_DENIED' }));
  expect(sent.find(message => message.type === 'tool.invoke' && message.payload.toolName === 'mobile.clipboard.write'))
    .toMatchObject({ payload: { confirmationRequired: true } });
  invalidOutput = true;
  const invalid = await runScript({ ...params, runId: crypto.randomUUID() }, `text(await tools.${read.name}({}));`);
  expect(JSON.stringify(invalid.result)).toContain('does not match its contract');
  const evictions = getEmbeddedSessionRunnerStats().evictions;
  registry.register({ ...hello, connectionInstanceId: crypto.randomUUID() }, 'connection-2', socket);
  expect(getEmbeddedSessionRunnerStats().evictions).toBe(evictions + 1);
  const replacement = await materializeNativeExternalTools({ conversationId: params.conversationId, tools: gateway });
  params.tools = params.tools.filter(tool => !native.includes(tool)).concat(replacement);
  const reloaded = await runScript({ ...params, runId: crypto.randomUUID() }, '', 'tool_search', { query: 'device information', limit: 1 });
  expect(JSON.stringify(reloaded.calls[0])).not.toContain(read.name);
  expect(JSON.stringify(reloaded.calls[1])).toContain(read.name);
  const reboundEvictions = getEmbeddedSessionRunnerStats().evictions;
  bindings.bind(params.conversationId, 'phone');
  expect(getEmbeddedSessionRunnerStats().evictions).toBe(reboundEvictions + 1);
  const invalidations = vi.fn();
  const release = getXopcToolMetadata(replacement[0])!.subscribeInvalidation!(invalidations);
  registry.disconnect('phone', 4003, 'Device revoked');
  expect(invalidations).toHaveBeenLastCalledWith('authorization');
  registry.remove('phone', 'connection-2');
  expect(invalidations).toHaveBeenLastCalledWith('connection');
  registry.revokePrincipal('owner');
  expect(invalidations).toHaveBeenLastCalledWith('authorization');
  release();
  invalidations.mockClear();
  registry.revokePrincipal('owner');
  expect(invalidations).not.toHaveBeenCalled();
  expect(await materializeNativeExternalTools({ conversationId: params.conversationId, tools: gateway })).toEqual([]);
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


it('discovers an optional core tool without a namespace and restores its unchanged executable contract', async () => {
  const { params } = await fixture();
  const execute = vi.fn(async () => ({ content: [{ type: 'text' as const, text: 'Generated fixture' }], details: {} }));
  const optional = withCoreToolExposure({ name: 'image_generate', label: 'Generate image', description: 'Generate an illustration',
    parameters: Type.Object({ prompt: Type.String() }), execute });
  params.tools.push(optional);
  const search = await runScript(params, '', 'tool_search', { query: 'image_generate', limit: 1 });
  expect(JSON.stringify(search.calls[0])).not.toContain('image_generate');
  expect(JSON.stringify(search.calls.at(-1))).toContain('image_generate');
  expect(execute).not.toHaveBeenCalled();
  const loaded = await runScript({ ...params, runId: crypto.randomUUID() }, '', 'image_generate', { prompt: 'A tree' });
  expect(execute).toHaveBeenCalledOnce();
  expect(JSON.stringify(loaded.calls[0])).toContain('image_generate');
});

it('retains native MCP readiness hooks through real turns and pooled reuse', async () => {
  const { params } = await fixture();
  let calls = 0;
  const server = createServer(async (req, res) => {
    if (req.method !== 'POST') { res.writeHead(req.method === 'DELETE' ? 200 : 405).end(); return; }
    let body = ''; for await (const chunk of req) body += chunk;
    const request = JSON.parse(body);
    if (request.id === undefined) { res.writeHead(202).end(); return; }
    if (request.method === 'tools/list') await new Promise(resolve => setTimeout(resolve, 700));
    if (request.method === 'tools/call') calls++;
    const result = request.method === 'initialize'
      ? { protocolVersion: '2025-03-26', serverInfo: { name: 'late', version: '1' }, capabilities: { tools: {} } }
      : request.method === 'tools/list' ? { tools: [{ name: 'lookup', description: 'Delayed MCP fixture', inputSchema: { type: 'object', properties: {} } }] }
      : { content: [{ type: 'text', text: 'delayed MCP evidence' }] };
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing listener');
  params.mcp = { servers: [{ name: 'late', config: { url: `http://127.0.0.1:${address.port}`, exposure: 'codemode' }, source: 'fixture' }], errors: [] };
  try {
    for (let turn = 0; turn < 2; turn++) {
      const result = await runScript({ ...params, runId: crypto.randomUUID() },
        "const found = await searchTools('lookup', {namespace:'mcp__late'}); if (!found[0]) throw new Error('Native tools not ready'); text(await tools[found[0].name]({}));");
      expect(result.result.isError).not.toBe(true);
      expect(JSON.stringify(result.result)).toContain('delayed MCP evidence');
    }
    expect(calls).toBe(2);
  } finally {
    evictAllEmbeddedSessionRunners(); server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}, 20000);


it('loads configuration guidance before discovering task-specific product declarations', async () => {
  const { params } = await fixture();
  const readGuidance = vi.fn(async () => ({ content: [{ type: 'text' as const, text: 'configuration guidance loaded' }], details: {} }));
  params.tools = [
    withCoreToolExposure({ name: 'skill_view', label: 'Skill', description: 'Read setup guidance', parameters: Type.Object({ name: Type.String() }), execute: readGuidance }),
    withCoreToolExposure({ name: 'tool_manual', label: 'Manual', description: 'Read product contracts', parameters: Type.Object({}), execute: readGuidance }),
    withCoreToolExposure({ name: 'xopc_use', label: 'Product', description: 'Configure App capabilities', parameters: Type.Object({}), execute: vi.fn() }),
  ];
  const loaded = await runScript({ ...params, codemode: undefined }, '', 'skill_view', { name: 'configure-xopc' });
  expect(JSON.stringify(loaded.calls[0])).toContain('skill_view');
  expect(JSON.stringify(loaded.calls[0])).toContain('tool_manual');
  expect(JSON.stringify(loaded.calls[0])).not.toContain('xopc_use');
  expect(JSON.stringify(loaded.result)).toContain('configuration guidance loaded');
  expect(readGuidance).toHaveBeenCalledOnce();
});

it('distinguishes an already loaded tool from an unavailable tool on repeated discovery', async () => {
  const { params } = await fixture();
  const execute = vi.fn(async () => ({ content: [{ type: 'text' as const, text: 'browser available' }], details: {} }));
  params.tools.push(withCoreToolExposure({ name: 'browser_use', label: 'Browser', description: 'Control a browser', parameters: Type.Object({}), execute }));
  await runScript(params, '', 'tool_search', { query: 'browser_use', limit: 1 });
  const repeated = await runScript({ ...params, runId: crypto.randomUUID() }, '', 'tool_search', { query: 'browser_use navigate observe click', limit: 1 });
  expect(JSON.stringify(repeated.result)).toContain('Already loaded: browser_use');
  expect(JSON.stringify(repeated.calls[0])).toContain('browser_use');
  const used = await runScript({ ...params, runId: crypto.randomUUID() }, '', 'browser_use', {});
  expect(JSON.stringify(used.result)).toContain('browser available');
  expect(execute).toHaveBeenCalledOnce();
}, 15000);

it.each([true, false])('bounds a promise-only Skill installation continuation (recovers=%s)', async recovers => {
  const { params } = await fixture();
  const execute = vi.fn(async () => ({ content: [{ type: 'text' as const, text: 'Installed the requested fixture' }], details: {} }));
  params.tools = [{ name: 'skill_install', label: 'Install Skill', description: 'Install an authorized Skill', parameters: Type.Object({ source: Type.String() }), execute }];
  params.codemode = undefined;
  params.userMessage = { role: 'user', content: '安装这个周报能力 https://example.com/report.zip，装好后整理数据。', timestamp: Date.now() };
  let round = 0;
  scripted.stream.mockImplementation(() => {
    const index = round++, calling = recovers && index === 1;
    const message = { role: 'assistant', api: model.api, provider: model.provider, model: model.id,
      content: calling ? [{ type: 'toolCall', id: 'install-once', name: 'skill_install', arguments: { source: 'https://example.com/report.zip' } }]
        : [{ type: 'text', text: recovers && index > 1 ? 'The actual installation completed.' : '我会安装这个周报能力，然后整理数据。' }],
      stopReason: calling ? 'toolUse' : 'stop', timestamp: Date.now(),
      usage: { input: 10, output: 10, cacheRead: 0, cacheWrite: 0, totalTokens: 20, cost: { ...model.cost, total: 0 } },
    } as AssistantMessage;
    const stream = createAssistantMessageEventStream();
    stream.push({ type: 'done', reason: message.stopReason as 'stop' | 'toolUse', message });
    return stream;
  });
  expect(await runXopcEmbeddedTurn(params)).toMatchObject({ ok: true });
  expect(round).toBe(recovers ? 3 : 2);
  expect(execute).toHaveBeenCalledTimes(recovers ? 1 : 0);
});


it('discovers connector-only tools through tool_search and preserves describe/execute revision checks', async () => {
  const { params } = await fixture();
  const contract = { toolRef: 'cli:wecom:doc.search', source: 'cli' as const, namespace: 'wecom', title: 'doc.search',
    summary: 'Search WeCom documents', description: 'Search WeCom documents', inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } };
  const execute = vi.fn(async () => ({ content: [{ type: 'text' as const, text: 'WeCom document evidence' }], details: {} }));
  params.tools = createExternalToolGatewayTools([{ source: 'cli', search: async () => [contract],
    describe: async ref => ref === contract.toolRef ? contract : undefined, execute }]);
  params.codemode = undefined;
  const found = await runScript(params, '', 'tool_search', { query: 'WeCom documents' });
  expect(JSON.stringify(found.calls[0])).toContain('tool_search');
  expect(JSON.stringify(found.calls[0])).not.toContain('xopc_tool_search');
  const payload = JSON.parse((found.result!.content[0] as { text: string }).text);
  expect(payload.externalTools).toEqual([expect.objectContaining({ toolRef: contract.toolRef, nextAction: 'describe' })]);
  expect(payload.loadedTools).toEqual([]);
  const described = await runScript({ ...params, runId: crypto.randomUUID() }, '', 'xopc_tool_describe', { toolRefs: [contract.toolRef] });
  const revision = JSON.parse((described.result!.content[0] as { text: string }).text).tools[0].revision;
  const executed = await runScript({ ...params, runId: crypto.randomUUID() }, '', 'xopc_tool_execute', {
    toolRef: contract.toolRef, revision, arguments: { query: 'report' },
  });
  expect(JSON.stringify(executed.result)).toContain('WeCom document evidence');
  expect(execute).toHaveBeenCalledOnce();
  contract.description = 'Changed WeCom contract';
  const stale = await runScript({ ...params, runId: crypto.randomUUID() }, '', 'xopc_tool_execute', {
    toolRef: contract.toolRef, revision, arguments: { query: 'report' },
  });
  expect(JSON.stringify(stale.result)).toContain('contract changed');
  expect(execute).toHaveBeenCalledOnce();
}, 15000);
