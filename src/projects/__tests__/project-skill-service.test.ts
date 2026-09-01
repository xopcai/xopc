import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import AdmZip from 'adm-zip';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConfigSchema } from '../../config/schema.js';
import {
  closeXopcDatabase,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
} from '../../storage/sqlite/index.js';
import { ProjectService } from '../project-service.js';
import { ProjectSkillError, ProjectSkillService } from '../project-skill-service.js';

function makeSkillZip(id: string): Buffer {
  const zip = new AdmZip();
  zip.addFile(
    `${id}/SKILL.md`,
    Buffer.from(`---\nname: ${id}\ndescription: ${id} description\n---\n\nUse ${id}.\n`),
  );
  return zip.toBuffer();
}

describe('ProjectSkillService', () => {
  let stateDir: string;
  let workspaceRoot: string;
  let previousStateDir: string | undefined;
  let projects: ProjectService;
  let workspaceTrusted: boolean;
  const refreshSkills = vi.fn();

  beforeEach(() => {
    previousStateDir = process.env.XOPC_STATE_DIR;
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-project-skills-state-'));
    workspaceRoot = mkdtempSync(join(tmpdir(), 'xopc-project-skills-workspace-'));
    process.env.XOPC_STATE_DIR = stateDir;
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
    projects = new ProjectService();
    workspaceTrusted = false;
    refreshSkills.mockReset();
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    if (previousStateDir === undefined) delete process.env.XOPC_STATE_DIR;
    else process.env.XOPC_STATE_DIR = previousStateDir;
    rmSync(stateDir, { recursive: true, force: true });
    rmSync(workspaceRoot, { recursive: true, force: true });
  });

  function service(): ProjectSkillService {
    return new ProjectSkillService({
      projects,
      getConfig: () => ConfigSchema.parse({}),
      getWorkspaceTrust: (workspacePath) => ({
        workspacePath,
        required: true,
        decision: workspaceTrusted,
        trusted: workspaceTrusted,
      }),
      setWorkspaceTrust: (workspacePath, trusted) => {
        workspaceTrusted = trusted;
        return { workspacePath, required: true, decision: trusted, trusted };
      },
      refreshSkills,
    });
  }

  it('installs, lists, reads, and removes XOPC workspace skills', async () => {
    const project = projects.create({ name: 'Commerce', workspaceRoot });
    const globalSkillDir = join(stateDir, 'skills', 'global-only');
    mkdirSync(globalSkillDir, { recursive: true });
    writeFileSync(join(globalSkillDir, 'SKILL.md'), '---\nname: global-only\ndescription: global\n---\n');

    const installed = await service().installZip(project.id, makeSkillZip('commerce-sales'));

    expect(installed.directoryId).toBe('commerce-sales');
    expect(installed.key).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(installed.bodyMarkdown).toContain('Use commerce-sales.');
    expect(existsSync(join(workspaceRoot, '.xopc', 'skills', 'commerce-sales', 'SKILL.md'))).toBe(true);
    expect(service().list(project.id).items.map((item) => item.directoryId)).toEqual(['commerce-sales']);
    expect(service().list(project.id).inheritedItems).toContainEqual(expect.objectContaining({
      name: 'global-only',
      origin: 'xopc-global',
      removable: false,
    }));
    expect(refreshSkills).toHaveBeenCalledTimes(1);

    await service().remove(project.id, 'commerce-sales');

    expect(service().list(project.id).items).toEqual([]);
    expect(refreshSkills).toHaveBeenCalledTimes(2);
  });

  it('lists trusted Agents workspace skills as read-only and keeps XOPC precedence', () => {
    const project = projects.create({ name: 'Compatibility', workspaceRoot });
    const agentsSkillDir = join(workspaceRoot, '.agents', 'skills', 'shared');
    const xopcSkillDir = join(workspaceRoot, '.xopc', 'skills', 'shared');
    mkdirSync(agentsSkillDir, { recursive: true });
    mkdirSync(xopcSkillDir, { recursive: true });
    writeFileSync(join(agentsSkillDir, 'SKILL.md'), '---\nname: shared\ndescription: Agents copy\n---\n\nAgents.\n');
    writeFileSync(join(xopcSkillDir, 'SKILL.md'), '---\nname: shared\ndescription: XOPC copy\n---\n\nXOPC.\n');
    workspaceTrusted = true;

    const result = service().list(project.id);

    expect(result.sources).toContainEqual(expect.objectContaining({
      origin: 'agents-workspace',
      state: 'active',
      managed: false,
      writable: false,
    }));
    expect(result.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        origin: 'agents-workspace',
        effective: false,
        shadowedBy: 'xopc-workspace',
        removable: false,
      }),
      expect.objectContaining({
        origin: 'xopc-workspace',
        effective: true,
        removable: true,
      }),
    ]));
  });

  it('does not read Agents workspace skills before the project is trusted', () => {
    const project = projects.create({ name: 'Untrusted', workspaceRoot });
    const skillDir = join(workspaceRoot, '.agents', 'skills', 'private');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), '---\nname: private\ndescription: Private\n---\n\nPrivate.\n');

    const result = service().list(project.id);

    expect(result.items).toEqual([]);
    expect(result.sources).toContainEqual(expect.objectContaining({ origin: 'agents-workspace', state: 'untrusted' }));
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ type: 'skipped' }));
  });

  it('lists nested project skills without making them removable', () => {
    const project = projects.create({ name: 'Nested', workspaceRoot });
    const skillDir = join(workspaceRoot, '.xopc', 'skills', 'engineering', 'review');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), '---\nname: review\ndescription: Review code\n---\n\nReview.\n');

    expect(service().list(project.id).items).toContainEqual(expect.objectContaining({
      origin: 'xopc-workspace',
      category: 'engineering',
      removable: false,
    }));
  });

  it('does not fall back when the project has no workspace', () => {
    const project = projects.create({ name: 'No workspace' });

    expect(() => service().list(project.id)).toThrowError(
      expect.objectContaining<ProjectSkillError>({ code: 'project_workspace_required' }),
    );
  });

  it('returns project_not_found for an unknown project', () => {
    expect(() => service().list('missing')).toThrowError(
      expect.objectContaining<ProjectSkillError>({ code: 'project_not_found' }),
    );
  });
});
