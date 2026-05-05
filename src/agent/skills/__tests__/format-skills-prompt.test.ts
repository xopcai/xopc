import { describe, expect, it } from 'vitest';

import { formatSkillsForPrompt } from '../format-skills-prompt.js';
import type { Skill } from '../types.js';

const baseSkill: Skill = {
  name: 'alpha',
  description: 'Alpha skill',
  filePath: '/tmp/skills/alpha/SKILL.md',
  baseDir: '/tmp/skills/alpha',
  source: 'workspace',
  disableModelInvocation: false,
  metadata: { name: 'alpha', description: 'Alpha skill' },
  content: '',
};

describe('formatSkillsForPrompt', () => {
  it('uses Hermes-style XML without disk paths', () => {
    const xml = formatSkillsForPrompt([baseSkill], {});
    expect(xml).toContain('<name>alpha</name>');
    expect(xml).toContain('skill_view');
    expect(xml).not.toContain('<location>');
  });
});
