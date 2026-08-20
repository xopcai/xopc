import { describe, expect, it } from 'vitest';

import type { ChatAgentsPayload } from '../../../query/agents';
import {
  buildMobileTaskCreateRequest,
  resolveTaskAgentId,
} from '../task-create-input';

function agents(defaultId = 'default', ids = ['default', 'project', 'selected']): ChatAgentsPayload {
  return {
    defaultId,
    builtinToolIds: [],
    items: ids.map((id) => ({
      id,
      typedModels: { defaults: [], effective: [] },
      skills: { defaults: [] },
      tools: { defaultsDisable: [], entryDisable: [], effectiveDisable: [] },
    })),
  };
}

describe('mobile task create input', () => {
  it('resolves selected, project, then gateway default agent', () => {
    const payload = agents();
    expect(resolveTaskAgentId({
      agents: payload,
      project: { id: 'p', name: 'P', defaultAgentId: 'project' },
      selectedAgentId: 'selected',
    })).toBe('selected');
    expect(resolveTaskAgentId({
      agents: payload,
      project: { id: 'p', name: 'P', defaultAgentId: 'project' },
    })).toBe('project');
    expect(resolveTaskAgentId({ agents: payload })).toBe('default');
  });

  it('does not invent a main agent when none is available', () => {
    expect(() => resolveTaskAgentId({ agents: agents('missing', []) }))
      .toThrow('No available agent');
  });

  it('preserves the originating inbox note as pinned task input context', () => {
    const input = buildMobileTaskCreateRequest({
      idempotencyKey: 'request-1',
      title: '  Prepare launch  ',
      projectId: 'project-1',
      dependencies: ['task-0'],
      agentId: 'agent-1',
      noteId: 'note-1',
      body: '  Publish the launch plan  ',
      acceptanceCriteria: [' Plan is reviewed ', '', 'Owner is named'],
    });

    expect(input.title).toBe('Prepare launch');
    expect(input.activation).toEqual({
      mode: 'start',
      executor: { kind: 'agent', agentId: 'agent-1' },
    });
    expect(input.body).toBe('Publish the launch plan');
    expect(input.contract.objective).toBe('Publish the launch plan');
    expect(input.contract.acceptanceCriteria).toEqual(['Plan is reviewed', 'Owner is named']);
    expect(input.context).toEqual([expect.objectContaining({
      targetKind: 'document',
      targetId: 'note-1',
      role: 'input',
      pinned: true,
      retrievalPolicy: { mode: 'always' },
    })]);
  });
});
