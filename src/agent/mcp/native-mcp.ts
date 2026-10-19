import type { PluginServer } from '../../extensions/agent-plugins/validation.js';
import { validPluginOAuthReference, type PluginOAuthReference } from '../../extensions/agent-plugins/connection-reuse.js';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { getAgentDir, type LoadedMcpConfig, type McpServerConfig } from '@earendil-works/pi-coding-agent';

import { resolveStateDir } from '../../config/paths-state.js';
import { McpServerSchema, type Config } from '../../config/schema.js';
import { resolveConnectorSecretReferences } from '../../connectors/secret-store.js';
import { createNativeMcpCredentials, routeNativeMcpCredentials, type NativeMcpCredentials } from './credential-store.js';
import { loadMergedMcpConfig } from './config.js';

/** One process-wide pi directory: sessions share native OAuth credentials, never swap roots per turn. */
export function getNativePiAgentDir(): string {
  process.env.PI_CODING_AGENT_DIR ??= join(resolveStateDir(), 'pi');
  const directory = getAgentDir();
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  return directory;
}

export type NativeMcpConfig = LoadedMcpConfig & { credentials?: NativeMcpCredentials; credentialAliases?: Record<string, string> };

/** Only projects host configuration and secret references; all MCP execution belongs to pi. */
export async function prepareNativeMcpConfig(config: Config, workspaceDir: string, agentId?: string): Promise<NativeMcpConfig> {
  getNativePiAgentDir();
  const merged = loadMergedMcpConfig({ cfg: config, workspaceDir, agentId });
  const result: LoadedMcpConfig = { servers: [], errors: merged.diagnostics.map(item => item.message) };
  const names = new Set<string>();
  const aliases = new Map<string, string>();
  for (const [name, raw] of Object.entries(merged.config.mcpServers)) {
    const normalized = name.replace(/-/g, '_');
    if (!/^[a-zA-Z0-9_-]+$/.test(name) || names.has(normalized)) {
      result.errors.push(`Invalid or colliding MCP server name: ${name}`);
      continue;
    }
    names.add(normalized);
    const reference = raw.xopcPluginOAuthReference as PluginOAuthReference | undefined;
    if (reference && !validPluginOAuthReference(reference, config, raw as PluginServer)) { result.errors.push(`Shared MCP connection changed: ${name}. Reconnect this plugin.`); continue; }
    if (typeof raw.xopcOAuthCredentialId === 'string') aliases.set(name, raw.xopcOAuthCredentialId);
    const parsed = McpServerSchema.safeParse(raw);
    if (!parsed.success) { result.errors.push(`Invalid MCP server ${name}: ${parsed.error.message}`); continue; }
    const value = await resolveConnectorSecretReferences(parsed.data) as Record<string, unknown>;
    const fields = ['type', 'command', 'args', 'env', 'cwd', 'url', 'headers', 'oauth', 'auth',
      'timeout', 'enabled', 'exposure', 'toolExposure', 'description'];
    const projected = Object.fromEntries(fields.filter(key => value[key] !== undefined).map(key => [key, value[key]]));
    if (projected.type === 'streamable-http') projected.type = 'http';
    const plugin = raw.xopcPlugin as { id: string; revision: string } | undefined;
    result.servers.push({ name, config: projected as unknown as McpServerConfig, source: plugin?.revision ? `plugin:${plugin.id}@${plugin.revision}` : 'xopc.json', scope: 'extension' });
  }
  if (aliases.size) {
    (result as NativeMcpConfig).credentials = routeNativeMcpCredentials(await createNativeMcpCredentials(), aliases);
    (result as NativeMcpConfig).credentialAliases = Object.fromEntries(aliases);
  }
  return result;
}
