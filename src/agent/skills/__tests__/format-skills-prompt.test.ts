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

  it('caps the number of skills and prompt characters', () => {
    const beta = { ...baseSkill, name: 'beta', description: 'Beta skill' };
    const limitedByCount = formatSkillsForPrompt(
      [baseSkill, beta],
      { limits: { maxSkillsInPrompt: 1 } },
    );
    expect(limitedByCount).toContain('<name>alpha</name>');
    expect(limitedByCount).not.toContain('<name>beta</name>');

    const limitedByChars = formatSkillsForPrompt(
      [baseSkill],
      { limits: { maxSkillsPromptChars: 128 } },
    );
    expect(limitedByChars).toBe('');
  });
});

describe('skill catalog tool availability', () => {
  it.each([[], ['skills_list'], ['read_file']])('omits unreachable skill bodies for %j', (...registeredToolNames: string[]) => {
    expect(formatSkillsForPrompt([baseSkill], {}, { registeredToolNames })).toBe('');
  });

  it('uses the actual loader name without inventing a listing tool', () => {
    const prompt = formatSkillsForPrompt([baseSkill], {}, { registeredToolNames: [' SKILL_VIEW '] });
    expect(prompt).toContain('<name>alpha</name>');
    expect(prompt).toContain('SKILL_VIEW(name, path)');
    expect(prompt).not.toContain('skills_list');
    expect(prompt).not.toContain('skill_view');
  });
});
