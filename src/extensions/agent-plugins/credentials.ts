import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { CredentialResolver } from '../../auth/credentials.js';
import { resolveStateDir } from '../../config/paths-state.js';
import { pluginCredentialProviderPrefix } from './auth.js';
import { AgentPluginStore } from './store.js';
import { pluginName } from './validation.js';

export async function removePluginCredentials(store: AgentPluginStore, id: string): Promise<void> {
  pluginName.parse(id);
  const dir = join(store.stateDir, 'plugin-auth', id);
  const resolver = new CredentialResolver(store.stateDir === resolveStateDir() ? {} : { stateDir: store.stateDir });
  for (const profile of await resolver.listProfiles()) {
    if (profile.provider.startsWith(pluginCredentialProviderPrefix(id))) {
      await resolver.deleteProviderCredential(profile.provider);
    }
  }
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
}
