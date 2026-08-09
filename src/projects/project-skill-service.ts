import { accessSync, constants, existsSync, statSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';

import type { Config } from '../config/schema.js';
import { loadWorkspaceSkills } from '../agent/skills/index.js';
import { pullSkillFromSource } from '../agent/skills/hub-pull.js';
import { removeSkillsLockEntry } from '../agent/skills/hub-lock.js';
import { deleteManagedSkill, installSkillFromZip, isValidSkillId } from '../agent/skills/managed-store.js';
import { downloadFromMarketplace } from '../agent/skills/skills-marketplace.js';
import { resolveWorkspaceSkillsDir, resolveWorkspaceSkillsLockPath } from '../agent/skills/workspace-skills-dir.js';
import type { Skill, SkillDiagnostic, SkillMetadata, SkillToolConditions } from '../agent/skills/types.js';
import type { ProjectService } from './project-service.js';

export type ProjectSkillErrorCode =
  | 'project_not_found'
  | 'project_workspace_required'
  | 'project_workspace_missing'
  | 'project_workspace_not_writable'
  | 'skill_not_found'
  | 'invalid_skill_id';

export class ProjectSkillError extends Error {
  constructor(readonly code: ProjectSkillErrorCode, readonly status: 400 | 403 | 404 | 409, message: string) {
    super(message);
    this.name = 'ProjectSkillError';
  }
}

export interface ProjectSkillSummary {
  id: string;
  name: string;
  description: string;
  category?: string;
  disableModelInvocation: boolean;
  metadata: SkillMetadata;
  toolConditions?: SkillToolConditions;
  requiredEnvVarNames?: string[];
}

export interface ProjectSkillListResult {
  workspaceRoot: string;
  skillsRoot: string;
  items: ProjectSkillSummary[];
  diagnostics: SkillDiagnostic[];
}

interface ProjectSkillServiceOptions {
  projects: ProjectService;
  getConfig: () => Config;
  refreshSkills: () => void | Promise<void>;
}

export class ProjectSkillService {
  constructor(private readonly options: ProjectSkillServiceOptions) {}

  list(projectId: string): ProjectSkillListResult {
    const location = this.resolveLocation(projectId, false);
    const loaded = loadWorkspaceSkills(location.workspaceRoot);
    return {
      ...location,
      items: loaded.skills
        .filter((skill) => this.isDirectSkill(skill, location.skillsRoot))
        .map((skill) => this.toSummary(skill)),
      diagnostics: loaded.diagnostics,
    };
  }

  getContent(projectId: string, skillId: string): ProjectSkillSummary & { bodyMarkdown: string } {
    const { skill } = this.findSkill(projectId, skillId);
    return { ...this.toSummary(skill), bodyMarkdown: skill.content };
  }

  async installZip(projectId: string, buffer: Buffer, input: { skillId?: string; overwrite?: boolean } = {}) {
    const location = this.resolveLocation(projectId, true);
    const installed = installSkillFromZip(buffer, {
      skillId: input.skillId,
      overwrite: input.overwrite,
      rootDir: location.skillsRoot,
    });
    removeSkillsLockEntry(installed.skillId, resolveWorkspaceSkillsLockPath(location.workspaceRoot));
    await this.options.refreshSkills();
    return this.getContent(projectId, installed.skillId);
  }

  async installMarketplace(projectId: string, input: { name: string; version?: string; provider?: string; overwrite?: boolean }) {
    const downloaded = await downloadFromMarketplace(this.options.getConfig(), input.name, input.version, input.provider);
    return this.installZip(projectId, downloaded.buffer, {
      skillId: downloaded.skillId,
      overwrite: input.overwrite,
    });
  }

  async installSource(projectId: string, input: { source: string; skillId?: string; ref?: string; subpath?: string; force?: boolean }) {
    const location = this.resolveLocation(projectId, true);
    const installed = await pullSkillFromSource(input.source, {
      skillId: input.skillId,
      ref: input.ref,
      subpath: input.subpath,
      force: input.force,
      installRoot: location.skillsRoot,
      lockPath: resolveWorkspaceSkillsLockPath(location.workspaceRoot),
    });
    await this.options.refreshSkills();
    return this.getContent(projectId, installed.skillId);
  }

  async remove(projectId: string, skillId: string): Promise<void> {
    const location = this.resolveLocation(projectId, true);
    if (!isValidSkillId(skillId)) {
      throw new ProjectSkillError('invalid_skill_id', 400, 'Invalid skill id');
    }
    if (!existsSync(join(location.skillsRoot, skillId, 'SKILL.md'))) {
      throw new ProjectSkillError('skill_not_found', 404, 'Project skill not found');
    }
    deleteManagedSkill(skillId, location.skillsRoot);
    removeSkillsLockEntry(skillId, resolveWorkspaceSkillsLockPath(location.workspaceRoot));
    await this.options.refreshSkills();
  }

  private findSkill(projectId: string, skillId: string): { skill: Skill; skillsRoot: string } {
    if (!isValidSkillId(skillId)) {
      throw new ProjectSkillError('invalid_skill_id', 400, 'Invalid skill id');
    }
    const location = this.resolveLocation(projectId, false);
    const skill = loadWorkspaceSkills(location.workspaceRoot).skills.find((item) => {
      const rel = relative(location.skillsRoot, item.baseDir);
      return !rel.includes(sep) && basename(item.baseDir) === skillId;
    });
    if (!skill) throw new ProjectSkillError('skill_not_found', 404, 'Project skill not found');
    return { skill, skillsRoot: location.skillsRoot };
  }

  private resolveLocation(projectId: string, requireWritable: boolean): { workspaceRoot: string; skillsRoot: string } {
    const project = this.options.projects.get(projectId);
    if (!project) throw new ProjectSkillError('project_not_found', 404, 'Project not found');
    const configuredRoot = project.workspaceRoot?.trim();
    if (!configuredRoot) {
      throw new ProjectSkillError('project_workspace_required', 409, 'Project workspace is required');
    }
    const workspaceRoot = resolve(configuredRoot);
    try {
      if (!existsSync(workspaceRoot) || !statSync(workspaceRoot).isDirectory()) {
        throw new ProjectSkillError('project_workspace_missing', 409, 'Project workspace does not exist');
      }
    } catch (error) {
      if (error instanceof ProjectSkillError) throw error;
      throw new ProjectSkillError('project_workspace_missing', 409, 'Project workspace does not exist');
    }
    const skillsRoot = resolveWorkspaceSkillsDir(workspaceRoot);
    if (requireWritable) {
      try {
        const xopcRoot = dirname(skillsRoot);
        const writableRoot = existsSync(skillsRoot) ? skillsRoot : existsSync(xopcRoot) ? xopcRoot : workspaceRoot;
        accessSync(writableRoot, constants.W_OK);
      } catch {
        throw new ProjectSkillError('project_workspace_not_writable', 403, 'Project workspace is not writable');
      }
    }
    return { workspaceRoot, skillsRoot };
  }

  private isDirectSkill(skill: Skill, skillsRoot: string): boolean {
    const rel = relative(skillsRoot, skill.baseDir);
    return Boolean(rel) && !rel.includes(sep) && isValidSkillId(basename(skill.baseDir));
  }

  private toSummary(skill: Skill): ProjectSkillSummary {
    const id = basename(skill.baseDir);
    return {
      id,
      name: skill.name,
      description: skill.description,
      category: skill.category,
      disableModelInvocation: skill.disableModelInvocation,
      metadata: skill.metadata,
      toolConditions: skill.toolConditions,
      requiredEnvVarNames: skill.requiredEnvVarNames,
    };
  }
}
