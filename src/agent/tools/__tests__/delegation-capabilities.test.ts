import { Type } from '@sinclair/typebox';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import { describe, expect, it, vi } from 'vitest';

const child = vi.hoisted(() => ({ options: undefined as any }));
vi.mock('../../../execution-environments/session-environment-service.js', () => ({ SessionEnvironmentService: class { get() { return { projectId: 'project' }; } } }));
vi.mock('../../../execution-environments/local-worktree-manager.js', () => ({ LocalWorktreeManager: class {
  async provisionManagedWorktree() { return { id: 'child-environment', rootPath: '/tmp/isolated-child' }; }
} }));
vi.mock('../../../execution-environments/git.js', () => ({ runGit: async () => '' }));
vi.mock('../../child-agent-factory.js', () => ({ createDelegateChildHandle: (options: any) => {
  child.options = options;
  return { abort() {}, run: async () => ({ summary: 'Research complete', status: 'success', toolIterations: 1 }) };
} }));

import { createDelegateTool } from '../delegate-tool.js';
import { resolveDelegationTools, protectDelegatedTool } from '../delegation-policy.js';
import { createDelegationParentPolicy } from '../delegation-parent-policy.js';
import { AgentToolsFactory } from '../factory.js';
import { ConfigSchema } from '../../../config/schema.js';
import type { MessageBus } from '../../../infra/bus/index.js';

const fakeTool = (name: string): AgentTool<any, any> => ({ name, label: name, description: name, parameters: Type.Object({}),
  execute: vi.fn(async () => ({ content: [{ type: 'text', text: name }], details: {} })) });
const model = { provider: 'openai', id: 'test', input: ['text'] } as never;

