import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MessageBus } from '../../../infra/bus/index.js';
import { initializeTestAgentCatalog } from '../../../agent-catalog/test-support.js';
import { closeXopcDatabase } from '../../../storage/sqlite/index.js';
import { AgentToolsFactory } from '../factory.js';

describe('configuration tool access for ordinary Agents', () => {
  beforeAll(() => initializeTestAgentCatalog({ agents: [{ id: 'main' }, { id: 'coder' }] }));
  afterAll(() => closeXopcDatabase());
  const factory = () => new AgentToolsFactory({ workspace: '/tmp', bus: {} as MessageBus,
    getCurrentContext: () => null, dispatchTaskRuns: () => {} });
  it.each(['main', 'coder'])('offers product tools through the same explicit allowlist to %s', agentId => {
    const names = factory().createCoreTools({ agentId, toolAllowlist: ['xopc_use', 'tool_manual'] }).map(tool => tool.name);
    expect(names.sort()).toEqual(['tool_manual', 'xopc_use']);
  });
  it('respects a tool denial even when coder has an allowlist entry', () => {
    const names = factory().createCoreTools({ agentId: 'coder', toolAllowlist: ['xopc_use', 'tool_manual'],
      disabledTools: new Set(['xopc_use']) }).map(tool => tool.name);
    expect(names).toEqual(['tool_manual']);
  });
});
