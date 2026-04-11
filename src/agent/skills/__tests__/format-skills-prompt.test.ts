import { describe, expect, it } from 'vitest';

import { effectiveSkillsPromptStyle, formatSkillsForPrompt } from '../format-skills-prompt.js';
import type { Skill, SkillsConfig } from '../types.js';

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

describe('effectiveSkillsPromptStyle', () => {
  it('defaults to metadata-only', () => {
    expect(effectiveSkillsPromptStyle(undefined)).toBe('metadata-only');
    expect(effectiveSkillsPromptStyle({})).toBe('metadata-only');
  });

  it('honors legacy-with-paths', () => {
    expect(effectiveSkillsPromptStyle({ promptStyle: 'legacy-with-paths' })).toBe('legacy-with-paths');
  });
});

describe('formatSkillsForPrompt', () => {
  it('omits location in metadata-only mode', () => {
    const xml = formatSkillsForPrompt([baseSkill], {});
    expect(xml).toContain('<name>alpha</name>');
    expect(xml).toContain('skill_view');
    expect(xml).not.toContain('<location>');
  });

  it('includes location in legacy mode', () => {
    const xml = formatSkillsForPrompt([baseSkill], { promptStyle: 'legacy-with-paths' });
    expect(xml).toContain('<location>');
    expect(xml).toContain('/tmp/skills/alpha/SKILL.md');
  });
});
