import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ExtensionFactory } from '@earendil-works/pi-coding-agent';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { initializeTestAgentCatalog } from '../../agent-catalog/test-support.js';
import { ConfigSchema, type Config } from '../../config/schema.js';
import { createConversation } from '../../storage/sqlite/conversation-repository.js';
import { closeXopcDatabase, openXopcDatabase } from '../../storage/sqlite/connection.js';
import { DurableState } from '../../storage/sqlite/durable-state.js';
import { AutomationService } from '../service/automation-service.js';
import { prepareAutomationMcpSource, withAutomationMcpSource, boundAutomationMcpSource,
  restrictAutomationMcpConfig, createAutomationMcpSourceGuard } from '../mcp-source.js';

const discovery = vi.hoisted(() => ({ discoverMcpTools: vi.fn() }));
vi.mock('../../agent/mcp/tool-catalog.js', () => discovery);
const tool = { name: 'mcp__docs__read_profile', description: 'Read a profile', inputSchema: { type: 'object', properties: {} },
  exposure: 'codemode', annotations: { readOnlyHint: true, destructiveHint: false } };
let root: string, config: Config, conversationId: string, service: AutomationService;
let sourceContext: Parameters<typeof prepareAutomationMcpSource>[1];
beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'xopc-automation-source-'));
  vi.stubEnv('XOPC_STATE_DIR', root); vi.stubEnv('XOPC_WORKSPACE', root);
  openXopcDatabase({ path: join(root, 'xopc.db') });
  initializeTestAgentCatalog({ agents: [{ id: 'main', workspace: root }] });
  conversationId = createConversation({ agentId: 'main', sourceChannel: 'webchat' }).key;
  config = ConfigSchema.parse({ mcp: { servers: { docs: { url: 'https://docs.example/mcp', headers: { Authorization: 'Bearer private-source-token' } }, alternate: { url: 'https://other.example/mcp' } } } });
  discovery.discoverMcpTools.mockReset().mockResolvedValue([tool]);
  sourceContext = { conversationId, agentId: 'main', workspaceDir: root, canConfigure: true, readConfig: () => config };
  service = new AutomationService();
  service.setDeps({ getConfig: () => config, getDefaultAgentId: () => 'main', onRunCompleted: async () => {} });
  await service.initialize();
});
afterEach(async () => { await service.stop(); closeXopcDatabase(); vi.unstubAllEnvs(); rmSync(root, { recursive: true, force: true }); });
const prepare = () => prepareAutomationMcpSource({ serverId: 'docs', toolNames: [tool.name] }, sourceContext);
function guard(runId: string) {
  const handlers: Record<string, (event: any) => any> = {};
  createAutomationMcpSourceGuard(runId)({ on: (name: string, handler: any) => { handlers[name] = handler; },
    getAllTools: () => [{ ...tool, parameters: tool.inputSchema, exposure: 'direct' }],
  } as unknown as Parameters<ExtensionFactory>[0]);
  return handlers;
}

it('requires an owner, refuses hidden/mutating tools, and stores only a non-secret immutable reference', async () => {
  await expect(prepareAutomationMcpSource({ serverId: 'docs', toolNames: [tool.name] }, { ...sourceContext, canConfigure: false })).rejects.toThrow('owner');
  expect(discovery.discoverMcpTools).not.toHaveBeenCalled();
  discovery.discoverMcpTools.mockResolvedValueOnce([{ ...tool, exposure: 'hidden' }]);
  await expect(prepare()).rejects.toThrow('read-only');
  discovery.discoverMcpTools.mockResolvedValueOnce([{ ...tool, annotations: { readOnlyHint: false } }]);
  await expect(prepare()).rejects.toThrow('read-only');
  const first = await prepare(), second = await prepare();
  expect(first.sourceId).toBe(second.sourceId);
  expect(first.accountIdentityVerified).toBe(false);
  expect(JSON.stringify(new DurableState('automation.mcp-source.v1').values())).not.toContain('private-source-token');
});

it('rejects a source changed while discovery was in flight', async () => {
  let finish!: (value: unknown) => void;
  discovery.discoverMcpTools.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const preparing = prepare();
  config.mcp!.servers!.docs.url = 'https://changed.example/mcp'; finish([tool]);
  await expect(preparing).rejects.toThrow('changed');
  expect(new DurableState('automation.mcp-source.v1').values()).toHaveLength(0);
});

