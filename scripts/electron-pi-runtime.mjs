import { readFileSync } from 'node:fs';

/** Make pi's browser-safe lazy runtime imports discoverable in the Node bundle. */
export function electronPiRuntimePlugin() {
  return {
    name: 'electron-pi-runtime',
    setup(build) {
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
