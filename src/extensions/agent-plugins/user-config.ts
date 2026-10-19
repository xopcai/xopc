import { pluginAuthorizations } from './setup-contract.js';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { CredentialResolver } from '../../auth/credentials.js';
import { writeTextAtomicSync } from '../../infra/write-file-atomic.js';
import { pluginName } from './validation.js';
import type { AgentPluginStore, InstalledAgentPlugin } from './store.js';
import { pluginCredentialProviderPrefix } from './auth.js';

export function readPluginUserConfig(store: AgentPluginStore, id: string, revision: string): Record<string, unknown> {
  const path = join(store.stateDir, 'plugin-config', `${pluginName.parse(id)}-${revision}.json`);
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};
}
export async function savePluginUserConfig(store: AgentPluginStore, plugin: InstalledAgentPlugin, input: Record<string, unknown>): Promise<void> {
  const fields = plugin.layout?.userConfig ?? {};
  const values = readPluginUserConfig(store, plugin.id, plugin.receipt.revision);
  for (const [key, value] of Object.entries(input)) {
    const field = fields[key];
    if (!field || typeof value !== field.type || typeof value === 'string' && (value.length > 16384 || value.includes('\0'))) throw new Error(`Invalid configuration: ${key}`);
    if (field.sensitive) {
      const provider = `${pluginCredentialProviderPrefix(plugin.id)}config-${createHash('sha256').update(`${plugin.receipt.revision}:${key}`).digest('hex')}`;
      await new CredentialResolver({ stateDir: store.stateDir }).saveApiKey(provider, String(value));
      values[key] = { xopcSecretRef: { provider, fieldKey: key, prefix: '' } };
    } else values[key] = value;
  }
  writeTextAtomicSync(join(store.stateDir, 'plugin-config', `${plugin.id}-${plugin.receipt.revision}.json`), JSON.stringify(values));
}
export function pluginConfigMissing(store: AgentPluginStore, plugin: InstalledAgentPlugin): string[] {
  const saved = readPluginUserConfig(store, plugin.id, plugin.receipt.revision);
  const accountFields = new Set(pluginAuthorizations(plugin.manifest).flatMap(value => value.methods.flatMap(method => method.type === 'form' || method.type === 'cli' ? method.fields : [])));
  return Object.entries(plugin.layout?.userConfig ?? {}).filter(([key, field]) => !accountFields.has(key) && field.required && (saved[key] === undefined || saved[key] === '') && field.default === undefined).map(([key]) => key);
}
export function expandUserConfig(value: string, values: Record<string, unknown>): unknown {
  const exact = value.match(/^\$\{user_config\.([A-Za-z_][A-Za-z0-9_]*)\}$/);
  if (exact && typeof values[exact[1]] === 'object') return values[exact[1]];
  return value.replace(/\$\{user_config\.([A-Za-z_][A-Za-z0-9_]*)\}/g, (_all, key: string) => {
    if (values[key] === undefined) throw new Error(`Configure ${key} before starting tools`);
    if (typeof values[key] === 'object') throw new Error('Sensitive configuration must occupy an entire environment/header value');
    return String(values[key]);
  });
}
