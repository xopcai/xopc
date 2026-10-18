import { build } from 'vite';
await build({ configFile: false, build: { ssr: true, outDir: 'out/browser-e2e', rollupOptions: { input: 'scripts/browser-e2e-electron.mjs', external: ['electron', 'node-pty', '@vscode/ripgrep'], output: { entryFileNames: 'index.mjs', banner: "import { createRequire as e2eCreateRequire } from 'node:module'; const require = e2eCreateRequire(import.meta.url);" } } } });