describe('delegated capabilities', () => {
  it('inherits available research tools and reports precise narrowing failures', () => {
    const parent = ['read_file', 'web_search', 'web_fetch', 'web_extract', 'knowledge_get', 'skill_view', 'xopc_tool_execute', 'write_file', 'delegate_task', 'unclassified'];
    expect(resolveDelegationTools(parent, 'research').granted).toEqual(parent.slice(0, 7));
    expect(resolveDelegationTools(parent, 'research', ['web_search', 'browser_use', 'write_file'])).toEqual({
      granted: ['web_search'], rejected: [
        { tool: 'browser_use', reason: 'Unavailable to the parent agent' },
        { tool: 'write_file', reason: 'Capability local_write is outside this delegation' },
      ],
    });
    expect(resolveDelegationTools(parent, 'research', undefined, ['web_read']).granted).toEqual(['web_search', 'web_fetch', 'web_extract']);
  });

  it('keeps local review read-only and requires explicit browser opt-in', () => {
    const parent = ['read_file', 'web_fetch', 'exec_command', 'write_file', 'browser_use'];
    expect(resolveDelegationTools(parent, 'review', parent, ['command', 'local_write', 'web_read']).granted).toEqual([]);
    expect(resolveDelegationTools(parent, 'implement').granted).not.toContain('browser_use');
    expect(resolveDelegationTools(parent, 'custom').granted).toEqual([]);
    expect(resolveDelegationTools(parent, 'custom', undefined, ['browser']).granted).toEqual(['browser_use']);
    expect(resolveDelegationTools(parent, 'custom', undefined, ['command', 'local_write']).granted).toEqual([]);
  });

  it('defaults ordinary delegation to research and reuses scoped parent tools without requiring Git', async () => {
    const parent = ['web_search', 'knowledge_get', 'skill_view', 'xopc_tool_execute'].map(fakeTool);
    const build = vi.fn(() => []);
    const authorize = vi.fn();
    const tool = createDelegateTool({ workspace: '/tmp/non-git-research', bus: {} as MessageBus, getConfig: () => undefined,
      getSubagentModel: () => model, getParentTools: () => parent, buildChildTools: build,
      createParentPolicy: () => ({ beforeToolCall: authorize } as any) });
    const result = await tool.execute('research', { goal: 'Find recent evidence', context: 'Relevant parent facts' });
    expect(result.details).toMatchObject({ status: 'success', mode: 'research', grantedTools: parent.map(tool => tool.name) });
    expect(child.options.context).toBe('Relevant parent facts');
    expect(child.options.authorizeToolCall).toBe(authorize);
    const tools = child.options.buildChildTools({});
    expect(tools[0]).toBe(parent[0]);
    expect(tools[1]).toBe(parent[1]);
    expect(build).not.toHaveBeenCalled();
    await tools[3].execute('external', { toolRef: 'mcp:server:read', readOnly: false, approvalId: 'parent-approval' });
    expect(parent[3]!.execute).toHaveBeenCalledWith('external', expect.objectContaining({ readOnly: true, approvalId: undefined }), undefined, undefined);
  });

  it('does not resurrect a denied parent tool through the fresh child factory', async () => {
    const factory = new AgentToolsFactory({ workspace: '/tmp', bus: {} as MessageBus,
      getCurrentContext: () => null, getPrimaryModel: () => model });
    const delegate = factory.createAllTools({ disabledTools: new Set(['web_search']) }).find(tool => tool.name === 'delegate_task')!;
    const result = await delegate.execute('denied', { goal: 'Research', toolset: ['web_search', 'web_fetch'] });
    expect(result.details).toMatchObject({ grantedTools: ['web_fetch'], rejectedTools: [{ tool: 'web_search', reason: 'Unavailable to the parent agent' }] });
  });

  it('rebinds implementation tools to the worktree while preserving scoped research instances', async () => {
    const parent = ['read_file', 'write_file', 'web_search', 'knowledge_get'].map(fakeTool);
    const isolatedRead = fakeTool('read_file');
    const isolatedWrite = fakeTool('write_file');
    const build = vi.fn(() => [isolatedRead, isolatedWrite, fakeTool('exec_command')]);
    const delegate = createDelegateTool({ workspace: '/tmp/parent', bus: {} as MessageBus, getConfig: () => undefined,
      getCurrentContext: () => ({ conversationId: 'parent' }), getSubagentModel: () => model,
      getParentTools: () => parent, buildChildTools: build });
    const result = await delegate.execute('implement', { mode: 'implement', goal: 'Implement a change' });
    expect(result.details).toMatchObject({ workspace: '/tmp/isolated-child', environmentId: 'child-environment' });
    expect(child.options.workspace).toBe('/tmp/isolated-child');
    const candidates = child.options.buildChildTools({ workspace: child.options.workspace });
    expect(build).toHaveBeenCalledWith({ workspace: '/tmp/isolated-child' });
    expect(candidates).toEqual([isolatedRead, isolatedWrite, parent[2], parent[3]]);
    expect(candidates.map((tool: AgentTool) => tool.name)).not.toContain('exec_command');
  });

  it('forces external read enforcement even when a child requests writes', async () => {
    const execute = vi.fn(async (_id, args) => {
      if (args.readOnly && args.operation === 'write') throw new Error('No read contract');
      return { content: [], details: {} };
    });
    const wrapped = protectDelegatedTool({ ...fakeTool('xopc_tool_execute'), execute });
    await expect(wrapped.execute('write', { operation: 'write', readOnly: false })).rejects.toThrow('No read contract');
  });

  it('rechecks live parent policies, call limits and noninteractive approval requirements', async () => {
    const config = ConfigSchema.parse({});
    config.agents.defaults.tools.web_search = { mode: 'allow', maxCallsPerTurn: 1 };
    const policy = createDelegationParentPolicy({ getConfig: () => config });
    const call = { toolCall: { id: 'call', name: 'web_search', arguments: {} }, args: {} } as any;
    expect(await policy.beforeToolCall(call)).toBeUndefined();
    expect(await policy.beforeToolCall(call)).toMatchObject({ block: true });
    config.agents.defaults.tools.web_search = { mode: 'ask' };
    expect(await policy.beforeToolCall(call)).toMatchObject({ block: true, reason: expect.stringContaining('ask') });
    config.agents.defaults.tools.web_search = { mode: 'deny' };
    expect(await policy.beforeToolCall(call)).toMatchObject({ block: true, reason: expect.stringContaining('deny') });
  });
});
