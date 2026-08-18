import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ProjectTrustStore } from '../../../project-trust/trust-store.js';
import { loadWorkspaceSkillCatalog } from '../skills.js';

describe('skills CLI workspace trust', () => {
  let previousHome: string | undefined;
  let previousStateDir: string | undefined;
  let rootDir: string;
  let workspaceDir: string;
  let trustStore: ProjectTrustStore;

  beforeEach(() => {
    previousHome = process.env.HOME;
    previousStateDir = process.env.XOPC_STATE_DIR;
    rootDir = mkdtempSync(join(tmpdir(), 'xopc-cli-skills-trust-'));
    workspaceDir = join(rootDir, 'workspace');
    const skillDir = join(workspaceDir, '.agents', 'skills', 'project-cli-skill');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      '---\nname: project-cli-skill\ndescription: Project CLI skill\n---\n\nUse it.\n',
    );
    process.env.HOME = join(rootDir, 'home');
    process.env.XOPC_STATE_DIR = join(rootDir, 'state');
    trustStore = new ProjectTrustStore(join(rootDir, 'trust.json'));
  });

  afterEach(() => {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    if (previousStateDir === undefined) delete process.env.XOPC_STATE_DIR;
    else process.env.XOPC_STATE_DIR = previousStateDir;
    rmSync(rootDir, { recursive: true, force: true });
  });

  it('loads workspace .agents skills when persistent trust is granted', () => {
    trustStore.set(workspaceDir, true);

    const result = loadWorkspaceSkillCatalog(workspaceDir, {
      trustStore,
      bundledSkillsDir: null,
    });

    expect(result.skills.find((skill) => skill.name === 'project-cli-skill')).toMatchObject({
      origin: expect.objectContaining({ id: 'agents-workspace' }),
    });
  });

  it.each([null, false] as const)(
    'skips workspace .agents skills when persistent trust is %s',
    (decision) => {
      if (decision !== null) trustStore.set(workspaceDir, decision);

      const result = loadWorkspaceSkillCatalog(workspaceDir, {
        trustStore,
        bundledSkillsDir: null,
      });

      expect(result.skills.some((skill) => skill.name === 'project-cli-skill')).toBe(false);
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({
          type: 'skipped',
          message: expect.stringContaining('workspace is not trusted'),
        }),
      );
    },
  );
});
