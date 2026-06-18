import { describe, expect, it } from 'vitest';

import { formatSkillsForPrompt, selectSkillsVisibleInPrompt } from '../format-skills-prompt.js';
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
    const xml = formatSkillsForPrompt([baseSkill], {}, { skillAllowlist: ['alpha'] });
    expect(xml).toContain('<name>alpha</name>');
    expect(xml).toContain('skill_view');
    expect(xml).not.toContain('<location>');
  });

  it('includes all enabled skills when no allowlist is configured', () => {
    const visible = selectSkillsVisibleInPrompt([baseSkill], {}, undefined);
    expect(visible.map((s) => s.name)).toEqual(['alpha']);
  });

  it('treats an explicit empty allowlist as no visible skills', () => {
    const visible = selectSkillsVisibleInPrompt([baseSkill], {}, { skillAllowlist: [] });
    expect(visible).toEqual([]);
  });
});
