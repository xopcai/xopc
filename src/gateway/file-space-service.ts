import { FileSpaceService } from '../files/file-service.js';
import { getProjectForSession } from '../projects/workspace.js';
import { effectiveWorkspacePathForSession } from '../session/session-workspace.js';
import { listSessionWorkspaceOverrides } from '../storage/sqlite/config-repository.js';
import type { GatewayService } from './service.js';

const services = new WeakMap<GatewayService, FileSpaceService>();

/** Share the file registry, including session-specific spaces, across gateway routes. */
export function getGatewayFileSpaceService(service: GatewayService): FileSpaceService {
  const existing = services.get(service);
  if (existing) return existing;
  const created = new FileSpaceService(
    () => service.currentConfig,
    service.projects,
    (sessionKey) => service.sessions.getEffectiveWorkspacePath(sessionKey),
    () => listSessionWorkspaceOverrides().map(({ sessionKey, workingDirectoryOverride }) => ({
      sessionKey,
      root: effectiveWorkspacePathForSession(service.currentConfig, sessionKey, { workingDirectoryOverride }, getProjectForSession(sessionKey)),
    })),
  );
  services.set(service, created);
  return created;
}
