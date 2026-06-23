import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { loadSkills } from '../index.js';

describe('loadSkills', () => {
  it('loads markdown-only skills by deriving description from body', () => {
    const root = mkdtempSync(join(tmpdir(), 'xopc-skills-'));
    const skillDir = join(root, 'qa-plan');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      `# QA Test Plan Generator\n\nYou are a Quality Assurance architect. Generate comprehensive test plans.\n`,
    );

    const result = loadSkills({ globalDir: root });

    expect(result.skills).toContainEqual(
      expect.objectContaining({
        name: 'qa-plan',
        description: 'You are a Quality Assurance architect. Generate comprehensive test plans.',
        source: 'global',
        metadata: expect.objectContaining({
          name: 'qa-plan',
          description: 'You are a Quality Assurance architect. Generate comprehensive test plans.',
        }),
      }),
    );
    expect(result.prompt).toContain('<name>qa-plan</name>');
    rmSync(root, { recursive: true, force: true });
  });

  it('reports invalid skill files as diagnostics', () => {
    const root = mkdtempSync(join(tmpdir(), 'xopc-skills-'));
    const skillDir = join(root, 'empty-skill');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), `---\nname: empty-skill\n---\n\n`);

    const result = loadSkills({ globalDir: root });

    expect(result.skills.some((skill) => skill.name === 'empty-skill')).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        type: 'error',
        skillName: 'empty-skill',
        message: 'Skill "empty-skill" is missing a description',
      }),
    );
    rmSync(root, { recursive: true, force: true });
  });
});
