import { describe, expect, it } from 'vitest';

import {
  DEFAULT_MAX_SKILLS_IN_PROMPT,
  formatSkillsForPrompt,
  selectSkillsVisibleInPrompt,
} from '../format-skills-prompt.js';
import type { Skill, SkillOrigin } from '../types.js';

function makeOrigin(id: SkillOrigin['id'], priority: number, scope: SkillOrigin['scope']): SkillOrigin {
  return {
    id,
    rootDir: `/tmp/${id}`,
    priority,
    scope,
    managed: false,
    writable: false,
  };
}

const baseSkill: Skill = {
  name: 'alpha',
  description: 'Alpha skill',
  filePath: '/tmp/skills/alpha/SKILL.md',
  baseDir: '/tmp/skills/alpha',
  source: 'workspace',
  origin: makeOrigin('xopc-workspace', 500, 'workspace'),
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
    const beta = { ...baseSkill, name: 'beta', description: 'Beta skill', category: 'devops' };
    const limitedByCount = formatSkillsForPrompt(
      [baseSkill, beta],
      { limits: { maxSkillsInPrompt: 1 } },
    );
    expect(limitedByCount).toContain('<name>alpha</name>');
    expect(limitedByCount).not.toContain('<name>beta</name>');
    expect(limitedByCount).toContain('<more_skills omitted="1" categories="devops(1)">');
    expect(limitedByCount).toContain('skills_list');

    const limitedByChars = formatSkillsForPrompt(
      [baseSkill],
      { limits: { maxSkillsPromptChars: 128 } },
    );
    expect(limitedByChars).toBe('');
  });

  it('defaults to 50 inline skills and summarizes overflow categories', () => {
    expect(DEFAULT_MAX_SKILLS_IN_PROMPT).toBe(50);
    const manySkills: Skill[] = Array.from({ length: 65 }, (_, idx) => ({
      ...baseSkill,
      name: `skill-${String(idx).padStart(2, '0')}`,
      description: `Skill number ${idx}`,
      category: idx % 2 === 0 ? 'devops' : 'writing',
    }));

    const xml = formatSkillsForPrompt(manySkills, {});
    expect(xml.length).toBeLessThanOrEqual(12_000);
    expect(xml).toContain('skill-00');
    expect(xml).not.toContain('skill-64');
    expect(xml).toContain('<more_skills omitted="15"');
    expect(xml).toContain('devops(');
    expect(xml).toContain('writing(');
  });

  it('prioritizes pinned and higher-priority sources over lower-priority sources', () => {
    const extraSkill: Skill = {
      ...baseSkill,
      name: 'aaa-extra',
      source: 'extra',
      origin: makeOrigin('extra', 100, 'extra'),
    };
    const bundledSkill: Skill = {
      ...baseSkill,
      name: 'bbb-bundled',
      source: 'builtin',
      origin: makeOrigin('bundled', 200, 'builtin'),
    };
    const workspaceSkill: Skill = {
      ...baseSkill,
      name: 'zzz-workspace',
      source: 'workspace',
      origin: makeOrigin('xopc-workspace', 500, 'workspace'),
    };
    const pinnedBundled: Skill = {
      ...baseSkill,
      name: 'mmm-pinned',
      source: 'builtin',
      origin: makeOrigin('bundled', 200, 'builtin'),
    };

    const xml = formatSkillsForPrompt(
      [extraSkill, bundledSkill, workspaceSkill, pinnedBundled],
      {
        limits: { maxSkillsInPrompt: 2 },
        entries: { 'mmm-pinned': { pinned: true } },
      },
    );

    expect(xml).toContain('<name>mmm-pinned</name>');
    expect(xml).toContain('<name>zzz-workspace</name>');
    expect(xml).not.toContain('<name>aaa-extra</name>');
    expect(xml).not.toContain('<name>bbb-bundled</name>');
    expect(xml.indexOf('mmm-pinned')).toBeLessThan(xml.indexOf('zzz-workspace'));
    expect(xml).toContain('<more_skills omitted="2"');
  });

  it('degrades to compact entries when character budget is tight before omitting', () => {
    const skills: Skill[] = Array.from({ length: 12 }, (_, idx) => ({
      ...baseSkill,
      name: `skill-${String(idx).padStart(2, '0')}`,
      description: 'A detailed workflow description explaining when to invoke this skill in production environments.',
      category: 'ops',
    }));

    const xml = formatSkillsForPrompt(skills, {
      limits: { maxSkillsInPrompt: 12, maxSkillsPromptChars: 1200 },
    });

    expect(xml.length).toBeLessThanOrEqual(1200);
    expect(xml).toContain('<name>skill-00</name>');
    expect(xml).toMatch(/<skill name="skill-\d+" category="ops"\/>/);
  });

  it('keeps deferred skills out of inline entries and surfaces them via more_skills', () => {
    const deferredSkill: Skill = {
      ...baseSkill,
      name: 'heavy-rare',
      category: 'finance',
    };

    const withInline = formatSkillsForPrompt(
      [baseSkill, deferredSkill],
      { entries: { 'heavy-rare': { exposure: 'deferred' } } },
    );
    expect(withInline).toContain('<name>alpha</name>');
    expect(withInline).not.toContain('heavy-rare');
    expect(withInline).toContain('<more_skills omitted="1" categories="finance(1)">');

    const onlyDeferredWithList = formatSkillsForPrompt(
      [deferredSkill],
      { entries: { 'heavy-rare': { exposure: 'deferred' } } },
      { registeredToolNames: ['skill_view', 'skills_list'] },
    );
    expect(onlyDeferredWithList).toContain('<more_skills omitted="1" categories="finance(1)">');

    const onlyDeferredWithoutList = formatSkillsForPrompt(
      [deferredSkill],
      { entries: { 'heavy-rare': { exposure: 'deferred' } } },
      { registeredToolNames: ['skill_view'] },
    );
    expect(onlyDeferredWithoutList).toBe('');
  });

  it('truncates long descriptions in the prompt catalog', () => {
    const verbose: Skill = {
      ...baseSkill,
      description: 'x'.repeat(250),
    };
    const xml = formatSkillsForPrompt([verbose], {
      limits: { maxDescriptionCharsInPrompt: 50 },
    });
    expect(xml).toContain(`<description>${'x'.repeat(49)}…</description>`);
  });
});

describe('skill catalog tool availability', () => {
  it.each([[], ['skills_list'], ['read_file']])('omits unreachable skill bodies for %j', (...registeredToolNames: string[]) => {
    expect(formatSkillsForPrompt([baseSkill], {}, { registeredToolNames })).toBe('');
  });

  it('uses the actual loader name without inventing a listing tool', () => {
    const beta = { ...baseSkill, name: 'beta', description: 'Beta skill' };
    const prompt = formatSkillsForPrompt(
      [baseSkill, beta],
      { limits: { maxSkillsInPrompt: 1 } },
      { registeredToolNames: [' SKILL_VIEW '] },
    );
    expect(prompt).toContain('<name>alpha</name>');
    expect(prompt).toContain('SKILL_VIEW(name, path)');
    expect(prompt).toContain('<more_skills omitted="1"');
    expect(prompt).not.toContain('skills_list');
    expect(prompt).not.toContain('skill_view');
  });
});
