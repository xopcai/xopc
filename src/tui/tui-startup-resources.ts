import { basename } from 'node:path';

import { resolveBootstrapFilesSync } from '../agent/bootstrap/bootstrap-files.js';
import { loadSkills } from '../agent/skills/index.js';
import { isSkillEnabled, createSkillConfigManager } from '../agent/skills/config.js';
import { createWorkflowCatalog } from '../agent/workflow/catalog.js';
import { resolveEffectiveAgentProfileForSession } from '../config/agent-profile.js';
import { getWorkspacePath } from '../config/index.js';
import {
  resolveAgentProfileDir,
  resolveBundledSkillsDir,
  resolveStateDir,
  resolveUserProfilePath,
} from '../config/paths.js';
import { listConnectorInstances } from '../connectors/instances.js';
import type { Config } from '../config/schema.js';
import type { TuiStartupResources } from './tui-backend.js';

function uniqueSorted(values: Iterable<string>): string[] {
  return [...new Set([...values].map((value) => value.trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
}

export function collectTuiStartupResources(
  config: Config,
  sessionKey?: string,
  options: { isWorkspaceTrusted?: (workspaceDir: string) => boolean } = {},
): TuiStartupResources {
  const profile = resolveEffectiveAgentProfileForSession(config, sessionKey);
  const profileDir = resolveAgentProfileDir(config, profile.agentId);
  const workspaceDir = profile.resolvedWorkspacePath || getWorkspacePath(config);

  const context = uniqueSorted(
    resolveBootstrapFilesSync({ profileDir, userProfilePath: resolveUserProfilePath(), sessionKey })
      .filter((file) => !file.missing)
      .map((file) => file.name || basename(file.path)),
  );

  const skillsConfig = createSkillConfigManager(resolveStateDir()).load();
  const skills = uniqueSorted(
    loadSkills({
      workspaceDir,
      builtinDir: resolveBundledSkillsDir() ?? undefined,
      workspaceTrust: options.isWorkspaceTrusted?.(workspaceDir) === true ? 'trusted' : 'untrusted',
    }).skills
      .filter((skill) => !skill.disableModelInvocation && isSkillEnabled(skill, skillsConfig))
      .map((skill) => skill.name),
  );

  const workflows = uniqueSorted(createWorkflowCatalog().list().map((entry) => entry.name));
  const connectors = uniqueSorted(
    listConnectorInstances(config).map((instance) => instance.displayName || instance.connectorId || instance.instanceId),
  );

  return { context, skills, workflows, connectors };
}
