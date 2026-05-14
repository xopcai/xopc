import { describe, it, expect } from 'vitest';

import { SKILL_TOOLSET_TOOLS, toolsetsSatisfiedByTools, skillVisibleForRegisteredTools } from '../skill-tool-gating.js';
import type { Skill } from '../types.js';

describe('browser toolset gating', () => {
  it('browser toolset requires only browser_use', () => {
    expect(SKILL_TOOLSET_TOOLS.browser).toEqual(['browser_use']);
  });

  it('toolset is satisfied when browser_use is registered', () => {
    const tools = new Set(['browser_use', 'web_search', 'shell']);
    const satisfied = toolsetsSatisfiedByTools(tools);
    expect(satisfied.has('browser')).toBe(true);
  });

  it('toolset is NOT satisfied without browser_use', () => {
    const tools = new Set(['web_search', 'shell']);
    const satisfied = toolsetsSatisfiedByTools(tools);
    expect(satisfied.has('browser')).toBe(false);
  });

  it('browser skill is visible when browser_use is registered', () => {
    const skill: Skill = {
      name: 'browser',
      description: 'Browser skill',
      source: 'builtin',
      filePath: '/skills/browser/SKILL.md',
      toolConditions: {
        requiresTools: ['browser_use'],
        requiresToolsets: [],
        fallbackForTools: [],
        fallbackForToolsets: [],
      },
    };
    const tools = new Set(['browser_use', 'skills_list', 'skill_view']);
    expect(skillVisibleForRegisteredTools(skill, tools)).toBe(true);
  });

  it('browser skill is hidden when browser_use is NOT registered', () => {
    const skill: Skill = {
      name: 'browser',
      description: 'Browser skill',
      source: 'builtin',
      filePath: '/skills/browser/SKILL.md',
      toolConditions: {
        requiresTools: ['browser_use'],
        requiresToolsets: [],
        fallbackForTools: [],
        fallbackForToolsets: [],
      },
    };
    const tools = new Set(['skills_list', 'skill_view', 'web_search']);
    expect(skillVisibleForRegisteredTools(skill, tools)).toBe(false);
  });

  it('browser skill with toolset requirement is visible', () => {
    const skill: Skill = {
      name: 'browser',
      description: 'Browser skill',
      source: 'builtin',
      filePath: '/skills/browser/SKILL.md',
      toolConditions: {
        requiresTools: [],
        requiresToolsets: ['browser'],
        fallbackForTools: [],
        fallbackForToolsets: [],
      },
    };
    const tools = new Set(['browser_use']);
    expect(skillVisibleForRegisteredTools(skill, tools)).toBe(true);
  });
});
