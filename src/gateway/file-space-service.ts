import { FileSpaceService } from '../files/file-service.js';
import { getProjectForSession } from '../projects/workspace.js';
import { effectiveWorkspacePathForSession } from '../session/session-workspace.js';
import { listSessionWorkspaceOverrides } from '../storage/sqlite/config-repository.js';

type GatewayFileSpaceHost = {
  currentConfig: ConstructorParameters<typeof FileSpaceService>[0] extends () => infer T ? T : never;
  projects: ConstructorParameters<typeof FileSpaceService>[1];
  sessions: { getEffectiveWorkspacePath(conversationId: string): Promise<string> };
};

const services = new WeakMap<GatewayFileSpaceHost, FileSpaceService>();

/** Share the file registry, including session-specific spaces, across gateway routes. */
export function getGatewayFileSpaceService(service: GatewayFileSpaceHost): FileSpaceService {
  const existing = services.get(service);
  if (existing) return existing;
  const created = new FileSpaceService(
    () => service.currentConfig,
    service.projects,
    (conversationId) => service.sessions.getEffectiveWorkspacePath(conversationId),
    () => listSessionWorkspaceOverrides().map(({ conversationId, workingDirectoryOverride }) => ({
      conversationId,
      root: effectiveWorkspacePathForSession(service.currentConfig, conversationId, { workingDirectoryOverride }, getProjectForSession(conversationId)),
    })),
  );
  services.set(service, created);
  return created;
}
