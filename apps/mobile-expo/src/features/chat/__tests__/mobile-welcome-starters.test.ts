import { describe, expect, it } from 'vitest';

import { en } from '../../../i18n/locales/en';
import type { ChatAgentOption } from '../../../query/agents';
import { buildMobileWelcomeModel } from '../mobile-welcome-starters';

function agent(overrides: Partial<ChatAgentOption> = {}): ChatAgentOption {
  return {
    id: 'creative',
    name: 'Creative',
    description: 'Brainstorm visual ideas and content directions.',
    typedModels: { defaults: [], effective: [] },
    skills: { defaults: [], entry: [], effectiveAllowlist: [] },
    tools: { defaultsDisable: [], entryDisable: [], effectiveDisable: [] },
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
});
