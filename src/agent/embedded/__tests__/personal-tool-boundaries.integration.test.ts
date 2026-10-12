import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Type } from '@sinclair/typebox';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('../model-runtime.js', async () => {
  const { ModelRuntime } = await import('@earendil-works/pi-coding-agent');
  const { InMemoryModelsStore, InMemoryCredentialStore } = await import('@earendil-works/pi-ai');
  return { resolveEmbeddedProviderApiKeySync: () => 'fixture', createEmbeddedModelRuntime: async () => {
    const runtime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(),
      modelsStore: new InMemoryModelsStore(), modelsPath: null, refreshOnCreate: false });
    await runtime.setRuntimeApiKey('openai', 'fixture');
    return runtime;
  } };
});

import { initializeTestAgentCatalog } from '../../../agent-catalog/test-support.js';
import { createConversation } from '../../../storage/sqlite/conversation-repository.js';
import { patchSessionMetadata } from '../../../storage/sqlite/session-repository.js';
import { personalAgentId } from '../../../personal-agent/repository.js';
import { PERSONAL_MAIN_TOOL_IDS } from '../../../personal-agent/policy.js';
import { PERSONAL_REQUEST_TOOL_IDS, resolveExecutionToolPolicy } from '../execution-tool-policy.js';
import { EmbeddedSessionRunnerPool } from '../session-runner.js';
import { InMemoryTranscriptRuntime } from '../transcript-runtime.js';
import { deferredToolContract, setXopcToolMetadata } from '../tool-metadata.js';
import { TOOL_DISCOVERY_STATE } from '../tool-search-extension.js';

const model = { id: 'fixture', name: 'Fixture', provider: 'openai', api: 'openai-completions' as const,
  baseUrl: 'https://example.invalid', reasoning: false, input: ['text' as const], contextWindow: 128000,
  maxTokens: 4096, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
const codemode = { enabled: true, timeoutMs: 1000, maxConcurrentCalls: 2, maxCalls: 4, maxOutputTokens: 1000 };
const roots: string[] = [];
const pools: EmbeddedSessionRunnerPool[] = [];
beforeEach(() => initializeTestAgentCatalog());
afterEach(async () => {
  await Promise.all(pools.splice(0).map(async pool => { pool.evictAll(); await pool.drainShutdowns(); }));
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

function tool(name: string): AgentTool {
  return { name, label: name, description: `Fixture ${name}`, parameters: Type.Object({}),
    execute: vi.fn(async () => ({ content: [{ type: 'text' as const, text: 'fixture evidence' }], details: {} })) };
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'xopc-personal-tools-'));
  roots.push(root);
  const conversationId = createConversation({ agentId: personalAgentId('local-owner'), sourceChannel: 'webchat' }).key;
  const runtime = new InMemoryTranscriptRuntime({ runtimeId: conversationId, cwd: root });
  const deferred = setXopcToolMetadata(tool('extension__fixture__read'), { exposure: 'deferred',
    external: { toolRef: 'extension:fixture:read', revision: 'v1', readOnly: true } });
  runtime.openSessionManager(root).appendCustomEntry(TOOL_DISCOVERY_STATE, {
    loaded: [{ name: deferred.name, contract: deferredToolContract(deferred) }],
  });
  const pool = new EmbeddedSessionRunnerPool({ isEnabled: () => true });
  pools.push(pool);
  const params = { runtimeId: conversationId, transcriptId: runtime.transcriptId,
    workspaceDir: root, model, modelRef: 'openai/fixture', tools: [
      ...PERSONAL_MAIN_TOOL_IDS.map(tool), ...PERSONAL_REQUEST_TOOL_IDS.map(tool), deferred,
      tool('exec_command'), tool('list_mcp_resources'), tool('mcp__fixture__write'),
    ], systemPrompt: 'Personal boundary fixture', thinkingLevel: 'off' as const, transcriptRuntime: runtime, codemode };
  return { params, conversationId, runtime, pool };
}

it.each(['direct', 'deferred', 'codemode'] as const)('blocks native %s exposure and restored tools in main and request executions', async exposure => {
  for (const surface of ['personal_main', 'personal_request_worker'] as const) {
    const f = await fixture();
    patchSessionMetadata(f.conversationId, { customData: surface === 'personal_main'
      ? { personalAgent: true } : { personalReadRequestId: 'deleted-request' } });
    const policy = resolveExecutionToolPolicy(f.conversationId);
    expect(policy).toMatchObject({ surface, nativeMcp: false, codemode: false, externalMaterialization: false, discovery: false });
    const acquired = await f.pool.acquire({ ...f.params, mcp: { servers: [{ name: 'must_not_start',
      config: { command: process.execPath, args: ['-e', 'throw new Error("Forbidden MCP startup")'], exposure },
      source: 'fixture' }], errors: [], autoEnableCodemode: true } });
    const allowed = surface === 'personal_main' ? PERSONAL_MAIN_TOOL_IDS : PERSONAL_REQUEST_TOOL_IDS;
    expect(acquired.session.getAllTools().map(t => t.name).toSorted()).toEqual([...allowed].toSorted());
    expect(acquired.session.agent.state.tools.map(t => t.name).toSorted()).toEqual([...allowed].toSorted());
    expect(acquired.session.agent.state.systemPrompt).not.toContain('must_not_start');
    expect(f.runtime.openSessionManager('').getBranch().some(row => row.type === 'custom' && row.customType === TOOL_DISCOVERY_STATE)).toBe(true);
    acquired.release();
  }
}, 20000);

it('rebuilds a pooled ordinary runner after scope changes and then reuses the restricted runner', async () => {
  const f = await fixture();
  const ordinary = await f.pool.acquire(f.params);
  expect(ordinary.session.getAllTools().map(t => t.name)).toContain('codemode');
  expect(ordinary.session.getAllTools().map(t => t.name)).toContain('tool_search');
  expect(ordinary.session.agent.state.tools.map(t => t.name)).toContain('extension__fixture__read');
  ordinary.release();
  patchSessionMetadata(f.conversationId, { customData: { personalAgent: true } });
  const restricted = await f.pool.acquire(f.params);
  expect(restricted.reused).toBe(false);
  expect(restricted.session.getAllTools().map(t => t.name)).not.toContain('codemode');
  restricted.release();
  const reused = await f.pool.acquire(f.params);
  expect(reused.reused).toBe(true);
  expect(f.pool.getStats()).toMatchObject({ creates: 2, reuses: 1, evictions: 1 });
  reused.release();
}, 15000);
