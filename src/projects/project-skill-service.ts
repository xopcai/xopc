import { accessSync, constants, existsSync, statSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';

import type { Config } from '../config/schema.js';
import {
  loadSkills,
  loadWorkspaceSkillInventory,
  type WorkspaceSkillInventoryEntry,
  type WorkspaceSkillSourceStatus,
} from '../agent/skills/index.js';
import { resolveBundledSkillsDir } from '../config/paths.js';
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
  key: string;
  directoryId: string;
  name: string;
  description: string;
  category?: string;
  origin: Skill['origin']['id'];
  path: string;
  managed: boolean;
  writable: boolean;
  removable: boolean;
  effective: boolean;
  shadowedBy?: Skill['origin']['id'];
  disableModelInvocation: boolean;
  metadata: SkillMetadata;
  toolConditions?: SkillToolConditions;
  requiredEnvVarNames?: string[];
}

export interface ProjectWorkspaceTrustState {
  workspacePath: string;
  required: boolean;
  decision: boolean | null;
  trusted: boolean;
}

export interface ProjectSkillListResult {
  workspaceRoot: string;
  sources: WorkspaceSkillSourceStatus[];
  trust: ProjectWorkspaceTrustState;
  items: ProjectSkillSummary[];
  inheritedItems: ProjectSkillSummary[];
  diagnostics: SkillDiagnostic[];
}

interface ProjectSkillServiceOptions {
  projects: ProjectService;
  getConfig: () => Config;
  getWorkspaceTrust: (workspaceRoot: string) => ProjectWorkspaceTrustState;
  setWorkspaceTrust: (workspaceRoot: string, trusted: boolean) => ProjectWorkspaceTrustState;
  refreshSkills: () => void | Promise<void>;
}

export class ProjectSkillService {
  constructor(private readonly options: ProjectSkillServiceOptions) {}

  list(projectId: string): ProjectSkillListResult {
    const { location, loaded, inherited, trust } = this.loadCatalog(projectId);
    return {
      workspaceRoot: location.workspaceRoot,
      sources: loaded.sources,
      trust,
      items: loaded.entries.map((entry) => this.toSummary(entry)),
      inheritedItems: inherited.skills.map((skill) => this.toSummary({ skill, effective: true })),
      diagnostics: inherited.diagnostics,
    };
  }

  getContent(projectId: string, skillKey: string): ProjectSkillSummary & { bodyMarkdown: string } {
    const { loaded, inherited } = this.loadCatalog(projectId);
    const entry = loaded.entries.find((candidate) => this.skillKey(candidate.skill) === skillKey);
    if (entry) return { ...this.toSummary(entry), bodyMarkdown: entry.skill.content };
    const inheritedSkill = inherited.skills.find((candidate) => this.skillKey(candidate) === skillKey);
    if (!inheritedSkill) throw new ProjectSkillError('skill_not_found', 404, 'Project skill not found');
    return { ...this.toSummary({ skill: inheritedSkill, effective: true }), bodyMarkdown: inheritedSkill.content };
  }

  getWorkspaceTrust(projectId: string): ProjectWorkspaceTrustState {
    const location = this.resolveLocation(projectId, false);
    return this.options.getWorkspaceTrust(location.workspaceRoot);
  }

  setWorkspaceTrust(projectId: string, trusted: boolean): ProjectWorkspaceTrustState {
    const location = this.resolveLocation(projectId, false);
    return this.options.setWorkspaceTrust(location.workspaceRoot, trusted);
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
    return this.getContent(projectId, this.encodeSkillKey('xopc-workspace', installed.skillId));
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
    return this.getContent(projectId, this.encodeSkillKey('xopc-workspace', installed.skillId));
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

  private loadCatalog(projectId: string) {
    const location = this.resolveLocation(projectId, false);
    const trust = this.options.getWorkspaceTrust(location.workspaceRoot);
    const loaded = loadWorkspaceSkillInventory(location.workspaceRoot, {
      workspaceTrust: trust.trusted ? 'trusted' : 'untrusted',
    });
    const all = loadSkills({
      workspaceDir: location.workspaceRoot,
      builtinDir: resolveBundledSkillsDir(),
      workspaceTrust: trust.trusted ? 'trusted' : 'untrusted',
    });
    const inherited = {
      skills: all.skills.filter((skill) => skill.origin.scope !== 'workspace'),
      diagnostics: all.diagnostics,
    };
    return { location, loaded, inherited, trust };
  }

  private skillKey(skill: Skill): string {
    const rel = relative(skill.origin.rootDir, skill.baseDir).split(sep).join('/');
    return this.encodeSkillKey(skill.origin.id, rel);
  }

  private encodeSkillKey(origin: Skill['origin']['id'], relativeDir: string): string {
    return Buffer.from(`${origin}\0${relativeDir}`, 'utf8').toString('base64url');
  }

  private toSummary(entry: WorkspaceSkillInventoryEntry): ProjectSkillSummary {
    const { skill } = entry;
    const id = basename(skill.baseDir);
    const relativeDir = relative(skill.origin.rootDir, skill.baseDir);
    const removable = skill.origin.id === 'xopc-workspace'
      && !relativeDir.includes(sep)
      && isValidSkillId(id);
    return {
      key: this.skillKey(skill),
      directoryId: id,
      name: skill.name,
      description: skill.description,
      category: skill.category,
      origin: skill.origin.id,
      path: skill.baseDir,
      managed: skill.origin.managed,
      writable: skill.origin.writable,
      removable,
      effective: entry.effective,
      shadowedBy: entry.shadowedBy,
      disableModelInvocation: skill.disableModelInvocation,
      metadata: skill.metadata,
      toolConditions: skill.toolConditions,
      requiredEnvVarNames: skill.requiredEnvVarNames,
    };
  }
}
