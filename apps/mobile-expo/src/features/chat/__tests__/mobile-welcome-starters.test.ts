import { describe, expect, it } from 'vitest';

import { en } from '../../../i18n/locales/en';
import type { ChatAgentOption } from '../../../query/agents';
import { buildMobileWelcomeModel } from '../mobile-welcome-starters';

function agent(overrides: Partial<ChatAgentOption> = {}): ChatAgentOption {
  return {
    id: 'creative',
    name: 'Creative',
    description: 'Brainstorm visual ideas and content directions.',
    modelIntents: { effective: [], overrides: [] },
    skills: { excluded: [], overrides: [] },
    tools: { denied: [], overrides: [] },
    ...overrides,
  };
}

describe('buildMobileWelcomeModel', () => {
  it('builds three editable starters for an empty chat', () => {
    const model = buildMobileWelcomeModel({
      messages: en,
      agent: agent(),
      agentId: 'creative',
    });

    expect(model.headline).toBe('What do you want to move forward?');
    expect(model.tagline).toContain('Creative');
    expect(model.starters).toHaveLength(3);
    expect(model.starters[0]).toMatchObject({
      title: 'Explore options',
      icon: 'content',
    });
    expect(model.starters[0]?.prompt).toContain('creative directions');
    expect(model.starters[2]).toMatchObject({
      title: 'Today’s AI news',
      icon: 'search',
    });
    expect(model.starters[2]?.prompt).toContain('latest AI news');
  });

  it('prefers working-directory starters when a session workspace is known', () => {
    const model = buildMobileWelcomeModel({
      messages: en,
      agent: agent({ id: 'coder', name: 'Coder' }),
      agentId: 'coder',
      effectiveWorkspacePath: '/Users/example/project',
    });

    expect(model.headline).toBe('Start from the current folder');
    expect(model.starters).toHaveLength(3);
    expect(model.starters[0]).toMatchObject({
      title: 'Understand folder',
      icon: 'folder',
    });
    expect(model.starters[0]?.prompt).toContain('/Users/example/project');
  });

  it('shows task-state starters before project or directory starters', () => {
    const model = buildMobileWelcomeModel({
      messages: en,
      agent: agent({ id: 'coder', name: 'Coder' }),
      agentId: 'coder',
      effectiveWorkspacePath: '/repo/xopc',
      project: { id: 'project-1', name: 'xopc' } as never,
      task: {
        task: { id: 'task-1', title: 'Ship release', phase: 'active' },
        operationalState: 'waiting',
        attention: [{ summary: 'Approve the release date' }],
        receipts: [],
      } as never,
    });

    expect(model.headline).toContain('Ship release');
    expect(model.starters[0]?.title).toBe('Fill key gaps');
    expect(model.starters[0]?.prompt).toContain('Approve the release date');
  });

  it('uses project operating state for project starters', () => {
    const model = buildMobileWelcomeModel({
      messages: en,
      agent: agent(),
      agentId: 'creative',
      project: { id: 'project-1', name: 'Launch' } as never,
      projectOperating: {
        blockers: [{ title: 'Legal review' }],
        recentResults: [],
        digest: { health: 'attention', summary: 'Blocked', recommendedAction: 'Get approval' },
      } as never,
    });

    expect(model.headline).toBe('Continue this project');
    expect(model.starters[0]?.title).toBe('Check project status');
    expect(model.starters[0]?.prompt).toContain('Legal review');
  });
});
