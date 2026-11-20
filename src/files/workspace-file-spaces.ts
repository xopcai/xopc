import type { Config } from '../config/schema.js';
import { ProjectService } from '../projects/project-service.js';
import { getProjectForSession } from '../projects/workspace.js';
import { effectiveWorkspacePathForSession } from '../session/session-workspace.js';
import { getSessionConfig, listSessionWorkspaceOverrides } from '../storage/sqlite/config-repository.js';
import { FileSpaceService } from './file-service.js';

export function createWorkspaceFileSpaceService(
  getConfig: () => Config,
  projects = new ProjectService(),
  resolveSessionWorkspace = (conversationId: string): string | Promise<string> =>
    effectiveWorkspacePathForSession(getConfig(), conversationId, getSessionConfig(conversationId), getProjectForSession(conversationId)),
): FileSpaceService {
  return new FileSpaceService(getConfig, projects, resolveSessionWorkspace,
    () => listSessionWorkspaceOverrides().map(({ conversationId, workingDirectoryOverride }) => ({
      conversationId,
      root: effectiveWorkspacePathForSession(getConfig(), conversationId, { workingDirectoryOverride }, getProjectForSession(conversationId)),
    })));
}
