import type { McpExtensionOptions } from '@earendil-works/pi-coding-agent';

import { loadNativeMcpCredentialModules } from './credential-store-modules.js';

export type NativeMcpCredentials = NonNullable<McpExtensionOptions['credentials']>;

/** Use pi's own stores; never change PI_CODING_AGENT_DIR for an individual connection. */
export async function createNativeMcpCredentials(memory = false): Promise<NativeMcpCredentials> {
  const { McpOAuthCredentialStore, InMemoryAuthStorageBackend } = await loadNativeMcpCredentialModules();
  if (!memory) return new McpOAuthCredentialStore() as NativeMcpCredentials;
  return new McpOAuthCredentialStore(new InMemoryAuthStorageBackend()) as NativeMcpCredentials;
}

/** Credential identity may change on commit without changing the public tool namespace. */
export function routeNativeMcpCredentials(store: NativeMcpCredentials, aliases: ReadonlyMap<string, string>): NativeMcpCredentials {
  const forServer = store.forServer.bind(store), tokens = store.tokens.bind(store), remove = store.remove.bind(store);
  store.forServer = (name, url) => forServer(aliases.get(name) ?? name, url);
  store.tokens = (name, url) => tokens(aliases.get(name) ?? name, url);
  store.remove = (name, url) => {
    const alias = aliases.get(name);
    if (!alias) return remove(name, url);
    // Keep an empty native record so a later load cannot adopt the legacy URL grant.
    forServer(alias, url).save({ serverUrl: url });
    return true;
  };
  return store;
}
