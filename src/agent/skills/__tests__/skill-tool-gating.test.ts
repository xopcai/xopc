import { describe, expect, it } from 'vitest';

import {
  parseSkillToolConditions,
  skillVisibleForRegisteredTools,
  toolsetsSatisfiedByTools,
} from '../skill-tool-gating.js';
import type { Skill, SkillToolConditions } from '../types.js';
import { selectSkillsVisibleInPrompt } from '../format-skills-prompt.js';

function skillWithConditions(c: SkillToolConditions, name = 's'): Skill {
  return {
    name,
    description: 'd',
    filePath: '/x/SKILL.md',
    baseDir: '/x',
    source: 'workspace',
    disableModelInvocation: false,
    metadata: { name, description: 'd' },
    toolConditions: c,
    content: '',
  };
}

describe('toolsetsSatisfiedByTools', () => {
  it('marks web when all web tools exist', () => {
    const s = toolsetsSatisfiedByTools(
      new Set(['web_search', 'web_fetch', 'web_extract', 'read_file']),
    );
    expect(s.has('web')).toBe(true);
  });

  it('does not mark web when a tool is missing', () => {
    const s = toolsetsSatisfiedByTools(new Set(['web_search', 'read_file']));
    expect(s.has('web')).toBe(false);
  });
});

describe('skillVisibleForRegisteredTools', () => {
  it('allows when no conditions', () => {
    const sk: Skill = {
      name: 'a',
      description: 'd',
      filePath: '/x/SKILL.md',
      baseDir: '/x',
      source: 'workspace',
      disableModelInvocation: false,
      metadata: { name: 'a', description: 'd' },
      content: '',
    };
    expect(skillVisibleForRegisteredTools(sk, new Set())).toBe(true);
  });

  it('hides when requires_tools missing', () => {
    const sk = skillWithConditions({ requiresTools: ['web_search'], requiresToolsets: [], fallbackForTools: [], fallbackForToolsets: [] });
    expect(skillVisibleForRegisteredTools(sk, new Set())).toBe(false);
    expect(skillVisibleForRegisteredTools(sk, new Set(['web_search']))).toBe(true);
  });

  it('hides when fallback_for_tools present', () => {
    const sk = skillWithConditions({
      requiresTools: [],
      requiresToolsets: [],
      fallbackForTools: ['web_search'],
      fallbackForToolsets: [],
    });
    expect(skillVisibleForRegisteredTools(sk, new Set(['web_search']))).toBe(false);
    expect(skillVisibleForRegisteredTools(sk, new Set(['read_file']))).toBe(true);
  });

  it('hides when requires_toolsets missing', () => {
    const sk = skillWithConditions({
      requiresTools: [],
      requiresToolsets: ['web'],
      fallbackForTools: [],
      fallbackForToolsets: [],
    });
    expect(skillVisibleForRegisteredTools(sk, new Set(['read_file']))).toBe(false);
    expect(
      skillVisibleForRegisteredTools(
        sk,
        new Set(['web_search', 'web_fetch', 'web_extract']),
      ),
    ).toBe(true);
  });
});

describe('parseSkillToolConditions', () => {
  it('reads metadata.hermes keys', () => {
    const c = parseSkillToolConditions({
      metadata: {
        hermes: {
          requires_tools: ['web_search'],
          fallback_for_toolsets: ['browser'],
        },
      },
    });
    expect(c?.requiresTools).toEqual(['web_search']);
    expect(c?.fallbackForToolsets).toEqual(['browser']);
  });
});

describe('selectSkillsVisibleInPrompt tool gating', () => {
  it('filters with registeredToolNames when toolGating is on', () => {
    const sk = skillWithConditions({
      requiresTools: ['web_search'],
      requiresToolsets: [],
      fallbackForTools: [],
      fallbackForToolsets: [],
    });
    const out = selectSkillsVisibleInPrompt([sk], { toolGating: true }, { registeredToolNames: [] });
    expect(out).toHaveLength(0);
    const out2 = selectSkillsVisibleInPrompt([sk], { toolGating: true }, { registeredToolNames: ['web_search'] });
    expect(out2).toHaveLength(1);
  });

  it('skips gating when toolGating is false', () => {
    const sk = skillWithConditions({
      requiresTools: ['web_search'],
      requiresToolsets: [],
      fallbackForTools: [],
      fallbackForToolsets: [],
    });
    const out = selectSkillsVisibleInPrompt([sk], { toolGating: false }, { registeredToolNames: [] });
    expect(out).toHaveLength(1);
  });
});
