import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadSkills } from '../index.js';
import { resolveAgentsSkillsDir, resolveSkillSources } from '../skill-sources.js';

describe('loadSkills', () => {
  let previousStateDir: string | undefined;
  let stateDir: string;
  let homeDir: string;

  beforeEach(() => {
    previousStateDir = process.env.XOPC_STATE_DIR;
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-skills-state-'));
    homeDir = mkdtempSync(join(tmpdir(), 'xopc-skills-home-'));
    process.env.XOPC_STATE_DIR = stateDir;
  });

  afterEach(() => {
    if (previousStateDir === undefined) delete process.env.XOPC_STATE_DIR;
    else process.env.XOPC_STATE_DIR = previousStateDir;
    rmSync(stateDir, { recursive: true, force: true });
    rmSync(homeDir, { recursive: true, force: true });
  });

  function loadTestSkills(options: Parameters<typeof loadSkills>[0]) {
    return loadSkills({ ...options, agentsDir: join(homeDir, '.agents', 'skills') });
  }

  it('resolves ~/.agents independently from XOPC state overrides', () => {
    expect(
      resolveAgentsSkillsDir({
        HOME: '/home/example',
        XOPC_HOME: '/custom/xopc-home',
        XOPC_STATE_DIR: '/custom/xopc-state',
      }),
    ).toBe(join('/home/example', '.agents', 'skills'));
  });

  it('loads markdown-only skills by deriving description from body', () => {
    const root = mkdtempSync(join(tmpdir(), 'xopc-skills-'));
    const skillDir = join(root, 'qa-plan');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      `# QA Test Plan Generator\n\nYou are a Quality Assurance architect. Generate comprehensive test plans.\n`,
    );

    const result = loadTestSkills({ globalDir: root });

    expect(result.skills).toContainEqual(
      expect.objectContaining({
        name: 'qa-plan',
        description: 'You are a Quality Assurance architect. Generate comprehensive test plans.',
        source: 'global',
        origin: expect.objectContaining({ id: 'custom-global', managed: false, writable: false }),
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

    const result = loadTestSkills({ globalDir: root });

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

    const result = loadTestSkills({ workspaceDir: workspace });

    expect(result.skills.map((skill) => skill.name)).toContain('project-skill');
    expect(result.skills.map((skill) => skill.name)).not.toContain('legacy-skill');
    rmSync(workspace, { recursive: true, force: true });
  });

  it('loads trusted workspace .agents/skills as a read-only compatibility source', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'xopc-workspace-agents-skills-'));
    const skillDir = join(workspace, '.agents', 'skills', 'project-agents-skill');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      '---\nname: project-agents-skill\ndescription: Project agents skill\n---\n\nUse it.\n',
    );

    const result = loadTestSkills({ workspaceDir: workspace, workspaceTrust: 'trusted' });

    expect(result.skills.find((skill) => skill.name === 'project-agents-skill')).toMatchObject({
      source: 'workspace',
      origin: expect.objectContaining({
        id: 'agents-workspace',
        managed: false,
        writable: false,
      }),
    });
    rmSync(workspace, { recursive: true, force: true });
  });

  it('skips workspace .agents/skills unless trust is explicitly granted', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'xopc-workspace-agents-skills-'));
    const skillDir = join(workspace, '.agents', 'skills', 'untrusted-skill');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      '---\nname: untrusted-skill\ndescription: Untrusted skill\n---\n\nDo not load.\n',
    );

    const result = loadTestSkills({ workspaceDir: workspace });

    expect(result.skills.some((skill) => skill.name === 'untrusted-skill')).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        type: 'skipped',
        message: expect.stringContaining('workspace is not trusted'),
      }),
    );
    rmSync(workspace, { recursive: true, force: true });
  });

  it('can disable the workspace .agents/skills compatibility source', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'xopc-workspace-agents-disabled-'));
    const skillDir = join(workspace, '.agents', 'skills', 'disabled-project-skill');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      '---\nname: disabled-project-skill\ndescription: Disabled project skill\n---\n\nDo not load.\n',
    );
    writeFileSync(
      join(stateDir, 'skills.json'),
      JSON.stringify({ load: { sources: { agentsWorkspace: { enabled: false } } } }),
    );

    const result = loadTestSkills({ workspaceDir: workspace, workspaceTrust: 'trusted' });

    expect(result.skills.some((skill) => skill.name === 'disabled-project-skill')).toBe(false);
    expect(result.diagnostics.some((diag) => diag.path?.includes('.agents'))).toBe(false);
    rmSync(workspace, { recursive: true, force: true });
  });

  it('keeps native workspace skills above workspace agents compatibility skills', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'xopc-workspace-source-priority-'));
    const agentsSkillDir = join(workspace, '.agents', 'skills', 'same-name');
    const xopcSkillDir = join(workspace, '.xopc', 'skills', 'same-name');
    mkdirSync(agentsSkillDir, { recursive: true });
    mkdirSync(xopcSkillDir, { recursive: true });
    writeFileSync(
      join(agentsSkillDir, 'SKILL.md'),
      '---\nname: same-name\ndescription: Agents workspace skill\n---\n\nAgents.\n',
    );
    writeFileSync(
      join(xopcSkillDir, 'SKILL.md'),
      '---\nname: same-name\ndescription: XOPC workspace skill\n---\n\nXOPC.\n',
    );

    const result = loadTestSkills({ workspaceDir: workspace, workspaceTrust: 'trusted' });

    expect(result.skills.find((skill) => skill.name === 'same-name')).toMatchObject({
      description: 'XOPC workspace skill',
      origin: expect.objectContaining({ id: 'xopc-workspace' }),
    });
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        type: 'collision',
        message: expect.stringContaining('shadows agents-workspace'),
      }),
    );
    rmSync(workspace, { recursive: true, force: true });
  });

  it('does not promote the global agents root when the workspace is HOME', () => {
    const agentsRoot = join(homeDir, '.agents', 'skills');
    const result = resolveSkillSources(
      {
        workspaceDir: homeDir,
        agentsDir: agentsRoot,
        workspaceTrust: 'trusted',
      },
      {},
    );

    expect(result.sources.filter((source) => source.rootDir === agentsRoot)).toHaveLength(1);
    expect(result.sources.find((source) => source.rootDir === agentsRoot)?.id).toBe('agents-global');
  });

  it('rejects workspace agents roots that resolve outside the workspace', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'xopc-workspace-agents-link-'));
    const outside = mkdtempSync(join(tmpdir(), 'xopc-workspace-agents-outside-'));
    mkdirSync(join(workspace, '.agents'), { recursive: true });
    symlinkSync(outside, join(workspace, '.agents', 'skills'), 'dir');

    const result = loadTestSkills({ workspaceDir: workspace, workspaceTrust: 'trusted' });

    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        type: 'warning',
        message: expect.stringContaining('outside workspace'),
      }),
    );
    rmSync(workspace, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });

  it('lets workspace skills override global skills and reports the shadowed source', () => {
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

    const result = loadTestSkills({ globalDir, workspaceDir: workspace });

    expect(result.skills.find((skill) => skill.name === 'same-name')).toMatchObject({
      description: 'Workspace skill',
      source: 'workspace',
    });
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        type: 'collision',
        skillName: 'same-name',
        message: expect.stringContaining('xopc-workspace'),
      }),
    );
    rmSync(globalDir, { recursive: true, force: true });
    rmSync(workspace, { recursive: true, force: true });
  });

  it('loads configured extra directories as read-only fallback sources', () => {
    const extraDir = mkdtempSync(join(tmpdir(), 'xopc-extra-skills-'));
    const bundledDir = mkdtempSync(join(tmpdir(), 'xopc-bundled-skills-'));
    const extraSkillDir = join(extraDir, 'same-name');
    const bundledSkillDir = join(bundledDir, 'same-name');
    mkdirSync(extraSkillDir, { recursive: true });
    mkdirSync(bundledSkillDir, { recursive: true });
    writeFileSync(
      join(extraSkillDir, 'SKILL.md'),
      '---\nname: same-name\ndescription: Extra skill\n---\n\nExtra content.\n',
    );
    writeFileSync(
      join(bundledSkillDir, 'SKILL.md'),
      '---\nname: same-name\ndescription: Bundled skill\n---\n\nBundled content.\n',
    );
    writeFileSync(join(stateDir, 'skills.json'), JSON.stringify({ load: { extraDirs: [extraDir] } }));

    const result = loadTestSkills({ builtinDir: bundledDir });

    expect(result.skills.find((skill) => skill.name === 'same-name')).toMatchObject({
      description: 'Bundled skill',
      source: 'builtin',
      origin: { id: 'bundled', managed: false, writable: false },
    });
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ type: 'collision', skillName: 'same-name' }),
    );
    rmSync(extraDir, { recursive: true, force: true });
    rmSync(bundledDir, { recursive: true, force: true });
  });

  it('loads ~/.agents/skills as a read-only global compatibility source', () => {
    const skillDir = join(homeDir, '.agents', 'skills', 'agents-skill');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      '---\nname: agents-skill\ndescription: Agents skill\ncli_version: ">=1.0.0"\n---\n\nUse it.\n',
    );

    const result = loadTestSkills({});

    expect(result.skills.find((skill) => skill.name === 'agents-skill')).toMatchObject({
      description: 'Agents skill',
      source: 'global',
      origin: expect.objectContaining({
        id: 'agents-global',
        managed: false,
        writable: false,
      }),
    });
  });

  it('lets xopc global skills override ~/.agents/skills with the same name', () => {
    const agentsSkillDir = join(homeDir, '.agents', 'skills', 'same-name');
    const xopcSkillDir = join(stateDir, 'skills', 'same-name');
    mkdirSync(agentsSkillDir, { recursive: true });
    mkdirSync(xopcSkillDir, { recursive: true });
    writeFileSync(
      join(agentsSkillDir, 'SKILL.md'),
      '---\nname: same-name\ndescription: Agents skill\n---\n\nAgents content.\n',
    );
    writeFileSync(
      join(xopcSkillDir, 'SKILL.md'),
      '---\nname: same-name\ndescription: Xopc skill\n---\n\nXopc content.\n',
    );

    const result = loadTestSkills({});

    expect(result.skills.find((skill) => skill.name === 'same-name')).toMatchObject({
      description: 'Xopc skill',
      origin: expect.objectContaining({ id: 'xopc-global' }),
    });
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        type: 'collision',
        skillName: 'same-name',
        message: expect.stringContaining('shadows agents-global'),
      }),
    );
  });

  it('can disable the ~/.agents/skills compatibility source', () => {
    const skillDir = join(homeDir, '.agents', 'skills', 'agents-skill');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      '---\nname: agents-skill\ndescription: Agents skill\n---\n\nUse it.\n',
    );
    writeFileSync(
      join(stateDir, 'skills.json'),
      JSON.stringify({ load: { sources: { agentsGlobal: { enabled: false } } } }),
    );

    const result = loadTestSkills({});

    expect(result.skills.some((skill) => skill.name === 'agents-skill')).toBe(false);
  });

  it('rejects oversized SKILL.md files before reading them', () => {
    const skillDir = join(homeDir, '.agents', 'skills', 'oversized');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      '---\nname: oversized\ndescription: Oversized skill\n---\n\nThis body is too large.\n',
    );
    writeFileSync(join(stateDir, 'skills.json'), JSON.stringify({ limits: { maxSkillFileBytes: 32 } }));

    const result = loadTestSkills({});

    expect(result.skills.some((skill) => skill.name === 'oversized')).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ type: 'error', message: expect.stringContaining('exceeds size limit') }),
    );
  });

  it('applies workspace, global, bundled, and extra precedence deterministically', () => {
    const extraDir = mkdtempSync(join(tmpdir(), 'xopc-extra-skills-'));
    const bundledDir = mkdtempSync(join(tmpdir(), 'xopc-bundled-skills-'));
    const globalDir = join(stateDir, 'skills');
    const workspace = mkdtempSync(join(tmpdir(), 'xopc-workspace-skills-'));
    const roots = [
      [extraDir, 'Extra skill'],
      [bundledDir, 'Bundled skill'],
      [globalDir, 'Global skill'],
      [join(workspace, '.xopc', 'skills'), 'Workspace skill'],
    ] as const;
    for (const [root, description] of roots) {
      const skillDir = join(root, 'same-name');
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(
        join(skillDir, 'SKILL.md'),
        `---\nname: same-name\ndescription: ${description}\n---\n\n${description} content.\n`,
      );
    }

    const result = loadTestSkills({ workspaceDir: workspace, builtinDir: bundledDir, extraDirs: [extraDir] });

    expect(result.skills.find((skill) => skill.name === 'same-name')).toMatchObject({
      description: 'Workspace skill',
      origin: expect.objectContaining({ id: 'xopc-workspace' }),
    });
    expect(result.diagnostics.filter((diag) => diag.type === 'collision' && diag.skillName === 'same-name')).toHaveLength(3);
    rmSync(extraDir, { recursive: true, force: true });
    rmSync(bundledDir, { recursive: true, force: true });
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

    const result = loadTestSkills({ globalDir: root });

    expect(result.skills.find((skill) => skill.name === 'hatch-pet')?.metadata.xopc?.activatesCapabilities).toEqual([
      'desktop-pet-authoring',
    ]);
    rmSync(root, { recursive: true, force: true });
  });
});
