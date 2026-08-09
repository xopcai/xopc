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
  const refreshSkills = vi.fn();

  beforeEach(() => {
    previousStateDir = process.env.XOPC_STATE_DIR;
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-project-skills-state-'));
    workspaceRoot = mkdtempSync(join(tmpdir(), 'xopc-project-skills-workspace-'));
    process.env.XOPC_STATE_DIR = stateDir;
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
    projects = new ProjectService();
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
      refreshSkills,
    });
  }

  it('installs, lists, reads, and removes only workspace-local skills', async () => {
    const project = projects.create({ name: 'Commerce', workspaceRoot });
    const globalSkillDir = join(stateDir, 'skills', 'global-only');
    mkdirSync(globalSkillDir, { recursive: true });
    writeFileSync(join(globalSkillDir, 'SKILL.md'), '---\nname: global-only\ndescription: global\n---\n');

    const installed = await service().installZip(project.id, makeSkillZip('commerce-sales'));

    expect(installed.id).toBe('commerce-sales');
    expect(installed.bodyMarkdown).toContain('Use commerce-sales.');
    expect(existsSync(join(workspaceRoot, '.xopc', 'skills', 'commerce-sales', 'SKILL.md'))).toBe(true);
    expect(service().list(project.id).items.map((item) => item.id)).toEqual(['commerce-sales']);
    expect(refreshSkills).toHaveBeenCalledTimes(1);

    await service().remove(project.id, 'commerce-sales');

    expect(service().list(project.id).items).toEqual([]);
    expect(refreshSkills).toHaveBeenCalledTimes(2);
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
