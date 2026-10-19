import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

import { pluginAuthorizations, type PluginAuthorization } from './setup-contract.js';
import type { AgentPluginStore, InstalledAgentPlugin } from './store.js';

const authorization = z.union([z.string().min(1), z.strictObject({
  id: z.string().min(1), scopes: z.array(z.string().min(1)).max(100),
})]);
const requirement = z.strictObject({
  authorizations: z.array(authorization).max(20).default([]),
  servers: z.array(z.string().min(1)).max(20).default([]),
});
const accessSchema = z.strictObject({
  skills: z.record(z.string(), requirement).default({}),
  mcp: z.record(z.string(), requirement).default({}),
});
export function pluginCapabilityAccess(manifest: InstalledAgentPlugin['manifest']) {
  const extension = manifest.extensions?.['ai.xopc'] as { setup?: { capabilityAccess?: unknown } } | undefined;
  return accessSchema.parse(extension?.setup?.capabilityAccess ?? {});
}

const stateSchema = z.object({
  packageRevision: z.string(), state: z.string(), installed: z.boolean().optional(), resources: z.string(),
  connections: z.array(z.object({ name: z.string(), state: z.string() })),
  authorizations: z.array(z.object({ id: z.string(), state: z.string(), expiresAt: z.number().finite().optional(),
    issues: z.array(z.object({ scopes: z.array(z.string()).default([]) })).default([]),
  })).default([]),
});
type Rule = z.infer<typeof requirement>;

/** One fail-closed access decision shared by Skill discovery and MCP projection. */
export function resolvePluginCapabilityAccess(plugin: InstalledAgentPlugin, store: AgentPluginStore, now = Date.now()) {
  let declarations: PluginAuthorization[], access: z.infer<typeof accessSchema>;
  try { declarations = pluginAuthorizations(plugin.manifest); access = pluginCapabilityAccess(plugin.manifest); }
  catch { return { skill: (_name: string) => false, server: (_name: string) => false }; }
  const path = join(store.stateDir, 'plugin-setup', `${plugin.id}.json`);
  let state: z.infer<typeof stateSchema> | undefined, damaged = false;
  if (existsSync(path)) {
    try { const parsed = stateSchema.parse(JSON.parse(readFileSync(path, 'utf8'))); if (parsed.packageRevision === plugin.receipt.revision) state = parsed; }
    catch { damaged = true; }
  }
  const extension = plugin.manifest.extensions?.['ai.xopc'] as { setup?: { resources?: unknown[] } } | undefined;
  const prepared = !damaged && plugin.readiness !== 'blocked' && (state
    ? state.resources === 'ready' && (state.installed === true || state.state === 'completed') && state.state !== 'cancelled'
    : !extension?.setup?.resources?.length);
  const connected = (name: string) => state?.connections.find(value => value.name === name)?.state === 'connected';
  const requiresConnection = (name: string) => {
    const server = plugin.servers[name];
    if (!server) return true;
    return server.type !== 'stdio' ? server.connectionAuth?.mode !== 'none'
      : Object.values(server.env ?? {}).some(value => Object.entries(plugin.layout?.userConfig ?? {}).some(([key, field]) => field.sensitive && value.includes(`\${user_config.${key}}`)));
  };
  const granted = (entry: z.infer<typeof authorization>) => {
    const id = typeof entry === 'string' ? entry : entry.id;
    const declaration = declarations.find(value => value.id === id);
    const saved = state?.authorizations.find(value => value.id === id);
    if (!declaration || saved?.state !== 'connected' || saved.expiresAt !== undefined && saved.expiresAt <= now
      || !declaration.servers.every(connected)) return false;
    return saved.issues.every(issue => typeof entry !== 'string' && issue.scopes.length > 0
      && !issue.scopes.some(scope => entry.scopes.includes(scope)));
  };
  const allows = (rule: Rule) => prepared && rule.authorizations.every(granted) && rule.servers.every(connected);
  const defaults: Rule = { authorizations: declarations.map(value => value.id), servers: declarations.length ? [] : Object.keys(plugin.servers).filter(requiresConnection) };
  return {
    skill: (name: string) => allows(access.skills[name] ?? defaults),
    server: (name: string) => {
      const owners = declarations.filter(value => value.servers.includes(name));
      const rule = access.mcp[name] ?? { authorizations: (owners.length ? owners : declarations).map(value => value.id), servers: [] };
      return allows(rule) && (state ? connected(name) : !requiresConnection(name));
    },
  };
}

export function pluginRuntimeAccessKey(store: AgentPluginStore, workspace: string, agentId?: string): string {
  return JSON.stringify(store.active(agentId, workspace).map(plugin => {
    const access = resolvePluginCapabilityAccess(plugin, store);
    return [plugin.id, plugin.receipt.revision, plugin.skills.filter(skill => access.skill(skill.name)).map(skill => skill.name), Object.keys(plugin.servers).filter(access.server)];
  }));
}
