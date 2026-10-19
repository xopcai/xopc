/** pi 1.1 exposes credential injection but keeps its store constructors internal. */
export async function loadNativeMcpCredentialModules() {
  const root = import.meta.resolve('@earendil-works/pi-coding-agent');
  const { McpOAuthCredentialStore } = await import(new URL('./extensions/mcp/oauth.js', root).href);
  const { InMemoryAuthStorageBackend } = await import(new URL('./core/auth-storage.js', root).href);
  return { McpOAuthCredentialStore, InMemoryAuthStorageBackend };
}
