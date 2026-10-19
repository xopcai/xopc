import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateHeaderName } from 'node:http';
import { z } from 'zod';
import { CredentialResolver } from '../../auth/credentials.js';
import { writeTextAtomic, writeTextAtomicSync } from '../../infra/write-file-atomic.js';
import { isDangerousHostEnvVarName } from '../../infra/host-env-security.js';
import { resolveStateDir } from '../../config/paths-state.js';
import { AgentPluginStore } from './store.js';
import { pluginName, type PluginServer } from './validation.js';

const bindingSchema = z.strictObject({
  serverName: z.string(),
  mode: z.enum(['auto', 'api-key']),
  identityScope: z.literal('owner'), endpointFingerprint: z.string(),
  oauthReference: z.strictObject({ sourceServerId: z.string(), credentialId: z.string().regex(/^mcp_draft_[a-f0-9]{32}$/), fingerprint: z.string() }).optional(),
  fields: z.array(z.strictObject({ target: z.enum(['headers', 'env']), key: z.string(), provider: z.string(), prefix: z.string() })),
});
export type PluginAuthBinding = z.infer<typeof bindingSchema>;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export const pluginCredentialProviderPrefix = (id: string) => `plugin-${hash(id).slice(0, 16)}-`;
export const parsePluginAuthBinding = (value: unknown): PluginAuthBinding => bindingSchema.parse(value);
export function pluginEndpointFingerprint(server: PluginServer): string {
  return hash(server.type === 'stdio' ? JSON.stringify(server) : JSON.stringify([new URL(server.url).toString(), server.oauth ?? null, server.connectionAuth ?? null]));
}
function bindingPath(store: AgentPluginStore, id: string, name: string, revision?: string) {
  return join(store.stateDir, 'plugin-auth', pluginName.parse(id), `${hash(name)}${revision ? `-${z.string().uuid().parse(revision)}` : ''}.json`);
}
export function readPluginAuthBinding(store: AgentPluginStore, id: string, name: string, server: PluginServer, revision?: string): PluginAuthBinding | undefined {
  const current = store.receipt(id);
  const targetRevision = revision ?? current?.revision;
  const revisions = [...new Set([targetRevision, current?.revision, current?.previous?.revision].filter((value): value is string => !!value))];
  for (const candidate of [...revisions.map(value => bindingPath(store, id, name, value)), bindingPath(store, id, name)]) {
    if (!existsSync(candidate)) continue;
    const binding = bindingSchema.parse(JSON.parse(readFileSync(candidate, 'utf8')));
    const fingerprint = pluginEndpointFingerprint(server);
    const legacy = server.type !== 'stdio' && !server.oauth && !server.connectionAuth && binding.endpointFingerprint === hash(new URL(server.url).toString());
    if (binding.endpointFingerprint !== fingerprint && !legacy) continue;
    if (legacy) binding.endpointFingerprint = fingerprint;
    // Carry forward only credential references for the same plugin and endpoint.
    if (targetRevision && candidate !== bindingPath(store, id, name, targetRevision)) writeTextAtomicSync(bindingPath(store, id, name, targetRevision), JSON.stringify(binding));
    return binding;
  }
  return undefined;
}

export async function savePluginAuthBinding(store: AgentPluginStore, id: string, name: string, input: {
  mode: PluginAuthBinding['mode'];
  secrets?: Array<{ target: 'headers' | 'env'; key: string; value: string; prefix?: string }>;
}): Promise<void> {
  const plugin = store.pending(id) ?? store.get(id);
  const server = plugin?.servers[name];
  if (!server || plugin?.readiness === 'blocked') throw new Error('Plugin MCP server unavailable');
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
    const provider = `${pluginCredentialProviderPrefix(id)}${hash(JSON.stringify(['owner', id, plugin!.receipt.revision, name, endpointFingerprint, field.target, normalizedKey]))}`;
    fields.push({ target: field.target, key: field.key, provider, prefix: field.prefix ?? '' });
  }
  for (let i = 0; i < fields.length; i++) await resolver.saveApiKey(fields[i].provider, input.secrets![i].value);
  // Keep only references in the host binding, never values in package files or config.
  const binding = bindingSchema.parse({ serverName: name, mode: input.mode, identityScope: 'owner', endpointFingerprint, fields });
  await writeTextAtomic(bindingPath(store, id, name, plugin!.receipt.revision), JSON.stringify(binding));
}
export function savePluginOAuthReference(store: AgentPluginStore, id: string, name: string, reference: NonNullable<PluginAuthBinding['oauthReference']>): void {
  const plugin = store.pending(id) ?? store.get(id);
  const server = plugin?.servers[name];
  if (!server || !plugin || plugin.readiness === 'blocked') throw new Error('Plugin MCP server unavailable');
  const binding = bindingSchema.parse({ serverName: name, mode: 'auto', identityScope: 'owner', endpointFingerprint: pluginEndpointFingerprint(server), fields: [], oauthReference: reference });
  writeTextAtomicSync(bindingPath(store, id, name, plugin.receipt.revision), JSON.stringify(binding));
}
export function applyPluginAuthBinding(raw: Record<string, unknown>, binding: PluginAuthBinding | undefined): Record<string, unknown> {
  if (!binding) return raw;
  const result = { ...raw };
  for (const field of binding.fields) {
    const values = { ...result[field.target] as Record<string, unknown> };
    const insensitive = field.target === 'headers' || process.platform === 'win32';
    for (const key of Object.keys(values)) if (insensitive ? key.toLowerCase() === field.key.toLowerCase() : key === field.key) delete values[key];
    values[field.key] = { xopcSecretRef: { provider: field.provider, fieldKey: field.key, prefix: field.prefix } };
    result[field.target] = values;
  }
  if (binding.oauthReference) { result.xopcOAuthCredentialId = binding.oauthReference.credentialId; result.xopcPluginOAuthReference = binding.oauthReference; }
  result.xopcAuthRevision = hash(JSON.stringify(binding));
  return result;
}
