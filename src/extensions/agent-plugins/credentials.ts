import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { CredentialResolver } from '../../auth/credentials.js';
import { resolveStateDir } from '../../config/paths-state.js';
import { pluginCredentialProviderPrefix } from './auth.js';
import { AgentPluginStore } from './store.js';
import { getNativePiAgentDir } from '../../agent/mcp/native-mcp.js';
import { createNativeMcpCredentials } from '../../agent/mcp/credential-store.js';
import { pluginServerId } from './validation.js';
import { pluginOAuthCredentialId } from './mcp-adapter.js';
import { pluginName } from './validation.js';

export async function removePluginCredentials(store: AgentPluginStore, id: string): Promise<void> {
  pluginName.parse(id);
  const history = store.history(id);
  if (store.stateDir === resolveStateDir()) {
    getNativePiAgentDir();
    const native = await createNativeMcpCredentials();
    for (const plugin of history) {
      const servers = plugin.receipt.oauthServers ?? Object.fromEntries(Object.entries(plugin.servers).filter(([, server]) => server.type !== 'stdio').map(([name, server]) => [name, server.type !== 'stdio' ? server.url : '']));
      for (const [name, url] of Object.entries(servers)) {
        const alias = plugin.receipt.credentialScope === 'revision' ? pluginOAuthCredentialId(id, plugin.receipt.revision, name) : pluginServerId(id, name);
        // Clear only owned namespaces, never a shared credential alias or legacy URL grant.
        await native.forServer(alias, url).save({ serverUrl: url });
        native.remove(alias, url);
      }
    }
  }
  const dir = join(store.stateDir, 'plugin-auth', id);
  const resolver = new CredentialResolver(store.stateDir === resolveStateDir() ? {} : { stateDir: store.stateDir });
  for (const profile of await resolver.listProfiles()) {
    if (profile.provider.startsWith(pluginCredentialProviderPrefix(id))) {
      await resolver.deleteProviderCredential(profile.provider);
    }
  }
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  for (const plugin of history) {
    rmSync(join(store.stateDir, 'plugin-config', `${id}-${plugin.receipt.revision}.json`), { force: true });
    rmSync(join(store.dataDir(id), 'accounts', plugin.receipt.revision), { recursive: true, force: true });
  }
}
