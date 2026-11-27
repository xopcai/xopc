import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const XOPC_OAUTH_PAGE_PATH = join(dirname(fileURLToPath(import.meta.url)), '../src/auth/oauth/oauth-page.ts');

/** Make pi's browser-safe lazy runtime imports discoverable and brand OAuth callback pages in Node bundles. */
export function electronPiRuntimePlugin() {
  return {
    name: 'electron-pi-runtime',
    setup(build) {
      build.onLoad({ filter: /[/\\]pi-ai[/\\]dist[/\\]utils[/\\]oauth-page\.js$/ }, () => ({
        contents: `export { oauthErrorHtml, oauthSuccessHtml } from ${JSON.stringify(XOPC_OAUTH_PAGE_PATH)};\n`,
        loader: 'js',
      }));
      build.onLoad({ filter: /[/\\]pi-ai[/\\]dist[/\\](?:auth[/\\]oauth[/\\]load|api[/\\]bedrock-converse-stream\.lazy)\.js$/ }, ({ path }) => {
        const source = readFileSync(path, 'utf8');
        const contents = source.replace(
          /(?:importOAuthModule|importNodeOnlyApi)\("(\.\/[^"\n]+)\.ts"\)/g,
          (_match, specifier) => `import(${JSON.stringify(`${specifier}.js`)})`,
        );
        if (contents === source) {
          throw new Error('pi runtime loader layout changed; verify Electron bundling.');
        }
        return { contents, loader: 'js' };
      });
    },
  };
}
