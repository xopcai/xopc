import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { validateHeaderName } from 'node:http';
import { z } from 'zod';
import { CredentialResolver } from '../../auth/credentials.js';
import { writeTextAtomic } from '../../infra/write-file-atomic.js';
import { isDangerousHostEnvVarName } from '../../infra/host-env-security.js';
import { resolveStateDir } from '../../config/paths-state.js';
import { McpOAuthStore } from '../../agent/mcp/oauth/mcp-oauth-store.js';
import { AgentPluginStore } from './store.js';
import { pluginName, pluginServerId, type PluginServer } from './validation.js';
import { clearPluginMcpHealth } from './health.js';

const bindingSchema = z.strictObject({
  serverName: z.string(),
  mode: z.enum(['auto', 'oauth', 'api-key', 'none']),
  identityScope: z.literal('owner'), endpointFingerprint: z.string(),
  fields: z.array(z.strictObject({ target: z.enum(['headers', 'env']), key: z.string(), provider: z.string(), prefix: z.string() })),
});
export type PluginAuthBinding = z.infer<typeof bindingSchema>;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const providerPrefix = (id: string) => `plugin-${hash(id).slice(0, 16)}-`;
export function pluginEndpointFingerprint(server: PluginServer): string {
  return hash(server.type === 'stdio' ? JSON.stringify(server) : new URL(server.url).toString());
}
function bindingPath(store: AgentPluginStore, id: string, name: string) {
  return join(store.stateDir, 'plugin-auth', pluginName.parse(id), `${hash(name)}.json`);
}
export function readPluginAuthBinding(store: AgentPluginStore, id: string, name: string, server: PluginServer): PluginAuthBinding | undefined {
  const path = bindingPath(store, id, name);
  if (!existsSync(path)) return undefined;
  const binding = bindingSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
  return binding.endpointFingerprint === pluginEndpointFingerprint(server) ? binding : undefined;
}
export async function savePluginAuthBinding(store: AgentPluginStore, id: string, name: string, input: {
  mode: PluginAuthBinding['mode'];
  secrets?: Array<{ target: 'headers' | 'env'; key: string; value: string; prefix?: string }>;
}): Promise<void> {
  const plugin = store.get(id);
  const server = plugin?.servers[name];
  if (!server || plugin?.readiness === 'blocked') throw new Error('Plugin MCP server unavailable');
  if (input.mode === 'oauth' && server.type !== 'streamable-http') throw new Error('OAuth requires streamable HTTP');
  const endpointFingerprint = pluginEndpointFingerprint(server);
  const fields: PluginAuthBinding['fields'] = [];
  const resolver = new CredentialResolver(store.stateDir === resolveStateDir() ? {} : { stateDir: store.stateDir });
  if (input.mode !== 'api-key' && input.secrets?.length) throw new Error('Secrets require api-key mode');
  const seen = new Set<string>();
  for (const field of input.secrets ?? []) {
    if (!field.value || field.value.length > 16384 || /[\r\n\0]/.test(field.value) || /[\r\n\0]/.test(field.prefix ?? '')) throw new Error('Invalid secret value');
    if (field.target === 'headers') {
      validateHeaderName(field.key);
      if (server.type === 'stdio') throw new Error('stdio credentials must use env');
      if (['host', 'content-length', 'connection', 'transfer-encoding', 'cookie'].includes(field.key.toLowerCase())) throw new Error('Unsupported credential header');
    } else if (server.type !== 'stdio' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(field.key) || /^(PLUGIN_ROOT|PLUGIN_DATA|PATH)$/i.test(field.key) || isDangerousHostEnvVarName(field.key)) throw new Error('Unsupported credential environment variable');
    const normalizedKey = field.target === 'headers' || process.platform === 'win32' ? field.key.toLowerCase() : field.key;
    if (seen.has(normalizedKey)) throw new Error('Duplicate credential field');
    seen.add(normalizedKey);
    const provider = `${providerPrefix(id)}${hash(JSON.stringify(['owner', id, name, endpointFingerprint, field.target, normalizedKey]))}`;
    fields.push({ target: field.target, key: field.key, provider, prefix: field.prefix ?? '' });
  }
  for (let i = 0; i < fields.length; i++) await resolver.saveApiKey(fields[i].provider, input.secrets![i].value);
  // Keep only references in the host binding, never values in package files or config.
  const binding = bindingSchema.parse({ serverName: name, mode: input.mode, identityScope: 'owner', endpointFingerprint, fields });
  await writeTextAtomic(bindingPath(store, id, name), JSON.stringify(binding));
  clearPluginMcpHealth(id, name, store.stateDir);
}
export function applyPluginAuthBinding(raw: Record<string, unknown>, binding: PluginAuthBinding | undefined): Record<string, unknown> {
  if (!binding) return raw;
  const result = { ...raw };
  if (binding.mode === 'none' || binding.mode === 'api-key') { delete result.auth; delete result.xopcAutoAuth; }
  if (binding.mode === 'oauth') {
    result.auth = { type: 'oauth' }; delete result.xopcAutoAuth;
    result.headers = Object.fromEntries(Object.entries(result.headers as Record<string, unknown> ?? {}).filter(([key]) => key.toLowerCase() !== 'authorization'));
  }
  for (const field of binding.fields) {
    const values = { ...result[field.target] as Record<string, unknown> };
    const insensitive = field.target === 'headers' || process.platform === 'win32';
    for (const key of Object.keys(values)) if (insensitive ? key.toLowerCase() === field.key.toLowerCase() : key === field.key) delete values[key];
    values[field.key] = { xopcSecretRef: { provider: field.provider, fieldKey: field.key, prefix: field.prefix } };
    result[field.target] = values;
  }
  result.xopcAuthRevision = hash(JSON.stringify(binding));
  return result;
}
export function pluginOAuthScope(raw: unknown): string | undefined {
  const plugin = (raw as { xopcPlugin?: { id: string; serverName: string } } | undefined)?.xopcPlugin;
  return plugin ? `owner:${pluginServerId(plugin.id, plugin.serverName)}` : undefined;
}

export async function removePluginCredentials(store: AgentPluginStore, id: string): Promise<void> {
  pluginName.parse(id);
  const plugin = store.get(id);
  const serverNames = new Set(Object.keys(plugin?.servers ?? {}));
  const dir = join(store.stateDir, 'plugin-auth', id);
  if (existsSync(dir)) for (const file of readdirSync(dir)) {
    if (!/^[a-f0-9]{64}\.json$/.test(file)) throw new Error('Unexpected plugin auth store entry');
    const binding = bindingSchema.parse(JSON.parse(readFileSync(join(dir, file), 'utf8')));
    serverNames.add(binding.serverName);
  }
  const { getMcpOAuthManager } = await import('../../agent/mcp/oauth/mcp-oauth-manager.js');
  for (const name of serverNames) {
    await getMcpOAuthManager({ xopcPlugin: { id, serverName: name } }).cancelPending();
    await new McpOAuthStore(`owner:${pluginServerId(id, name)}`).deleteScope();
  }
  const resolver = new CredentialResolver(store.stateDir === resolveStateDir() ? {} : { stateDir: store.stateDir });
  for (const profile of await resolver.listProfiles()) {
    if (profile.provider.startsWith(providerPrefix(id))) await resolver.deleteProviderCredential(profile.provider);
  }
  if (existsSync(dir)) {
    // Only this package's host-managed bindings are removed; provider-side grants remain.
    rmSync(dir, { recursive: true, force: true });
  }
}
