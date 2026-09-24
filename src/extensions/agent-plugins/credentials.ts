import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { McpOAuthStore } from '../../agent/mcp/oauth/mcp-oauth-store.js';
import { getMcpOAuthManager } from '../../agent/mcp/oauth/mcp-oauth-manager.js';
import { CredentialResolver } from '../../auth/credentials.js';
import { resolveStateDir } from '../../config/paths-state.js';
import { parsePluginAuthBinding, pluginCredentialProviderPrefix } from './auth.js';
import { AgentPluginStore } from './store.js';
import { pluginName, pluginServerId } from './validation.js';

export async function removePluginCredentials(store: AgentPluginStore, id: string): Promise<void> {
  pluginName.parse(id);
  const plugin = store.get(id);
  const serverNames = new Set(Object.keys(plugin?.servers ?? {}));
  const dir = join(store.stateDir, 'plugin-auth', id);
  if (existsSync(dir)) {
    for (const file of readdirSync(dir)) {
      if (!/^[a-f0-9]{64}\.json$/.test(file)) throw new Error('Unexpected plugin auth store entry');
      const binding = parsePluginAuthBinding(JSON.parse(readFileSync(join(dir, file), 'utf8')));
      serverNames.add(binding.serverName);
    }
  }
  for (const name of serverNames) {
    await getMcpOAuthManager({ xopcPlugin: { id, serverName: name } }).cancelPending();
    await new McpOAuthStore(`owner:${pluginServerId(id, name)}`).deleteScope();
  }
  const resolver = new CredentialResolver(store.stateDir === resolveStateDir() ? {} : { stateDir: store.stateDir });
  for (const profile of await resolver.listProfiles()) {
    if (profile.provider.startsWith(pluginCredentialProviderPrefix(id))) {
      await resolver.deleteProviderCredential(profile.provider);
    }
  }
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
}