it('rejects an answer without a current successful read and blocks alternate sources and late calls', async () => {
  const source = await prepare(), controller = new AbortController();
  const input = { runId: 'read-1', conversationId, sourceId: source.sourceId, agentId: 'main', readConfig: () => config, signal: controller.signal };
  await expect(withAutomationMcpSource(input, async () => 'Invented result')).rejects.toThrow('did not complete');
  await expect(withAutomationMcpSource(input, async () => {
    const h = guard(input.runId);
    expect(h.tool_call({ toolName: tool.name, input: { account: 'another-account' } })).toMatchObject({ block: true });
    return 'Changed account arguments';
  })).rejects.toThrow('did not complete');
  await expect(withAutomationMcpSource(input, async () => {
    const h = guard(input.runId);
    expect(h.tool_call({ toolName: 'mcp__alternate__read_profile' })).toMatchObject({ block: true });
    return 'Alternative result';
  })).rejects.toThrow('did not complete');
  await expect(withAutomationMcpSource(input, async () => {
    const h = guard(input.runId); controller.abort();
    expect(h.tool_call({ toolName: tool.name })).toMatchObject({ block: true });
    return 'Late result';
  })).rejects.toThrow();
  expect(boundAutomationMcpSource(input.runId, conversationId)).toBeUndefined();
});

it('requires a real trial of the exact action before enable and fails changed sources before model execution', async () => {
  const source = await prepare();
  const action = { kind: 'agent' as const, agentId: 'main', instruction: 'Read this profile', mcpSourceId: source.sourceId };
  await expect(service.create({ name: 'Pinned', enabled: true, trigger: { kind: 'manual' }, action })).rejects.toThrow('disabled draft');
  const automation = await service.create({ name: 'Pinned', enabled: false, trigger: { kind: 'manual' }, action });
  const process = vi.fn(async (_message, executionId, _origin, _attachments, _thinking, options) => {
    expect(boundAutomationMcpSource(options.runId, executionId)?.serverId).toBe('docs');
    const restricted = restrictAutomationMcpConfig(options.runId, executionId, { errors: [], servers: [
      { name: 'docs', config: { url: 'https://docs.example/mcp' }, source: 'fixture' },
      { name: 'alternate', config: { url: 'https://other.example/mcp' }, source: 'fixture' },
    ] });
    expect(restricted.servers.map(server => server.name)).toEqual(['docs']);
    expect(restricted.servers[0].config).toMatchObject({ exposure: 'deferred' });
    const hidden = restrictAutomationMcpConfig(options.runId, executionId, { errors: [], servers: [
      { name: 'docs', config: { url: 'https://docs.example/mcp', exposure: 'hidden', toolExposure: { read_profile: 'direct' } }, source: 'fixture' },
    ] });
    expect(hidden.servers[0].config).toMatchObject({ exposure: 'hidden', toolExposure: { read_profile: 'direct' } });
    const h = guard(options.runId);
    expect(h.tool_call({ toolName: tool.name })).toBeUndefined();
    h.tool_result({ toolName: tool.name, isError: false });
    return 'Verified fixture result';
  });
  service.setDeps({ agentService: { turnDispatcher: { processDirect: process } } });
  const trial = await service.runNow(automation.id);
  await vi.waitFor(async () => expect((await service.getRun(trial.id))?.status).toBe('succeeded'));
  expect((await service.update(automation.id, { enabled: true }))?.enabled).toBe(true);
  await expect(service.update(automation.id, { action: { ...action, instruction: 'Different action' } })).rejects.toThrow('exact source-bound action');
  config.mcp!.servers!.docs.enabled = false;
  const failed = await service.runNow(automation.id);
  await vi.waitFor(async () => expect((await service.getRun(failed.id))?.status).toBe('failed'));
  expect(process).toHaveBeenCalledTimes(1);
  await service.update(automation.id, { enabled: false });
  await expect(service.update(automation.id, { enabled: true })).rejects.toThrow('disabled');
  const edited = await service.update(automation.id, { action: { kind: 'agent', agentId: 'main', instruction: 'Different action' } });
  expect(edited?.action.kind === 'agent' && edited.action.mcpSourceId).toBe(source.sourceId);
  delete config.mcp!.servers!.docs.enabled;
  await expect(service.update(automation.id, { enabled: true })).rejects.toThrow('exact source-bound action');
});

it('fails a changed schema before execution and prevents a mismatched call contract', async () => {
  const source = await prepare();
  const input = { runId: 'schema-run', conversationId, sourceId: source.sourceId, agentId: 'main', readConfig: () => config, signal: new AbortController().signal };
  const operation = vi.fn(async () => 'No read');
  discovery.discoverMcpTools.mockResolvedValueOnce([{ ...tool, inputSchema: { type: 'object', required: ['newField'] } }]);
  await expect(withAutomationMcpSource(input, operation)).rejects.toThrow('contract changed');
  expect(operation).not.toHaveBeenCalled();
  await expect(withAutomationMcpSource(input, async () => {
    const h = guard(input.runId);
    config.mcp!.servers!.docs.url = 'https://changed.example/mcp';
    expect(h.tool_call({ toolName: tool.name })).toMatchObject({ block: true });
    return 'No read';
  })).rejects.toThrow('changed');
});
