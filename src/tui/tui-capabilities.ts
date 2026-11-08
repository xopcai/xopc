import { loadMergedMcpConfig } from '../agent/mcp/config.js';
import { loadSkills } from '../agent/skills/index.js';
import { createSkillConfigManager, isSkillEnabled } from '../agent/skills/config.js';
import type { Config } from '../config/schema.js';
import { resolveEffectiveAgentProfile } from '../config/agent-profile.js';
import { resolveBundledSkillsDir, resolveStateDir } from '../config/paths.js';
import { AgentPluginStore } from '../extensions/agent-plugins/store.js';
import { getDefaultAgentId } from '../routing/resolve-route.js';

export type TuiCapabilityKind = 'skills' | 'mcp' | 'plugins';
export interface TuiCapability {
  id: string;
  description: string;
  state: string;
}

/** Only project non-secret inventory fields into terminal menus. */
export function listTuiCapabilities(input: {
  config: Config; workspace: string; agentId?: string; kind: TuiCapabilityKind; trusted?: boolean;
}): TuiCapability[] {
  if (input.kind === 'plugins') {
    return new AgentPluginStore().list().map(plugin => ({ id: plugin.id, description: plugin.manifest.description ?? '',
      state: plugin.receipt.enabled ? plugin.readiness : 'disabled' }));
  }
  if (input.kind === 'mcp') {
    const merged = loadMergedMcpConfig({ cfg: input.config, workspaceDir: input.workspace, agentId: input.agentId });
    return Object.entries(merged.config.mcpServers).map(([id, server]) => ({ id,
      description: typeof server.description === 'string' ? server.description : '',
      state: server.enabled === false ? 'disabled' : 'configured (connection not probed)' }));
  }
  const config = createSkillConfigManager(resolveStateDir()).load();
  const profile = resolveEffectiveAgentProfile(input.agentId ?? getDefaultAgentId());
  const allowed = profile.skillsAllowlist && new Set(profile.skillsAllowlist.map(name => name.toLowerCase()));
  const denied = new Set(profile.skillsDenylist.map(name => name.toLowerCase()));
  return loadSkills({ workspaceDir: input.workspace, builtinDir: resolveBundledSkillsDir() ?? undefined,
    workspaceTrust: input.trusted ? 'trusted' : 'untrusted' }).skills
    .filter(skill => (!allowed || allowed.has(skill.name.toLowerCase())) && !denied.has(skill.name.toLowerCase()))
    .map(skill => ({ id: skill.name,
    description: skill.description ?? '', state: isSkillEnabled(skill, config) ? 'enabled' : 'disabled' }));
}
