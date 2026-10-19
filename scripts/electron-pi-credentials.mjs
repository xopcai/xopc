import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Resolve pi's private modules at build time so Electron needs no pi package tree. */
export function electronPiCredentialsPlugin() {
  return {
    name: 'electron-pi-credentials',
    setup(build) {
      build.onLoad({ filter: /[/\\]agent[/\\]mcp[/\\]credential-store-modules\.ts$/ }, () => {
        const piDir = dirname(fileURLToPath(import.meta.resolve('@earendil-works/pi-coding-agent')));
        return {
          contents: [
            `import { McpOAuthCredentialStore } from ${JSON.stringify(join(piDir, 'extensions/mcp/oauth.js'))};`,
            `import { InMemoryAuthStorageBackend } from ${JSON.stringify(join(piDir, 'core/auth-storage.js'))};`,
            'export async function loadNativeMcpCredentialModules() {',
            '  return { McpOAuthCredentialStore, InMemoryAuthStorageBackend };',
            '}',
          ].join('\n'),
          loader: 'js',
        };
      });
    },
  };
}
