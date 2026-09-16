import { existsSync, realpathSync } from 'node:fs';
import { resolveBundledSkillsDir, resolveSkillsDir, resolveStateDir } from '../config/paths.js';
import { loadSkills } from '../agent/skills/index.js';
import { resolveWorkspaceSkillsDir } from '../agent/skills/workspace-skills-dir.js';
import { ProjectTrustStore } from '../project-trust/trust-store.js';
import { ProjectService } from '../projects/project-service.js';
import { ImportSelectionRepository } from '../storage/sqlite/import-selection-repository.js';
import { ImportRepository } from '../storage/sqlite/import-repository.js';
import { ImportService } from './importService.js';
import { canonicalTarget } from './planner.js';
import { ImportError, type ImportTarget } from './types.js';

export function resolveImportTarget(projectId?: string): ImportTarget {
  if (!projectId) return { root: canonicalTarget(resolveSkillsDir()) };
  const project = new ProjectService().get(projectId);
  if (!project?.workspaceRoot || !existsSync(project.workspaceRoot)) throw new ImportError('invalid_project', 'Project needs an existing workspace');
  return { projectId, root: canonicalTarget(resolveWorkspaceSkillsDir(project.workspaceRoot)) };
}
export function createRuntimeImportService(owner: string, refreshSkills?: () => void | Promise<void>, checkTrust?: (root: string) => boolean): ImportService {
  return new ImportService({
    owner,
    stateDir: resolveStateDir(),
    refreshSkills,
    isWorkspaceTrusted: root => checkTrust ? checkTrust(root) : new ProjectTrustStore().get(root) === true,
    isConnected(candidate, sourceWorkspace) {
      if (!candidate.shared) return false;
      const project = candidate.scope === 'project' ? new ProjectService().resolveForWorkspacePath(candidate.location)?.project : undefined;
      const workspaceDir = candidate.scope === 'project' ? sourceWorkspace ?? project?.workspaceRoot : undefined;
      const trusted = workspaceDir && (checkTrust ? checkTrust(workspaceDir) : new ProjectTrustStore().get(workspaceDir) === true);
      const skills = loadSkills({ workspaceDir, workspaceTrust: trusted ? 'trusted' : 'untrusted' }).skills;
      return skills.some(s => realpathSync(s.baseDir) === candidate.location);
    },
    validateTarget(target) {
      if (resolveImportTarget(target.projectId).root !== target.root) throw new ImportError('scope_mismatch', 'Project target changed; preview again', 409);
      if (target.projectId) {
        const project = new ProjectService().get(target.projectId)!;
        if (!(checkTrust ? checkTrust(project.workspaceRoot!) : new ProjectTrustStore().get(project.workspaceRoot!) === true)) throw new ImportError('workspace_untrusted', 'Trust this project in project settings before importing', 403);
      }
    },
    reservedNames(target) {
      const workspaceDir = target.projectId ? new ProjectService().get(target.projectId)?.workspaceRoot : undefined;
      return loadSkills({ workspaceDir, workspaceTrust: 'trusted', builtinDir: resolveBundledSkillsDir() ?? undefined }).skills.map(s => s.name);
    },
  });
}

export async function recoverCapabilityImports(): Promise<void> {
  for (const owner of ImportRepository.owners()) await createRuntimeImportService(owner).recoverAndClean();
  const { recoverSelectionRuns } = await import('./productImport.js');
  for (const owner of ImportSelectionRepository.owners()) await recoverSelectionRuns(createRuntimeImportService(owner), owner);
}
