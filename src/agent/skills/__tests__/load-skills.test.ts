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

  it('loads workspace skills only from .xopc/skills', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'xopc-workspace-skills-'));
    const projectSkillDir = join(workspace, '.xopc', 'skills', 'project-skill');
    const legacySkillDir = join(workspace, 'skills', 'legacy-skill');
    mkdirSync(projectSkillDir, { recursive: true });
    mkdirSync(legacySkillDir, { recursive: true });
    writeFileSync(
      join(projectSkillDir, 'SKILL.md'),
      `---\nname: project-skill\ndescription: Project skill\n---\n\nUse this project skill.\n`,
    );
    writeFileSync(
      join(legacySkillDir, 'SKILL.md'),
      `---\nname: legacy-skill\ndescription: Legacy skill\n---\n\nDo not load this skill.\n`,
    );

    const result = loadSkills({ workspaceDir: workspace });

    expect(result.skills.map((skill) => skill.name)).toContain('project-skill');
    expect(result.skills.map((skill) => skill.name)).not.toContain('legacy-skill');
    rmSync(workspace, { recursive: true, force: true });
  });

  it('lets workspace skills override global skills without diagnostics', () => {
    const globalDir = mkdtempSync(join(tmpdir(), 'xopc-global-skills-'));
    const workspace = mkdtempSync(join(tmpdir(), 'xopc-workspace-skills-'));
    const globalSkillDir = join(globalDir, 'same-name');
    const workspaceSkillDir = join(workspace, '.xopc', 'skills', 'same-name');
    mkdirSync(globalSkillDir, { recursive: true });
    mkdirSync(workspaceSkillDir, { recursive: true });
    writeFileSync(
      join(globalSkillDir, 'SKILL.md'),
      '---\nname: same-name\ndescription: Global skill\n---\n\nGlobal content.\n',
    );
    writeFileSync(
      join(workspaceSkillDir, 'SKILL.md'),
      '---\nname: same-name\ndescription: Workspace skill\n---\n\nWorkspace content.\n',
    );

    const result = loadSkills({ globalDir, workspaceDir: workspace });

    expect(result.skills.find((skill) => skill.name === 'same-name')).toMatchObject({
      description: 'Workspace skill',
      source: 'workspace',
    });
    expect(result.diagnostics).not.toContainEqual(
      expect.objectContaining({ type: 'collision', skillName: 'same-name' }),
    );
    rmSync(globalDir, { recursive: true, force: true });
    rmSync(workspace, { recursive: true, force: true });
  });

  it('parses xopc activated capabilities metadata', () => {
    const root = mkdtempSync(join(tmpdir(), 'xopc-skills-'));
    const skillDir = join(root, 'hatch-pet');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      `---\nname: hatch-pet\ndescription: Create pets\nmetadata:\n  xopc:\n    activates_capabilities:\n      - desktop-pet-authoring\n---\n\nCreate a pet.\n`,
    );

    const result = loadSkills({ globalDir: root });

    expect(result.skills.find((skill) => skill.name === 'hatch-pet')?.metadata.xopc?.activatesCapabilities).toEqual([
      'desktop-pet-authoring',
    ]);
    rmSync(root, { recursive: true, force: true });
  });
});
