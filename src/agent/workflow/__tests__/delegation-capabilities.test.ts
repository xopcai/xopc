import { expect, it, vi } from 'vitest';
import { Type } from '@sinclair/typebox';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import type { MessageBus } from '../../../infra/bus/index.js';

const fixture = vi.hoisted(() => ({ tools: [] as any[] }));
vi.mock('../../child-agent-factory.js', () => ({ createDelegateChildHandle: (options: any) => ({
  abort() {}, run: async () => {
    fixture.tools = options.buildChildTools({});
    return { summary: 'Done', status: 'success' };
  },
}) }));

import { DelegateSubagentRunner } from '../subagent-runner.js';

const tool = (name: string): AgentTool<any, any> => ({ name, label: name, description: name, parameters: Type.Object({}),
  execute: vi.fn(async () => ({ content: [], details: {} })) });
const runner = (tools: AgentTool<any, any>[]) => new DelegateSubagentRunner({ workspace: '/tmp', bus: {} as MessageBus,
  getConfig: () => undefined, getDefaultModel: () => ({ id: 'test', provider: 'openai' } as never), buildChildTools: () => tools });

it('inherits registered research tools and enforces external reads for workflows', async () => {
  const external = tool('xopc_tool_execute');
  const parent = [tool('web_search'), tool('web_extract'), tool('knowledge_get'), external, tool('write_file'), tool('exec_command')];
  expect(await runner(parent).run('Research', {})).toBe('Done');
  expect(fixture.tools.map(tool => tool.name)).toEqual(['web_search', 'web_extract', 'knowledge_get', 'xopc_tool_execute']);
  await fixture.tools[3].execute('call', { readOnly: false });
  expect(external.execute).toHaveBeenCalledWith('call', { readOnly: true, approvalId: undefined }, undefined, undefined);
});

it('rejects shared-workspace writes and unavailable tools with an actionable reason', async () => {
  const worker = runner([tool('web_fetch'), tool('write_file')]);
  await expect(worker.run('Write', { allowedToolNames: ['write_file'], rethrow: true })).rejects.toThrow('implement');
  await expect(worker.run('Search', { allowedToolNames: ['web_search'], rethrow: true })).rejects.toThrow('Unavailable to the parent');
});

it('preserves empty toolsets and admits browser only when explicitly requested', async () => {
  const worker = runner([tool('web_fetch'), tool('browser_use')]);
  expect(await worker.run('Think', { allowedToolNames: [] })).toBe('Done');
  expect(fixture.tools).toEqual([]);
  expect(await worker.run('Browse', { allowedToolNames: ['browser_use'] })).toBe('Done');
  expect(fixture.tools.map(tool => tool.name)).toEqual(['browser_use']);
});
